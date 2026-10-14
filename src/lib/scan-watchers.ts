// Watcher pool summary for /api/scan (and the network map ring).
//
// "This epoch" = accounts in status.watcher_slots.
// "Live"       = accounts that heartbeated in the current slot. Preferred source is
//                a node-provided status.watchers_active_slot (array of accounts, or
//                a { slot, accounts } object). Until nodes ship it, we ask each
//                epoch account via account_query (watcher_in_slot = check_seen
//                'wslot:<account>'), cached ~30s so 1.5s polls never fan out.

import { plAccount } from '@/lib/pl-rpc'
import type { WatcherSummary } from '@/lib/scan-types'

const CACHE_MS = 30_000
/** Upper bound on account_query fan-out per refresh. */
const MAX_QUERY = 64

let cache: { at: number; slot: number; key: string; live: string[] } | null = null
let inflight: Promise<string[]> | null = null

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

export function activeFromStatusField(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.map(String)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (Array.isArray(o.accounts)) return o.accounts.map(String)
    // { account: true/false } map
    const ks = Object.entries(o).filter(([, x]) => x === true).map(([k]) => k)
    if (ks.length || Object.keys(o).length) return ks
  }
  return null
}

export async function watcherSummary(
  st: Record<string, unknown>,
  query: (account: string) => Promise<Record<string, unknown>> = plAccount,
  now = Date.now(),
): Promise<WatcherSummary> {
  const slots = (st.watcher_slots ?? {}) as Record<string, unknown>
  const work = (st.watcher_work ?? {}) as Record<string, unknown>
  const epoch = Object.keys(slots).sort()
  const slot = num(st.watcher_current_slot)
  const base = {
    epoch_accounts: epoch,
    work: Object.fromEntries(epoch.map((a) => [a, num(work[a])])),
    current_slot: slot,
    slot_ms: num(st.watcher_slot_ms),
    slots_per_epoch: num(st.watcher_slots_per_epoch),
  }

  const direct = activeFromStatusField(st.watchers_active_slot)
  if (direct) return { ...base, live: direct.sort(), source: 'status', checked_at: now }

  const key = epoch.join(',')
  if (cache && cache.slot === slot && cache.key === key && now - cache.at < CACHE_MS) {
    return { ...base, live: cache.live, source: 'account_query', checked_at: cache.at }
  }
  inflight ??= (async () => {
    const res = await Promise.allSettled(epoch.slice(0, MAX_QUERY).map((a) => query(a)))
    const live: string[] = []
    res.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value?.watcher_in_slot === true) live.push(epoch[i])
    })
    cache = { at: Date.now(), slot, key, live }
    return live
  })().finally(() => {
    inflight = null
  })
  try {
    const live = await inflight
    return { ...base, live, source: 'account_query', checked_at: cache?.at ?? now }
  } catch {
    return { ...base, live: cache?.live ?? [], source: 'account_query', checked_at: cache?.at ?? 0 }
  }
}

/** Test hook. */
export function _resetWatcherCache() {
  cache = null
  inflight = null
}
