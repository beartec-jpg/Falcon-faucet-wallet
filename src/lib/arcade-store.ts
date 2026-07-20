/**
 * Arcade Game Faucet storage:
 * - Best scores per (network, address, game, dayUtc) for leaderboard + claim checks
 * - Separate game claim quotas (same faucet pool, different limits)
 *
 * Uses Postgres when DATABASE_URL is set; otherwise in-memory (dev/single-instance).
 */

import { getSql, isDbConfigured } from '@/lib/db'

export const GAME_SLUGS = [
  'falcon-flight',
  'ledger-runner',
  'epoch-rise',
  'amendment-apocalypse',
] as const

export type GameSlug = (typeof GAME_SLUGS)[number]

/** Best single-run score required to claim (not sum of runs). */
export const GAME_FAUCET_MIN_SCORE = parseInt(
  process.env.GAME_FAUCET_MIN_SCORE ?? '500',
  10,
)

/**
 * Max successful game claims per address per game per UTC day.
 * Default 8 so a player can put all daily claims on one favourite game.
 */
export const GAME_CLAIMS_PER_GAME_PER_DAY = parseInt(
  process.env.GAME_CLAIMS_PER_GAME_PER_DAY ?? '8',
  10,
)

/**
 * Max successful game claims per address across all games per UTC day.
 * Combined with per-game cap: any mix (e.g. 2×4 games, or 8×1 game).
 * Playing for high scores is unlimited; only payouts are capped.
 */
export const GAME_CLAIMS_TOTAL_PER_DAY = parseInt(
  process.env.GAME_CLAIMS_TOTAL_PER_DAY ?? '8',
  10,
)

export function isGameSlug(s: string): s is GameSlug {
  return (GAME_SLUGS as readonly string[]).includes(s)
}

export function arcadeUtcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

// ── Memory fallback ──────────────────────────────────────

type ScoreKey = string // network|address|game|day
type ClaimKey = string // network|address|game|day

const memScores = new Map<string, number>()
const memClaims = new Map<string, number>() // count

function scoreKey(
  network: string,
  address: string,
  game: string,
  day: string,
): ScoreKey {
  return `${network}|${address.toLowerCase()}|${game}|${day}`
}

function claimKey(
  network: string,
  address: string,
  game: string,
  day: string,
): ClaimKey {
  return `${network}|${address.toLowerCase()}|${game}|${day}`
}

async function ensureTables(): Promise<void> {
  if (!isDbConfigured()) return
  const sql = getSql()
  await sql`
    CREATE TABLE IF NOT EXISTS arcade_scores (
      id BIGSERIAL PRIMARY KEY,
      network TEXT NOT NULL,
      address TEXT NOT NULL,
      game TEXT NOT NULL,
      day_utc DATE NOT NULL,
      score DOUBLE PRECISION NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (network, address, game, day_utc)
    )
  `
  await sql`
    CREATE INDEX IF NOT EXISTS arcade_scores_lb
    ON arcade_scores (network, game, day_utc, score DESC)
  `
  await sql`
    CREATE TABLE IF NOT EXISTS arcade_claims (
      id BIGSERIAL PRIMARY KEY,
      network TEXT NOT NULL,
      address TEXT NOT NULL,
      game TEXT NOT NULL,
      day_utc DATE NOT NULL,
      score_at_claim DOUBLE PRECISION NOT NULL,
      amount_qxrp DOUBLE PRECISION NOT NULL,
      tx_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE INDEX IF NOT EXISTS arcade_claims_addr_day
    ON arcade_claims (network, address, day_utc)
  `
  await sql`
    CREATE INDEX IF NOT EXISTS arcade_claims_game_day
    ON arcade_claims (network, address, game, day_utc)
  `
}

