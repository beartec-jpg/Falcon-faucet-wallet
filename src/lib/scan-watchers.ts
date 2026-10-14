// Watcher pool summary for /api/scan (and the network map ring).
//
// "This epoch" = accounts in status.watcher_slots.
// "Live"       = accounts that heartbeated in the current slot.
//   1. Preferred: node field status.watchers_active_slot (Falcon-PL PR #97):
//      an array of accounts, a { slot, accounts } object or an { account: bool } map.
//   2. Fallback: account_query's watcher_in_slot is always false on node 2.9.63,
//      so we detect heartbeats from watcher_slots counters instead. A heartbeat
//      credits the account one slot, so an account is live when its count rose
//      during the current slot. Per-account {count, slot it last rose in} is kept
//      in Neon (explorer_watcher_state) when DATABASE_URL is set, else in memory,
//      and refreshed at most every ~30s.
//   Caveat: an account seen for the first time is not live until we observe its
//   count rise, i.e. up to one slot after deploy or first appearance.

import type { WatcherSummary } from '@/lib/scan-types'
import { getSql, isDbConfigured } from '@/lib/db'

const CACHE_MS = 30_000

export interface WatcherRow {
  slots: number
  /** Absolute slot index in which `slots` last increased (null = never observed). */
  rose_in: number | null
}

export interface WatcherStateStore {
  load(): Promise<Record<string, WatcherRow>>
  save(changed: Record<string, WatcherRow>): Promise<void>
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

export function memoryStore(): WatcherStateStore {
  const m: Record<string, WatcherRow> = {}
  return {
    load: async () => ({ ...m }),
    save: async (c) => void Object.assign(m, c),
  }
}

let pgReady = false
function pgStore(): WatcherStateStore {
  const sql = getSql()
  const ensure = async () => {
    if (pgReady) return
    await sql`CREATE TABLE IF NOT EXISTS explorer_watcher_state (
      account TEXT PRIMARY KEY,
      slots BIGINT NOT NULL,
      rose_in BIGINT,
      updated_at BIGINT NOT NULL
    )`
    pgReady = true
  }
  return {
    async load() {
      await ensure()
      const rows = await sql`SELECT account, slots, rose_in FROM explorer_watcher_state`
      const out: Record<string, WatcherRow> = {}
      for (const r of rows) out[String(r.account)] = { slots: Number(r.slots), rose_in: r.rose_in == null ? null : Number(r.rose_in) }
      return out
    },
    async save(changed) {
      await ensure()
      const now = Date.now()
      for (const [a, r] of Object.entries(changed)) {
        await sql`INSERT INTO explorer_watcher_state (account, slots, rose_in, updated_at)
          VALUES (${a}, ${r.slots}, ${r.rose_in}, ${now})
          ON CONFLICT (account) DO UPDATE SET slots = EXCLUDED.slots, rose_in = EXCLUDED.rose_in, updated_at = EXCLUDED.updated_at`
      }
    },
  }
}

let defaultStore: WatcherStateStore | null = null
function store(): WatcherStateStore {
  defaultStore ??= isDbConfigured() ? pgStore() : memoryStore()
  return defaultStore
}

export function activeFromStatusField(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.map(String)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (Array.isArray(o.accounts)) return o.accounts.map(String)
    const entries = Object.entries(o)
    if (entries.length && entries.every(([, x]) => typeof x === 'boolean')) return entries.filter(([, x]) => x).map(([k]) => k)
  }
  return null
}

/** Absolute slot index (does not wrap at epoch boundaries). */
export function absoluteSlot(st: Record<string, unknown>): number {
  const slotMs = num(st.watcher_slot_ms)
  const now = num(st.now_ms)
  if (slotMs > 0 && now > 0) return Math.floor((now - num(st.genesis_ms)) / slotMs)
  return num(st.watcher_current_slot)
}

/** Pure step: fold the status counts into the per-account state; return live + changed rows. */
export function stepWatcherState(
  prev: Record<string, WatcherRow>,
  counts: Record<string, number>,
  slot: number,
): { live: string[]; changed: Record<string, WatcherRow> } {
  const changed: Record<string, WatcherRow> = {}
  const live: string[] = []
  for (const [a, c] of Object.entries(counts)) {
    const p = prev[a]
    let row: WatcherRow
    if (!p) row = { slots: c, rose_in: null }
    else if (c > p.slots) row = { slots: c, rose_in: slot }
    else if (c < p.slots) row = { slots: c, rose_in: p.rose_in } // epoch reset / different seat
    else row = p
    if (!p || row.slots !== p.slots || row.rose_in !== p.rose_in) changed[a] = row
    if (row.rose_in === slot) live.push(a)
  }
  return { live: live.sort(), changed }
}

let cache: { at: number; slot: number; live: string[] } | null = null
let inflight: Promise<string[]> | null = null

export async function watcherSummary(
  st: Record<string, unknown>,
  opts: { store?: WatcherStateStore; now?: number; cacheMs?: number } = {},
): Promise<WatcherSummary> {
  const now = opts.now ?? Date.now()
  const slots = (st.watcher_slots ?? {}) as Record<string, unknown>
  const work = (st.watcher_work ?? {}) as Record<string, unknown>
  const epoch = Object.keys(slots).sort()
  const base = {
    epoch_accounts: epoch,
    work: Object.fromEntries(epoch.map((a) => [a, num(work[a])])),
    slots: Object.fromEntries(epoch.map((a) => [a, num(slots[a])])),
    current_slot: num(st.watcher_current_slot),
    slot_ms: num(st.watcher_slot_ms),
    slots_per_epoch: num(st.watcher_slots_per_epoch),
  }

  const direct = activeFromStatusField(st.watchers_active_slot)
  if (direct) return { ...base, live: direct.sort(), source: 'status', checked_at: now }

  const slot = absoluteSlot(st)
  const ttl = opts.cacheMs ?? CACHE_MS
  if (cache && cache.slot === slot && now - cache.at < ttl) {
    return { ...base, live: cache.live, source: 'slot_counts', checked_at: cache.at }
  }
  const s = opts.store ?? store()
  inflight ??= (async () => {
    const prev = await s.load()
    const { live, changed } = stepWatcherState(prev, base.slots, slot)
    if (Object.keys(changed).length) await s.save(changed)
    cache = { at: now, slot, live }
    return live
  })().finally(() => {
    inflight = null
  })
  try {
    const live = await inflight
    return { ...base, live, source: 'slot_counts', checked_at: now }
  } catch {
    return { ...base, live: cache?.live ?? [], source: 'slot_counts', checked_at: cache?.at ?? 0 }
  }
}

/** Test hook. */
export function _resetWatcherCache() {
  cache = null
  inflight = null
}
