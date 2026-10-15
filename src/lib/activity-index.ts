// Testnet activity index: per-address usage recorded by the 5-min cron from
// the same public status_req / account_query the explorer already uses.
//
//   bridging      – peg-ins / peg-outs seen on the rails (exact amounts, deduped by chain id)
//   swaps         – not in the node per account; logged by /api/wallet/submit (lib/swap-log.ts)
//   LP            – time-weighted FPL value of AMM LP positions (FPL·hours)
//   lending       – time-weighted FPL value of lend supply positions (FPL·hours)
//   tx count      – account sequence
// Sybil handling: validators + bond accounts, watcher-*, the faucet and loadgen
// wallets are excluded from ranking; every component is capped per address.

import { ACTIVITY_CONFIG } from '@/config/activity'
import { getSql, isDbConfigured } from '@/lib/db'
import { big, toFloat } from '@/lib/pl-exact-json'
import { ASSET_DECIMALS, buildRails, type LpPosition, type PoolSample, type Transfer } from '@/lib/rails-pools'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Obj[]) : [])
const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

export interface StoredEvent extends Transfer {
  first_seen: number
}

export interface AccountActivity {
  account: string
  tx_count: number
  lp_fpl_hours: number
  lend_fpl_hours: number
  last_lp_fpl: number
  last_lend_fpl: number
  last_at: number
}

export interface AccountSnapshot {
  account: string
  sequence: number
  lp: LpPosition[]
  lend: { asset: string; shares: string }[]
}

/** One UTC day on which an account did something we can see (tx, lp, lend, bridge). */
export interface ActiveDay {
  account: string
  day: string
  source: 'tx' | 'lp' | 'lend' | 'bridge'
}

export interface ActivityStore {
  addActiveDays(d: ActiveDay[]): Promise<void>
  activeDays(sinceDay: string): Promise<ActiveDay[]>
  upsertEvents(ev: StoredEvent[]): Promise<void>
  events(): Promise<StoredEvent[]>
  accounts(): Promise<AccountActivity[]>
  putAccounts(a: AccountActivity[]): Promise<void>
  addPoolSamples(x: PoolSample[]): Promise<void>
  poolSamples(since: number): Promise<PoolSample[]>
}

export function memoryActivityStore(): ActivityStore {
  const ev = new Map<string, StoredEvent>()
  const acc = new Map<string, AccountActivity>()
  let samples: PoolSample[] = []
  const days = new Map<string, ActiveDay>()
  return {
    async addActiveDays(list) {
      for (const d of list) days.set(`${d.account}|${d.day}|${d.source}`, d)
    },
    async activeDays(since) {
      return [...days.values()].filter((d) => d.day >= since)
    },
    async upsertEvents(list) {
      for (const e of list) if (!ev.has(e.id)) ev.set(e.id, e)
        else ev.set(e.id, { ...ev.get(e.id)!, status: e.status })
    },
    async events() {
      return [...ev.values()]
    },
    async accounts() {
      return [...acc.values()]
    },
    async putAccounts(list) {
      for (const a of list) acc.set(a.account, a)
    },
    async addPoolSamples(x) {
      samples = [...samples, ...x].filter((p, i, all) => all.findIndex((q) => q.pool_id === p.pool_id && q.at === p.at) === i)
    },
    async poolSamples(since) {
      return samples.filter((p) => p.at >= since)
    },
  }
}

