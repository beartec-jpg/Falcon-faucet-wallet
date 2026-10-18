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

/**
 * Claim threshold. Run scores ACCUMULATE: the sum of the day's runs for a game
 * (since the last claim) must reach this; each claim consumes this many points.
 * The leaderboard still ranks the best single run.
 */
export const GAME_FAUCET_MIN_SCORE = parseInt(
  process.env.GAME_FAUCET_MIN_SCORE ?? '500',
  10,
)

/**
 * Most a single run can add to claim progress (sanity cap; the leaderboard best
 * is not capped by this). Default = the claim threshold, so one run can unlock
 * at most one claim.
 */
export const GAME_MAX_RUN_CREDIT = parseInt(
  process.env.GAME_MAX_RUN_CREDIT ?? String(GAME_FAUCET_MIN_SCORE),
  10,
)

/** Max runs per address/game/UTC day that may add to claim progress. */
export const GAME_MAX_RUNS_PER_DAY = parseInt(
  process.env.GAME_MAX_RUNS_PER_DAY ?? '300',
  10,
)

/** Optional client run id (one per run). Absent → a score drop starts a new run. */
export function normalizeRunId(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : ''
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : ''
}

/** Per (network, address, game, day) claim-progress state. */
export interface RunProgressState {
  /** Points banked toward claims since the last claim (sum of run credits − consumed). */
  progress: number
  /** Current run id ('' = legacy client without run ids). */
  runId: string
  /** Latest score reported for the current run. */
  runScore: number
  /** Points the current run has already added to progress (≤ GAME_MAX_RUN_CREDIT). */
  runCredit: number
  /** Runs counted today. */
  runs: number
}

export const EMPTY_RUN_STATE: RunProgressState = {
  progress: 0,
  runId: '',
  runScore: 0,
  runCredit: 0,
  runs: 0,
}

/**
 * Pure accumulation step (mirrors the SQL upsert). Scores are reported
 * repeatedly during a run, so only the increase within a run is credited.
 * A new run is a different run id, or (legacy, no id) a score below the last.
 */
export function applyRunScore(
  prev: RunProgressState,
  scoreIn: number,
  runIdIn: string,
  caps: { maxRunCredit?: number; maxRuns?: number } = {},
): RunProgressState {
  const maxCredit = caps.maxRunCredit ?? GAME_MAX_RUN_CREDIT
  const maxRuns = caps.maxRuns ?? GAME_MAX_RUNS_PER_DAY
  const score = Math.floor(Math.max(0, scoreIn))
  const runId = runIdIn
  const first = prev.runs === 0 && prev.runScore === 0 && prev.runId === ''
  const newRun =
    first ||
    (runId !== '' ? runId !== prev.runId : prev.runId !== '' || score < prev.runScore)
  const credit = Math.min(score, maxCredit)
  if (newRun) {
    const counted = prev.runs < maxRuns
    return {
      progress: prev.progress + (counted ? credit : 0),
      runId,
      runScore: score,
      // Uncounted runs are marked as fully credited so they never add later.
      runCredit: counted ? credit : maxCredit,
      runs: prev.runs + 1,
    }
  }
  const delta = Math.max(0, credit - prev.runCredit)
  return {
    ...prev,
    progress: prev.progress + delta,
    runScore: Math.max(prev.runScore, score),
    runCredit: prev.runCredit + delta,
  }
}

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
const memProgress = new Map<string, RunProgressState>()

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
  // Falcon PL account that played (for the testnet activity tracker).
  await sql`ALTER TABLE arcade_scores ADD COLUMN IF NOT EXISTS pl_account TEXT`
  // Accumulated claim progress (sum of runs since last claim) — see applyRunScore.
  await sql`ALTER TABLE arcade_scores ADD COLUMN IF NOT EXISTS progress DOUBLE PRECISION NOT NULL DEFAULT 0`
  await sql`ALTER TABLE arcade_scores ADD COLUMN IF NOT EXISTS run_id TEXT NOT NULL DEFAULT ''`
  await sql`ALTER TABLE arcade_scores ADD COLUMN IF NOT EXISTS run_score DOUBLE PRECISION NOT NULL DEFAULT 0`
  await sql`ALTER TABLE arcade_scores ADD COLUMN IF NOT EXISTS run_credit DOUBLE PRECISION NOT NULL DEFAULT 0`
  await sql`ALTER TABLE arcade_scores ADD COLUMN IF NOT EXISTS runs INTEGER NOT NULL DEFAULT 0`
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

/**
 * Record a reported run score: best single run (leaderboard, only increases)
 * and accumulated claim progress (applyRunScore semantics, done atomically in SQL).
 */