/** Upsert best score for the day (only increases). */
export async function upsertArcadeScore(opts: {
  network: string
  address: string
  game: string
  score: number
  dayUtc?: string
}): Promise<{ best: number; improved: boolean }> {
  const day = opts.dayUtc ?? arcadeUtcDay()
  const score = Math.floor(Math.max(0, opts.score))
  const address = opts.address.trim()

  if (isDbConfigured()) {
    try {
      await ensureTables()
      const sql = getSql()
      const rows = await sql`
        INSERT INTO arcade_scores (network, address, game, day_utc, score)
        VALUES (
          ${opts.network},
          ${address},
          ${opts.game},
          ${day}::date,
          ${score}
        )
        ON CONFLICT (network, address, game, day_utc)
        DO UPDATE SET
          score = GREATEST(arcade_scores.score, EXCLUDED.score),
          updated_at = NOW()
        RETURNING score
      `
      const best = Number(rows[0]?.score ?? score)
      return { best, improved: best === score && score > 0 }
    } catch (e) {
      console.warn('[arcade-store] upsert db failed, using memory:', e)
    }
  }

  const k = scoreKey(opts.network, address, opts.game, day)
  const prev = memScores.get(k) ?? 0
  const best = Math.max(prev, score)
  memScores.set(k, best)
  return { best, improved: best > prev }
}

export async function getBestScore(opts: {
  network: string
  address: string
  game: string
  dayUtc?: string
}): Promise<number> {
  const day = opts.dayUtc ?? arcadeUtcDay()
  const address = opts.address.trim()

  if (isDbConfigured()) {
    try {
      await ensureTables()
      const sql = getSql()
      const rows = await sql`
        SELECT score FROM arcade_scores
        WHERE network = ${opts.network}
          AND address = ${address}
          AND game = ${opts.game}
          AND day_utc = ${day}::date
        LIMIT 1
      `
      if (rows[0]) return Number(rows[0].score)
    } catch (e) {
      console.warn('[arcade-store] getBestScore db failed:', e)
    }
  }

  return memScores.get(scoreKey(opts.network, address, opts.game, day)) ?? 0
}

export interface LeaderboardEntry {
  rank: number
  address: string
  game: string
  score: number
  updatedAt?: string
}

export async function getLeaderboard(opts: {
  network: string
  game?: string
  dayUtc?: string
  limit?: number
}): Promise<LeaderboardEntry[]> {
  const day = opts.dayUtc ?? arcadeUtcDay()
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25))

  if (isDbConfigured()) {
    try {
      await ensureTables()
      const sql = getSql()
      const rows = opts.game
        ? await sql`
            SELECT address, game, score, updated_at
            FROM arcade_scores
            WHERE network = ${opts.network}
              AND game = ${opts.game}
              AND day_utc = ${day}::date
            ORDER BY score DESC
            LIMIT ${limit}
          `
        : await sql`
            SELECT address, game, score, updated_at
            FROM arcade_scores
            WHERE network = ${opts.network}
              AND day_utc = ${day}::date
            ORDER BY score DESC
            LIMIT ${limit}
          `
      return rows.map((r, i) => ({
        rank: i + 1,
        address: String(r.address),
        game: String(r.game),
        score: Number(r.score),
        updatedAt: r.updated_at ? String(r.updated_at) : undefined,
      }))
    } catch (e) {
      console.warn('[arcade-store] leaderboard db failed:', e)
    }
  }

  // Memory fallback
  const prefix = `${opts.network}|`
  const entries: LeaderboardEntry[] = []
  for (const [k, score] of memScores) {
    if (!k.startsWith(prefix) || !k.endsWith(`|${day}`)) continue
    const parts = k.split('|')
    const address = parts[1]
    const game = parts[2]
    if (opts.game && game !== opts.game) continue
    entries.push({ rank: 0, address, game, score })
  }
  entries.sort((a, b) => b.score - a.score)
  return entries.slice(0, limit).map((e, i) => ({ ...e, rank: i + 1 }))
}