let pgReady = false
async function ensurePg() {
  if (pgReady) return
  const sql = getSql()
  await sql`CREATE TABLE IF NOT EXISTS explorer_activity_events (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, asset TEXT NOT NULL, account TEXT NOT NULL,
    amount NUMERIC NOT NULL, external TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '',
    ext_block BIGINT, first_seen BIGINT NOT NULL)`
  await sql`CREATE TABLE IF NOT EXISTS explorer_activity_accounts (
    account TEXT PRIMARY KEY, tx_count BIGINT NOT NULL DEFAULT 0,
    lp_fpl_hours DOUBLE PRECISION NOT NULL DEFAULT 0, lend_fpl_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_lp_fpl DOUBLE PRECISION NOT NULL DEFAULT 0, last_lend_fpl DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_at BIGINT NOT NULL DEFAULT 0)`
  await sql`CREATE TABLE IF NOT EXISTS explorer_pool_samples (
    pool_id TEXT NOT NULL, sampled_at BIGINT NOT NULL, reserve_a NUMERIC NOT NULL,
    reserve_b NUMERIC NOT NULL, lp_supply NUMERIC NOT NULL, PRIMARY KEY (pool_id, sampled_at))`
  await sql`CREATE TABLE IF NOT EXISTS explorer_activity_days (
    account TEXT NOT NULL, day DATE NOT NULL, source TEXT NOT NULL, PRIMARY KEY (account, day, source))`
  pgReady = true
}

export function pgActivityStore(): ActivityStore {
  const sql = getSql()
  return {
    async addActiveDays(list) {
      await ensurePg()
      for (const d of list) {
        await sql`INSERT INTO explorer_activity_days (account, day, source) VALUES (${d.account}, ${d.day}::date, ${d.source}) ON CONFLICT DO NOTHING`
      }
    },
    async activeDays(since) {
      await ensurePg()
      const rows = (await sql`SELECT account, day::text AS day, source FROM explorer_activity_days WHERE day >= ${since}::date`) as Obj[]
      return rows.map((r) => ({ account: s(r.account), day: s(r.day), source: s(r.source) as ActiveDay['source'] }))
    },
    async upsertEvents(list) {
      await ensurePg()
      for (const e of list) {
        await sql`INSERT INTO explorer_activity_events (id, kind, asset, account, amount, external, status, ext_block, first_seen)
          VALUES (${e.id}, ${e.kind}, ${e.asset}, ${e.account}, ${e.amount}, ${e.external}, ${e.status}, ${e.ext_block}, ${e.first_seen})
          ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`
      }
    },
    async events() {
      await ensurePg()
      const rows = (await sql`SELECT id, kind, asset, account, amount::text AS amount, external, status, ext_block, first_seen FROM explorer_activity_events`) as Obj[]
      return rows.map((r) => ({
        id: s(r.id),
        kind: s(r.kind) as Transfer['kind'],
        asset: s(r.asset) as Transfer['asset'],
        account: s(r.account),
        amount: s(r.amount).split('.')[0],
        external: s(r.external),
        status: s(r.status),
        ext_block: r.ext_block == null ? null : Number(r.ext_block),
        first_seen: Number(r.first_seen),
      }))
    },
    async accounts() {
      await ensurePg()
      const rows = (await sql`SELECT * FROM explorer_activity_accounts`) as Obj[]
      return rows.map((r) => ({
        account: s(r.account),
        tx_count: Number(r.tx_count),
        lp_fpl_hours: Number(r.lp_fpl_hours),
        lend_fpl_hours: Number(r.lend_fpl_hours),
        last_lp_fpl: Number(r.last_lp_fpl),
        last_lend_fpl: Number(r.last_lend_fpl),
        last_at: Number(r.last_at),
      }))
    },
    async putAccounts(list) {
      await ensurePg()
      for (const a of list) {
        await sql`INSERT INTO explorer_activity_accounts (account, tx_count, lp_fpl_hours, lend_fpl_hours, last_lp_fpl, last_lend_fpl, last_at)
          VALUES (${a.account}, ${a.tx_count}, ${a.lp_fpl_hours}, ${a.lend_fpl_hours}, ${a.last_lp_fpl}, ${a.last_lend_fpl}, ${a.last_at})
          ON CONFLICT (account) DO UPDATE SET tx_count = EXCLUDED.tx_count, lp_fpl_hours = EXCLUDED.lp_fpl_hours,
            lend_fpl_hours = EXCLUDED.lend_fpl_hours, last_lp_fpl = EXCLUDED.last_lp_fpl,
            last_lend_fpl = EXCLUDED.last_lend_fpl, last_at = EXCLUDED.last_at`
      }
    },
    async addPoolSamples(x) {
      await ensurePg()
      for (const p of x) {
        await sql`INSERT INTO explorer_pool_samples (pool_id, sampled_at, reserve_a, reserve_b, lp_supply)
          VALUES (${p.pool_id}, ${p.at}, ${p.reserve_a}, ${p.reserve_b}, ${p.lp_supply}) ON CONFLICT DO NOTHING`
      }
      await sql`DELETE FROM explorer_pool_samples WHERE sampled_at < ${Date.now() - 48 * 3600_000}`
    },
    async poolSamples(since) {
      await ensurePg()
      const rows = (await sql`SELECT pool_id, sampled_at, reserve_a::text AS a, reserve_b::text AS b, lp_supply::text AS l
        FROM explorer_pool_samples WHERE sampled_at >= ${since} ORDER BY sampled_at`) as Obj[]
      return rows.map((r) => ({ pool_id: s(r.pool_id), at: Number(r.sampled_at), reserve_a: s(r.a), reserve_b: s(r.b), lp_supply: s(r.l) }))
    },
  }
}