export async function upsertArcadeScore(opts: {
  network: string
  address: string
  game: string
  score: number
  /** Client run id (normalizeRunId); '' for legacy clients. */
  runId?: string
  dayUtc?: string
  /** Falcon PL account name of the player, when the wallet has one. */
  plAccount?: string
}): Promise<{ best: number; improved: boolean; progress: number; runs: number }> {
  const day = opts.dayUtc ?? arcadeUtcDay()
  const score = Math.floor(Math.max(0, opts.score))
  const address = opts.address.trim()
  const runId = normalizeRunId(opts.runId)
  const credit = Math.min(score, GAME_MAX_RUN_CREDIT)

  if (isDbConfigured()) {
    try {
      await ensureTables()
      const sql = getSql()
      // All right-hand sides read the OLD row, so this is one atomic applyRunScore.
      const rows = await sql`
        INSERT INTO arcade_scores (
          network, address, game, day_utc, score, pl_account,
          progress, run_id, run_score, run_credit, runs
        )
        VALUES (
          ${opts.network}, ${address}, ${opts.game}, ${day}::date, ${score},
          ${opts.plAccount ?? null},
          ${credit}, ${runId}, ${score}, ${credit}, 1
        )
        ON CONFLICT (network, address, game, day_utc)
        DO UPDATE SET
          score = GREATEST(arcade_scores.score, EXCLUDED.score),
          pl_account = COALESCE(EXCLUDED.pl_account, arcade_scores.pl_account),
          progress = arcade_scores.progress + CASE
            WHEN (CASE WHEN EXCLUDED.run_id <> '' THEN EXCLUDED.run_id <> arcade_scores.run_id
                       ELSE arcade_scores.run_id <> '' OR EXCLUDED.run_score < arcade_scores.run_score END)
            THEN CASE WHEN arcade_scores.runs < ${GAME_MAX_RUNS_PER_DAY} THEN EXCLUDED.run_credit ELSE 0 END
            ELSE GREATEST(0, EXCLUDED.run_credit - arcade_scores.run_credit)
          END,
          run_credit = CASE
            WHEN (CASE WHEN EXCLUDED.run_id <> '' THEN EXCLUDED.run_id <> arcade_scores.run_id
                       ELSE arcade_scores.run_id <> '' OR EXCLUDED.run_score < arcade_scores.run_score END)
            THEN CASE WHEN arcade_scores.runs < ${GAME_MAX_RUNS_PER_DAY} THEN EXCLUDED.run_credit ELSE ${GAME_MAX_RUN_CREDIT} END
            ELSE GREATEST(arcade_scores.run_credit, EXCLUDED.run_credit)
          END,
          run_score = CASE
            WHEN (CASE WHEN EXCLUDED.run_id <> '' THEN EXCLUDED.run_id <> arcade_scores.run_id
                       ELSE arcade_scores.run_id <> '' OR EXCLUDED.run_score < arcade_scores.run_score END)
            THEN EXCLUDED.run_score
            ELSE GREATEST(arcade_scores.run_score, EXCLUDED.run_score)
          END,
          runs = arcade_scores.runs + CASE
            WHEN (CASE WHEN EXCLUDED.run_id <> '' THEN EXCLUDED.run_id <> arcade_scores.run_id
                       ELSE arcade_scores.run_id <> '' OR EXCLUDED.run_score < arcade_scores.run_score END)
            THEN 1 ELSE 0
          END,
          run_id = EXCLUDED.run_id,
          updated_at = NOW()
        RETURNING score, progress, runs
      `
      const best = Number(rows[0]?.score ?? score)
      return {
        best,
        improved: best === score && score > 0,
        progress: Number(rows[0]?.progress ?? 0),
        runs: Number(rows[0]?.runs ?? 0),
      }
    } catch (e) {
      console.warn('[arcade-store] upsert db failed, using memory:', e)
    }
  }

  const k = scoreKey(opts.network, address, opts.game, day)
  const prev = memScores.get(k) ?? 0
  const best = Math.max(prev, score)
  memScores.set(k, best)
  const st = applyRunScore(memProgress.get(k) ?? EMPTY_RUN_STATE, score, runId)
  memProgress.set(k, st)
  return { best, improved: best > prev, progress: st.progress, runs: st.runs }
}

/** Accumulated claim progress for the day (since the last claim). */
export async function getClaimProgress(opts: {
  network: string
  address: string
  game: string
  dayUtc?: string
}): Promise<{ progress: number; runs: number }> {
  const day = opts.dayUtc ?? arcadeUtcDay()
  const address = opts.address.trim()
  if (isDbConfigured()) {
    try {
      await ensureTables()
      const rows = await getSql()`
        SELECT progress, runs FROM arcade_scores
        WHERE network = ${opts.network} AND address = ${address}
          AND game = ${opts.game} AND day_utc = ${day}::date
        LIMIT 1
      `
      return { progress: Number(rows[0]?.progress ?? 0), runs: Number(rows[0]?.runs ?? 0) }
    } catch (e) {
      console.warn('[arcade-store] getClaimProgress db failed:', e)
    }
  }
  const st = memProgress.get(scoreKey(opts.network, address, opts.game, day))
  return { progress: st?.progress ?? 0, runs: st?.runs ?? 0 }
}

