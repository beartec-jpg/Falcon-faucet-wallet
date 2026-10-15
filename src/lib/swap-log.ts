// Swap log for the testnet activity tracker. The node exposes no per-account
// swap history, so the site records swaps (kind "swap_route") that its wallet
// submits through /api/wallet/submit and the node accepts. Neon table
// `tracker_swaps`; in-memory fallback when DATABASE_URL is unset.

import { getSql, isDbConfigured } from '@/lib/db'
import type { SwapRecord } from '@/lib/tracker'

const ACCOUNT_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const TOKEN_RE = /^[A-Z]{2,8}$/

/** Parse a signed PL tx JSON string; returns a swap record (without day) or null. */
export function parseSwapTx(txJson: string): (Omit<SwapRecord, 'day'> & { tx_id: string }) | null {
  let tx: Record<string, unknown>
  try {
    tx = JSON.parse(txJson) as Record<string, unknown>
  } catch {
    return null
  }
  const find = (o: unknown, depth = 0): Record<string, unknown> | null => {
    if (!o || typeof o !== 'object' || depth > 4) return null
    const r = o as Record<string, unknown>
    if (r.kind === 'swap_route') return r
    for (const v of Object.values(r)) {
      const hit = find(v, depth + 1)
      if (hit) return hit
    }
    return null
  }
  const body = find(tx)
  if (!body) return null
  const pick = (o: unknown, k: string, depth = 0): unknown => {
    if (!o || typeof o !== 'object' || depth > 4) return undefined
    const r = o as Record<string, unknown>
    if (k in r) return r[k]
    for (const v of Object.values(r)) {
      const hit = pick(v, k, depth + 1)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  const account = String(pick(tx, 'account') ?? '')
  const token_in = String(body.token_in ?? '')
  const amount_in = String(body.amount_in ?? '')
  const tx_id = String(pick(tx, 'tx_id') ?? '')
  if (!ACCOUNT_RE.test(account) || !TOKEN_RE.test(token_in) || !/^\d{1,30}$/.test(amount_in)) return null
  return { account, token_in, amount_in, tx_id: tx_id || `${account}:${pick(tx, 'sequence') ?? Date.now()}` }
}

const mem = new Map<string, SwapRecord>()
let ready = false

export async function recordSwap(txJson: string, now = Date.now()): Promise<boolean> {
  const p = parseSwapTx(txJson)
  if (!p) return false
  const day = new Date(now).toISOString().slice(0, 10)
  if (!isDbConfigured()) {
    mem.set(p.tx_id, { account: p.account, token_in: p.token_in, amount_in: p.amount_in, day })
    return true
  }
  try {
    const sql = getSql()
    if (!ready) {
      await sql`CREATE TABLE IF NOT EXISTS tracker_swaps (
        tx_id TEXT PRIMARY KEY, account TEXT NOT NULL, token_in TEXT NOT NULL,
        amount_in TEXT NOT NULL, day_utc DATE NOT NULL, at BIGINT NOT NULL)`
      await sql`CREATE INDEX IF NOT EXISTS tracker_swaps_day ON tracker_swaps (day_utc)`
      ready = true
    }
    await sql`INSERT INTO tracker_swaps (tx_id, account, token_in, amount_in, day_utc, at)
      VALUES (${p.tx_id}, ${p.account}, ${p.token_in}, ${p.amount_in}, ${day}::date, ${now})
      ON CONFLICT (tx_id) DO NOTHING`
    return true
  } catch (e) {
    console.error('[swap-log] record', e)
    return false
  }
}

export async function swapsSince(since: string): Promise<SwapRecord[]> {
  if (!isDbConfigured()) return [...mem.values()].filter((x) => x.day >= since)
  try {
    const rows = (await getSql()`SELECT account, token_in, amount_in, day_utc::text AS day FROM tracker_swaps WHERE day_utc >= ${since}::date`) as Record<string, unknown>[]
    return rows.map((r) => ({ account: String(r.account), token_in: String(r.token_in), amount_in: String(r.amount_in), day: String(r.day) }))
  } catch {
    return [] // table not created yet
  }
}
