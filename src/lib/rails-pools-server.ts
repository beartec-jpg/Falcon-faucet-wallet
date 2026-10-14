// Server side of the Rails / Pools / Activity tabs: one exact status_req, a
// capped set of account_query calls, the public bridge config, and the
// activity index. Cached 30 s so tab switches do not hit the node.

import bridgeConfig from '../../public/config/pl-2300-bridge.json'
import { BITVM2_KICKOFF_FEE_SATS, BITVM2_MIN_PEGOUT_SATS } from '@/lib/btc-spv-policy'
import { plRpc } from '@/lib/pl-rpc'
import { parseExact } from '@/lib/pl-exact-json'
import {
  activityStore,
  exclusionSet,
  indexActivity,
  pickAccounts,
  pricesFpl,
  scoreBoard,
  snapshotFromAccountQuery,
  type AccountSnapshot,
  type ActivityStore,
  type BoardRow,
} from '@/lib/activity-index'
import { buildPools, buildRails, lpCandidates, type PoolView, type RailView } from '@/lib/rails-pools'

type Obj = Record<string, unknown>
const BTC_CSV_BLOCKS = 6

export async function statusExact(): Promise<Obj> {
  const r = await plRpc({ type: 'status_req', include_accounts: false, brief: true })
  if (r.type === 'err') throw new Error(String(r.msg ?? 'status error'))
  const raw = typeof r.raw === 'string' ? r.raw : JSON.stringify(r)
  return ((parseExact(raw) as Obj).body ?? {}) as Obj
}

async function accountSnapshot(account: string): Promise<AccountSnapshot | null> {
  try {
    const r = await plRpc({ type: 'account_query', account }, { timeoutMs: 8000 })
    if (r.type === 'err') return null
    const raw = typeof r.raw === 'string' ? r.raw : JSON.stringify(r)
    const body = ((parseExact(raw) as Obj).body ?? {}) as Obj
    if (body.exists === false) return null
    return snapshotFromAccountQuery(account, body)
  } catch {
    return null
  }
}

async function snapshots(names: string[], parallel = 6): Promise<AccountSnapshot[]> {
  const out: AccountSnapshot[] = []
  for (let i = 0; i < names.length; i += parallel) {
    const got = await Promise.all(names.slice(i, i + parallel).map(accountSnapshot))
    for (const g of got) if (g) out.push(g)
  }
  return out
}

export interface RailsPoolsPayload {
  generated_at: number
  height: number
  rails: RailView[]
  pools: PoolView[]
  activity: { rows: BoardRow[]; excluded: number; indexed_accounts: number; events: number }
  sources: Record<string, string>
}

let cache: { at: number; data: RailsPoolsPayload } | null = null
const CACHE_MS = 30_000

export async function getRailsPools(opts: { store?: ActivityStore; now?: number; status?: Obj; snaps?: AccountSnapshot[] } = {}): Promise<RailsPoolsPayload> {
  const now = opts.now ?? Date.now()
  if (!opts.status && cache && now - cache.at < CACHE_MS) return cache.data
  const store = opts.store ?? activityStore()
  const st = opts.status ?? (await statusExact())
  const [events, accounts, samples] = await Promise.all([store.events(), store.accounts(), store.poolSamples(now - 24 * 3600_000)])
  const snaps = opts.snaps ?? (await snapshots(lpCandidates(st).slice(0, 25)))
  const rails = buildRails(st, {
    config: bridgeConfig,
    btcPolicy: { kickoffFeeSats: BITVM2_KICKOFF_FEE_SATS, minPegoutSats: BITVM2_MIN_PEGOUT_SATS, csvBlocks: BTC_CSV_BLOCKS },
    history: events,
  })
  const pools = buildPools(st, snaps.flatMap((x) => x.lp), samples, now)
  const board = scoreBoard(accounts, events, pricesFpl(st), exclusionSet(st))
  const data: RailsPoolsPayload = {
    generated_at: now,
    height: Number(st.tip_height) || 0,
    rails,
    pools,
    activity: { ...board, rows: board.rows.slice(0, 50), indexed_accounts: accounts.length, events: events.length },
    sources: {
      rails: 'status_req: rails[], eth_v3_resolutions, eth_v3_bridge, eth_lc, watcher_slots',
      contracts: 'status.eth_v3_bridge + public/config/pl-2300-bridge.json',
      pools: 'status_req: defi_pools; LP holders via account_query of accounts in amm/lend LP weight maps',
      prices: 'status_req: defi_markets[].price_fpl',
      history: 'activity index (5-min cron): rail events, pool reserve samples, account snapshots',
    },
  }
  if (!opts.status) cache = { at: now, data }
  return data
}

/** Cron hook: index rail events, pool samples and account activity. */
export async function runActivityIndex(now = Date.now(), store: ActivityStore = activityStore()) {
  const st = await statusExact()
  const known = await store.accounts()
  const evAccounts = (await store.events()).map((e) => e.account)
  const names = pickAccounts([...lpCandidates(st), ...evAccounts, ...known.map((a) => a.account)], known)
  const snaps = await snapshots(names)
  return indexActivity(st, snaps, now, store)
}

export function _resetRailsPoolsCache() {
  cache = null
}