/**
 * Atomically take `amount` points of progress for a claim. Returns false (and
 * takes nothing) if progress is below `amount` — prevents concurrent double spend.
 */
export async function consumeClaimProgress(opts: {
  network: string
  address: string
  game: string
  amount?: number
  dayUtc?: string
}): Promise<{ ok: boolean; progress: number }> {
  const day = opts.dayUtc ?? arcadeUtcDay()
  const address = opts.address.trim()
  const amount = opts.amount ?? GAME_FAUCET_MIN_SCORE
  if (isDbConfigured()) {
    try {
      await ensureTables()
      const rows = await getSql()`
        UPDATE arcade_scores SET progress = progress - ${amount}, updated_at = NOW()
        WHERE network = ${opts.network} AND address = ${address}
          AND game = ${opts.game} AND day_utc = ${day}::date
          AND progress >= ${amount}
        RETURNING progress
      `
      if (rows[0]) return { ok: true, progress: Number(rows[0].progress) }
      const cur = await getClaimProgress({ ...opts, dayUtc: day })
      return { ok: false, progress: cur.progress }
    } catch (e) {
      console.warn('[arcade-store] consumeClaimProgress db failed:', e)
    }
  }
  const k = scoreKey(opts.network, address, opts.game, day)
  const st = memProgress.get(k) ?? EMPTY_RUN_STATE
  if (st.progress < amount) return { ok: false, progress: st.progress }
  const next = { ...st, progress: st.progress - amount }
  memProgress.set(k, next)
  return { ok: true, progress: next.progress }
}