let defaultStore: ActivityStore | null = null
export function activityStore(): ActivityStore {
  if (!defaultStore) defaultStore = isDbConfigured() ? pgActivityStore() : memoryActivityStore()
  return defaultStore
}

// ── Pure parts ─────────────────────────────────────────────────────────────

/** FPL per whole unit of each asset, from the lend markets' on-ledger price. */
export function pricesFpl(st: Obj): Record<string, number> {
  const out: Record<string, number> = { FPL: 1 }
  for (const m of arr(st.defi_markets)) out[s(m.asset)] = Number(m.price_fpl) || 0
  return out
}

export function exclusionSet(st: Obj): Set<string> {
  const set = new Set<string>(ACTIVITY_CONFIG.excludeAccounts)
  for (const v of arr(st.validators)) {
    if (s(v.id)) set.add(s(v.id))
    if (s(v.bond_account)) set.add(s(v.bond_account))
  }
  for (const k of Object.keys(obj(st.watcher_slots))) set.add(k)
  const f = s(obj(st.faucet).account)
  set.add(f || 'faucet')
  return set
}

export function isExcluded(account: string, set: Set<string>): boolean {
  return set.has(account) || ACTIVITY_CONFIG.excludePatterns.some((re) => re.test(account))
}

/** All rail transfers in the current status, as storable events. */
export function eventsFromStatus(st: Obj, now: number): StoredEvent[] {
  return buildRails(st).flatMap((r) => [...r.deposits.recent, ...r.withdrawals.list].map((t) => ({ ...t, first_seen: now })))
}

export function poolSamplesFromStatus(st: Obj, now: number): PoolSample[] {
  return arr(st.defi_pools).map((p) => ({ pool_id: s(p.id), at: now, reserve_a: big(p.reserve_a).toString(), reserve_b: big(p.reserve_b).toString(), lp_supply: big(p.lp_supply).toString() }))
}

/** FPL value of an account's LP positions and lend supply, from current reserves / prices. */
export function positionValues(st: Obj, snap: AccountSnapshot): { lp: number; lend: number } {
  const pools = new Map(arr(st.defi_pools).map((p) => [s(p.id), p]))
  let lp = 0
  for (const x of snap.lp) {
    const p = pools.get(x.pool_id)
    if (!p) continue
    const sup = big(p.lp_supply)
    if (sup <= 0n) continue
    lp += (toFloat(big(x.lp) * 1_000_000n / sup, 6)) * Number(big(p.reserve_a)) * 2
  }
  const price = pricesFpl(st)
  let lend = 0
  for (const x of snap.lend) lend += toFloat(x.shares, ASSET_DECIMALS[x.asset] ?? 0) * (price[x.asset] ?? 0)
  return { lp, lend }
}