export interface GameClaimQuota {
  ok: boolean
  reason?: 'game_claimed' | 'daily_game_cap' | 'ok'
  claimsThisGameToday: number
  claimsTotalToday: number
  remainingGame: number
  remainingTotal: number
}

export async function peekGameClaimQuota(opts: {
  network: string
  address: string
  game: string
  dayUtc?: string
}): Promise<GameClaimQuota> {
  const day = opts.dayUtc ?? arcadeUtcDay()
  const address = opts.address.trim()

  let claimsThisGameToday = 0
  let claimsTotalToday = 0

  if (isDbConfigured()) {
    try {
      await ensureTables()
      const sql = getSql()
      const gameRows = await sql`
        SELECT COUNT(*)::int AS c FROM arcade_claims
        WHERE network = ${opts.network}
          AND address = ${address}
          AND game = ${opts.game}
          AND day_utc = ${day}::date
      `
      const totalRows = await sql`
        SELECT COUNT(*)::int AS c FROM arcade_claims
        WHERE network = ${opts.network}
          AND address = ${address}
          AND day_utc = ${day}::date
      `
      claimsThisGameToday = Number(gameRows[0]?.c ?? 0)
      claimsTotalToday = Number(totalRows[0]?.c ?? 0)
    } catch (e) {
      console.warn('[arcade-store] peek claims db failed:', e)
    }
  } else {
    claimsThisGameToday =
      memClaims.get(claimKey(opts.network, address, opts.game, day)) ?? 0
    let total = 0
    for (const g of GAME_SLUGS) {
      total += memClaims.get(claimKey(opts.network, address, g, day)) ?? 0
    }
    claimsTotalToday = total
  }

  if (claimsThisGameToday >= GAME_CLAIMS_PER_GAME_PER_DAY) {
    return {
      ok: false,
      reason: 'game_claimed',
      claimsThisGameToday,
      claimsTotalToday,
      remainingGame: 0,
      remainingTotal: Math.max(0, GAME_CLAIMS_TOTAL_PER_DAY - claimsTotalToday),
    }
  }
  if (claimsTotalToday >= GAME_CLAIMS_TOTAL_PER_DAY) {
    return {
      ok: false,
      reason: 'daily_game_cap',
      claimsThisGameToday,
      claimsTotalToday,
      remainingGame: Math.max(
        0,
        GAME_CLAIMS_PER_GAME_PER_DAY - claimsThisGameToday,
      ),
      remainingTotal: 0,
    }
  }

  return {
    ok: true,
    reason: 'ok',
    claimsThisGameToday,
    claimsTotalToday,
    remainingGame: GAME_CLAIMS_PER_GAME_PER_DAY - claimsThisGameToday,
    remainingTotal: GAME_CLAIMS_TOTAL_PER_DAY - claimsTotalToday,
  }
}

export async function logGameClaim(opts: {
  network: string
  address: string
  game: string
  scoreAtClaim: number
  amountQxrp: number
  txHash: string
  dayUtc?: string
}): Promise<void> {
  const day = opts.dayUtc ?? arcadeUtcDay()
  const address = opts.address.trim()

  if (isDbConfigured()) {
    try {
      await ensureTables()
      const sql = getSql()
      await sql`
        INSERT INTO arcade_claims (
          network, address, game, day_utc, score_at_claim, amount_qxrp, tx_hash
        ) VALUES (
          ${opts.network},
          ${address},
          ${opts.game},
          ${day}::date,
          ${opts.scoreAtClaim},
          ${opts.amountQxrp},
          ${opts.txHash}
        )
      `
      return
    } catch (e) {
      console.warn('[arcade-store] log claim db failed:', e)
    }
  }

  const k = claimKey(opts.network, address, opts.game, day)
  memClaims.set(k, (memClaims.get(k) ?? 0) + 1)
  console.info(
    '[arcade-claim]',
    JSON.stringify({ ...opts, dayUtc: day, ts: new Date().toISOString() }),
  )
}