/** Give back consumed progress (payment failed after consumeClaimProgress). */
export async function refundClaimProgress(opts: {
  network: string
  address: string
  game: string
  amount?: number
  dayUtc?: string
}): Promise<void> {
  const day = opts.dayUtc ?? arcadeUtcDay()
  const address = opts.address.trim()
  const amount = opts.amount ?? GAME_FAUCET_MIN_SCORE
  if (isDbConfigured()) {
    try {
      await ensureTables()
      await getSql()`
        UPDATE arcade_scores SET progress = progress + ${amount}, updated_at = NOW()
        WHERE network = ${opts.network} AND address = ${address}
          AND game = ${opts.game} AND day_utc = ${day}::date
      `
      return
    } catch (e) {
      console.warn('[arcade-store] refundClaimProgress db failed:', e)
    }
  }
  const k = scoreKey(opts.network, address, opts.game, day)
  const st = memProgress.get(k)
  if (st) memProgress.set(k, { ...st, progress: st.progress + amount })
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

const memReservations = new Map<
  string,
  { network: string; address: string; game: string; day: string }
>()

/**
 * Reserve a claim slot before paying (re-checks quota at insert time).
 * Prevents concurrent double-claims past daily caps.
 */
export async function reserveGameClaim(opts: {
  network: string
  address: string
  game: string
  scoreAtClaim: number
  dayUtc?: string
}): Promise<
  | { ok: true; reservationId: string; quota: GameClaimQuota }
  | { ok: false; reason: GameClaimQuota['reason']; quota: GameClaimQuota }
> {
  const day = opts.dayUtc ?? arcadeUtcDay()
  const address = opts.address.trim()
  const reservationId = `reserved:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`

  const quota = await peekGameClaimQuota({
    network: opts.network,
    address,
    game: opts.game,
    dayUtc: day,
  })
  if (!quota.ok) {
    return { ok: false, reason: quota.reason, quota }
  }

  if (isDbConfigured()) {
    try {
      await ensureTables()
      const sql = getSql()
      // Re-count inside a short critical section: insert only if still under caps.
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
      const gameCount = Number(gameRows[0]?.c ?? 0)
      const totalCount = Number(totalRows[0]?.c ?? 0)
      if (gameCount >= GAME_CLAIMS_PER_GAME_PER_DAY) {
        return {
          ok: false,
          reason: 'game_claimed',
          quota: { ...quota, ok: false, reason: 'game_claimed', remainingGame: 0 },
        }
      }
      if (totalCount >= GAME_CLAIMS_TOTAL_PER_DAY) {
        return {
          ok: false,
          reason: 'daily_game_cap',
          quota: { ...quota, ok: false, reason: 'daily_game_cap', remainingTotal: 0 },
        }
      }
      await sql`
        INSERT INTO arcade_claims (
          network, address, game, day_utc, score_at_claim, amount_qxrp, tx_hash
        ) VALUES (
          ${opts.network},
          ${address},
          ${opts.game},
          ${day}::date,
          ${opts.scoreAtClaim},
          ${0},
          ${reservationId}
        )
      `
      return { ok: true, reservationId, quota }
    } catch (e) {
      console.warn('[arcade-store] reserve claim db failed:', e)
    }
  }

  // Memory path: re-check then bump
  const k = claimKey(opts.network, address, opts.game, day)
  const thisGame = memClaims.get(k) ?? 0
  let total = 0
  for (const g of GAME_SLUGS) {
    total += memClaims.get(claimKey(opts.network, address, g, day)) ?? 0
  }
  if (thisGame >= GAME_CLAIMS_PER_GAME_PER_DAY) {
    return {
      ok: false,
      reason: 'game_claimed',
      quota: { ...quota, ok: false, reason: 'game_claimed' },
    }
  }
  if (total >= GAME_CLAIMS_TOTAL_PER_DAY) {
    return {
      ok: false,
      reason: 'daily_game_cap',
      quota: { ...quota, ok: false, reason: 'daily_game_cap' },
    }
  }
  memClaims.set(k, thisGame + 1)
  memReservations.set(reservationId, {
    network: opts.network,
    address,
    game: opts.game,
    day,
  })
  return { ok: true, reservationId, quota }
}

/** Finalize a reserved claim after successful payment. */
export async function finalizeGameClaim(opts: {
  reservationId: string
  amountQxrp: number
  txHash: string
  scoreAtClaim: number
}): Promise<void> {
  if (isDbConfigured()) {
    try {
      await ensureTables()
      const sql = getSql()
      await sql`
        UPDATE arcade_claims
        SET amount_qxrp = ${opts.amountQxrp},
            tx_hash = ${opts.txHash},
            score_at_claim = ${opts.scoreAtClaim}
        WHERE tx_hash = ${opts.reservationId}
      `
      return
    } catch (e) {
      console.warn('[arcade-store] finalize claim db failed:', e)
    }
  }
  memReservations.delete(opts.reservationId)
  console.info(
    '[arcade-claim]',
    JSON.stringify({ ...opts, ts: new Date().toISOString() }),
  )
}

/** Drop a reservation if payment failed (frees the slot). */
export async function releaseGameClaim(reservationId: string): Promise<void> {
  if (isDbConfigured()) {
    try {
      await ensureTables()
      const sql = getSql()
      await sql`
        DELETE FROM arcade_claims WHERE tx_hash = ${reservationId}
      `
    } catch (e) {
      console.warn('[arcade-store] release claim db failed:', e)
    }
  }
  const meta = memReservations.get(reservationId)
  if (meta) {
    const k = claimKey(meta.network, meta.address, meta.game, meta.day)
    const n = memClaims.get(k) ?? 0
    if (n > 0) memClaims.set(k, n - 1)
    memReservations.delete(reservationId)
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

/** Max successful game claims across ALL addresses per network per UTC day (0 = unlimited). */
export const GAME_GLOBAL_CLAIMS_PER_DAY = parseInt(
  process.env.GAME_GLOBAL_CLAIMS_PER_DAY ?? '500',
  10,
)

export async function countGlobalGameClaimsToday(
  network: string,
  dayUtc?: string,
): Promise<number> {
  const day = dayUtc ?? arcadeUtcDay()
  if (GAME_GLOBAL_CLAIMS_PER_DAY <= 0) return 0
  if (isDbConfigured()) {
    try {
      await ensureTables()
      const sql = getSql()
      const rows = await sql`
        SELECT COUNT(*)::int AS c FROM arcade_claims
        WHERE network = ${network}
          AND day_utc = ${day}::date
          AND tx_hash NOT LIKE 'reserved:%'
      `
      return Number(rows[0]?.c ?? 0)
    } catch (e) {
      console.warn('[arcade-store] global count failed:', e)
    }
  }
  let total = 0
  for (const [, n] of memClaims) total += n
  return total
}

/** Arcade days per Falcon PL account since a UTC day (testnet activity tracker). */
export async function arcadeDaysByPlAccount(network: string, sinceDay: string): Promise<{ account: string; game: string; day: string; score: number }[]> {
  if (!isDbConfigured()) return []
  try {
    await ensureTables()
    const rows = (await getSql()`
      SELECT pl_account, game, day_utc::text AS day, MAX(score) AS score FROM arcade_scores
      WHERE network = ${network} AND pl_account IS NOT NULL AND day_utc >= ${sinceDay}::date
      GROUP BY pl_account, game, day_utc`) as Record<string, unknown>[]
    return rows.map((r) => ({ account: String(r.pl_account), game: String(r.game), day: String(r.day), score: Number(r.score) }))
  } catch (e) {
    console.error('[arcade-store] tracker days', e)
    return []
  }
}