/** Advance one account's time-weighted totals to `now` and take the new snapshot. */
export function stepAccount(prev: AccountActivity | undefined, snap: AccountSnapshot, vals: { lp: number; lend: number }, now: number): AccountActivity {
  const base = prev ?? { account: snap.account, tx_count: 0, lp_fpl_hours: 0, lend_fpl_hours: 0, last_lp_fpl: 0, last_lend_fpl: 0, last_at: 0 }
  const dtH = base.last_at > 0 ? Math.max(0, Math.min(now - base.last_at, ACTIVITY_CONFIG.maxIntervalMs)) / 3600_000 : 0
  return {
    account: snap.account,
    tx_count: Math.max(base.tx_count, snap.sequence),
    lp_fpl_hours: base.lp_fpl_hours + base.last_lp_fpl * dtH,
    lend_fpl_hours: base.lend_fpl_hours + base.last_lend_fpl * dtH,
    last_lp_fpl: vals.lp,
    last_lend_fpl: vals.lend,
    last_at: now,
  }
}

/** Candidate accounts to snapshot this run: known ones first by staleness, capped. */
export function pickAccounts(candidates: string[], known: AccountActivity[], cap = ACTIVITY_CONFIG.maxAccountsPerRun): string[] {
  const last = new Map(known.map((a) => [a.account, a.last_at]))
  return [...new Set(candidates.filter((a) => /^[a-z0-9._-]{1,64}$/.test(a)))]
    .sort((a, b) => (last.get(a) ?? 0) - (last.get(b) ?? 0) || a.localeCompare(b))
    .slice(0, cap)
}

/** One index run (pure apart from the store): events, pool samples, account steps. */
export async function indexActivity(st: Obj, snaps: AccountSnapshot[], now: number, store: ActivityStore): Promise<{ events: number; accounts: number; pools: number }> {
  const ev = eventsFromStatus(st, now)
  const known = new Set((await store.events()).map((e) => e.id))
  await store.upsertEvents(ev)
  const samples = poolSamplesFromStatus(st, now)
  await store.addPoolSamples(samples)
  const prev = new Map((await store.accounts()).map((a) => [a.account, a]))
  const vals = new Map(snaps.map((x) => [x.account, positionValues(st, x)]))
  const next = snaps.map((x) => stepAccount(prev.get(x.account), x, vals.get(x.account)!, now))
  await store.putAccounts(next)
  await store.addActiveDays(activeDaysFrom(snaps, prev, vals, ev.filter((e) => !known.has(e.id)), now))
  return { events: ev.length, accounts: next.length, pools: samples.length }
}

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * Days we can attribute from one index run: the sequence went up since the last
 * snapshot (tx), a live LP or lending position, or a newly seen bridge event.
 * The first snapshot of an account only sets a baseline: we cannot date its old txs.
 */
export function activeDaysFrom(snaps: AccountSnapshot[], prev: Map<string, AccountActivity>, vals: Map<string, { lp: number; lend: number }>, newEvents: StoredEvent[], now: number): ActiveDay[] {
  const day = utcDay(now)
  const out: ActiveDay[] = []
  for (const x of snaps) {
    const p = prev.get(x.account)
    if (p && x.sequence > p.tx_count) out.push({ account: x.account, day, source: 'tx' })
    const v = vals.get(x.account)
    if (v && v.lp > 0) out.push({ account: x.account, day, source: 'lp' })
    if (v && v.lend > 0) out.push({ account: x.account, day, source: 'lend' })
  }
  for (const e of newEvents) if (e.account) out.push({ account: e.account, day, source: 'bridge' })
  return out
}

export function snapshotFromAccountQuery(account: string, body: Obj): AccountSnapshot {
  return {
    account,
    sequence: Number(body.sequence) || 0,
    lp: arr(body.lp).map((x) => ({ account, pool_id: s(x.pool_id), lp: big(x.lp).toString() })),
    lend: arr(body.lend_positions).map((x) => ({ asset: s(x.asset), shares: big(x.shares).toString() })),
  }
}
