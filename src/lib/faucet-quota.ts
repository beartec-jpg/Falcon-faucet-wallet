/**
 * Mainnet-oriented faucet quota:
 * - Max FAUCET_CLAIMS_PER_DAY successful drips per UTC calendar day (default 5)
 * - Min FAUCET_COOLDOWN_SECONDS between successful drips (default 3600 = 1 hour)
 *
 * Failed attempts do not consume quota (call only after ledger validation).
 * Every successful claim is logged for airdrop scoring (days + intensity).
 */

import { getSql, isDbConfigured } from '@/lib/db'

export const FAUCET_CLAIMS_PER_DAY = parseInt(process.env.FAUCET_CLAIMS_PER_DAY ?? '5', 10)
export const FAUCET_COOLDOWN_SECONDS = parseInt(process.env.FAUCET_COOLDOWN_SECONDS ?? '3600', 10)

export interface FaucetQuotaResult {
  success: boolean
  reason?: 'cooldown' | 'daily_cap' | 'ok'
  reset?: string
  remainingToday?: number
  claimsToday?: number
  cooldownEndsAt?: string
}

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

// ── In-memory fallback (single instance) ───────────────────────────────────

type MemEntry = {
  lastClaimAt: number
  day: string
  dayCount: number
}

const mem = new Map<string, MemEntry>()

function memPeek(key: string): FaucetQuotaResult {
  const now = Date.now()
  const day = utcDayKey()
  const e = mem.get(key)
  if (!e) {
    return {
      success: true,
      reason: 'ok',
      remainingToday: FAUCET_CLAIMS_PER_DAY,
      claimsToday: 0,
    }
  }

  if (e.lastClaimAt > 0) {
    const ends = e.lastClaimAt + FAUCET_COOLDOWN_SECONDS * 1000
    if (now < ends) {
      return {
        success: false,
        reason: 'cooldown',
        cooldownEndsAt: new Date(ends).toISOString(),
        reset: new Date(ends).toISOString(),
        remainingToday: e.day === day ? Math.max(0, FAUCET_CLAIMS_PER_DAY - e.dayCount) : FAUCET_CLAIMS_PER_DAY,
        claimsToday: e.day === day ? e.dayCount : 0,
      }
    }
  }

  const claimsToday = e.day === day ? e.dayCount : 0
  if (claimsToday >= FAUCET_CLAIMS_PER_DAY) {
    // next UTC midnight
    const next = new Date(`${day}T00:00:00.000Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    return {
      success: false,
      reason: 'daily_cap',
      reset: next.toISOString(),
      remainingToday: 0,
      claimsToday,
    }
  }

  return {
    success: true,
    reason: 'ok',
    remainingToday: FAUCET_CLAIMS_PER_DAY - claimsToday,
    claimsToday,
  }
}

function memConsume(key: string): void {
  const now = Date.now()
  const day = utcDayKey()
  const e = mem.get(key)
  if (!e || e.day !== day) {
    mem.set(key, { lastClaimAt: now, day, dayCount: 1 })
    return
  }
  e.lastClaimAt = now
  e.dayCount++
}

// ── Redis (Upstash) optional ───────────────────────────────────────────────

async function redisGet(key: string): Promise<string | null> {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  try {
    const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!r.ok) return null
    const j = (await r.json()) as { result?: string | null }
    return j.result ?? null
  } catch {
    return null
  }
}

async function redisSet(key: string, value: string, exSeconds: number): Promise<void> {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return
  try {
    await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?EX=${exSeconds}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
  } catch {
    /* ignore */
  }
}

function parseState(raw: string | null): MemEntry | null {
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as MemEntry
    if (typeof j.lastClaimAt === 'number' && typeof j.day === 'string') return j
  } catch {
    /* ignore */
  }
  return null
}

async function redisPeek(key: string): Promise<FaucetQuotaResult | null> {
  const raw = await redisGet(`faucet_q:${key}`)
  if (raw === null && !(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)) {
    return null // no redis
  }
  const e = parseState(raw)
  if (!e) {
    return {
      success: true,
      reason: 'ok',
      remainingToday: FAUCET_CLAIMS_PER_DAY,
      claimsToday: 0,
    }
  }
  // reuse memPeek logic by temporarily setting
  mem.set(key, e)
  return memPeek(key)
}

async function redisConsume(key: string): Promise<boolean> {
  if (!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)) return false
  const raw = await redisGet(`faucet_q:${key}`)
  const day = utcDayKey()
  const now = Date.now()
  let e = parseState(raw)
  if (!e || e.day !== day) {
    e = { lastClaimAt: now, day, dayCount: 1 }
  } else {
    e.lastClaimAt = now
    e.dayCount++
  }
  // TTL 2 days so day roll works
  await redisSet(`faucet_q:${key}`, JSON.stringify(e), 172800)
  mem.set(key, e)
  return true
}

export async function peekFaucetQuota(key: string): Promise<FaucetQuotaResult> {
  const fromRedis = await redisPeek(key)
  if (fromRedis) return fromRedis
  return memPeek(key)
}

export async function consumeFaucetQuota(key: string): Promise<void> {
  const used = await redisConsume(key)
  if (!used) memConsume(key)
}

export interface FaucetClaimLog {
  network: string
  address: string
  amountQxrp: number
  txHash: string
  ipHash?: string
  dayUtc: string
}

/** Durable log for airdrop scoring (days + intensity). Best-effort. */
export async function logFaucetClaim(row: FaucetClaimLog): Promise<void> {
  if (!isDbConfigured()) {
    console.info(
      '[faucet-claim]',
      JSON.stringify({ ...row, ts: new Date().toISOString() }),
    )
    return
  }
  try {
    const sql = getSql()
    await sql`
      CREATE TABLE IF NOT EXISTS faucet_claims (
        id BIGSERIAL PRIMARY KEY,
        network TEXT NOT NULL,
        address TEXT NOT NULL,
        amount_qxrp DOUBLE PRECISION NOT NULL,
        tx_hash TEXT NOT NULL,
        ip_hash TEXT,
        day_utc DATE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    await sql`
      CREATE INDEX IF NOT EXISTS faucet_claims_addr_day
      ON faucet_claims (network, address, day_utc)
    `
    await sql`
      INSERT INTO faucet_claims (network, address, amount_qxrp, tx_hash, ip_hash, day_utc)
      VALUES (
        ${row.network},
        ${row.address},
        ${row.amountQxrp},
        ${row.txHash},
        ${row.ipHash ?? null},
        ${row.dayUtc}::date
      )
    `
  } catch (e) {
    console.warn('[faucet-claim] db log failed:', e)
    console.info(
      '[faucet-claim]',
      JSON.stringify({ ...row, ts: new Date().toISOString() }),
    )
  }
}

export async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip + (process.env.FAUCET_IP_SALT ?? 'falcon-faucet'))
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

/** UTC day key for logging. */
export function faucetUtcDay(d = new Date()): string {
  return utcDayKey(d)
}
