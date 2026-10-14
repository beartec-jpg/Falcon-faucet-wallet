// Testnet activity tracker: account discovery and classification, category
// scoring, linked-account grouping, and the separate operators board.
// Pure functions; the server wrapper (tracker-server.ts) feeds them.
//
// Copy rule: this measures testnet activity. It promises nothing.

import { TRACKER_CONFIG, type TrackerCategory } from '@/config/tracker'
import type { AccountActivity, ActiveDay, StoredEvent } from '@/lib/activity-index'
import { toFloat } from '@/lib/pl-exact-json'
import { ASSET_DECIMALS, lpCandidates } from '@/lib/rails-pools'
import type { FaucetDay, FaucetLink } from '@/lib/faucet-activity'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Obj[]) : [])
const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

export const ACCOUNT_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i

// ── Classification ─────────────────────────────────────────────────────────

export type AccountKind = 'user' | 'operator' | 'system' | 'test' | 'harness'

export interface Classification {
  kind: AccountKind
  reason: string
}

export interface StatusContext {
  validators: Set<string>
  bondAccounts: Set<string>
  watchers: Set<string>
  faucet: string
}

/** Validators may come as a list of objects (full status) or an {id: bond} map. */
export function validatorList(st: Obj): Obj[] {
  if (Array.isArray(st.validators)) return arr(st.validators)
  return Object.entries(obj(st.validators)).map(([id, bond]) => ({ id, bond }))
}

export function statusContext(st: Obj): StatusContext {
  const vals = validatorList(st)
  return {
    validators: new Set(vals.map((v) => s(v.id)).filter(Boolean)),
    bondAccounts: new Set(vals.map((v) => s(v.bond_account)).filter(Boolean)),
    watchers: new Set([...Object.keys(obj(st.watcher_slots)), ...Object.keys(obj(st.watcher_work))]),
    faucet: s(obj(st.faucet).account) || 'faucet',
  }
}

export function classify(name: string, ctx: StatusContext): Classification {
  const c = TRACKER_CONFIG
  if (ctx.validators.has(name)) return { kind: 'operator', reason: 'Validator seat (operators board)' }
  if (c.testAccounts.includes(name)) return { kind: 'test', reason: 'Development test account' }
  if (ctx.bondAccounts.has(name)) return { kind: 'system', reason: 'Validator bond account' }
  if (ctx.watchers.has(name)) return { kind: 'system', reason: 'Watcher service key' }
  if (name === ctx.faucet || c.systemAccounts.includes(name)) return { kind: 'system', reason: 'Protocol or service account' }
  if (c.systemPatterns.some((re) => re.test(name))) return { kind: 'system', reason: 'Protocol or service account' }
  if (c.harnessPatterns.some((re) => re.test(name))) return { kind: 'harness', reason: 'Load-test or smoke-test wallet' }
  return { kind: 'user', reason: '' }
}

/** Every account name the site can see without an accounts-list RPC. */
export function discoverAccounts(st: Obj, sources: { activity: AccountActivity[]; events: StoredEvent[]; days: ActiveDay[]; faucet: FaucetDay[] }): string[] {
  const ctx = statusContext(st)
  const names = new Set<string>([
    ...ctx.validators,
    ...ctx.bondAccounts,
    ...ctx.watchers,
    ctx.faucet,
    ...lpCandidates(st),
    ...sources.activity.map((a) => a.account),
    ...sources.events.map((e) => e.account),
    ...sources.days.map((d) => d.account),
    ...sources.faucet.map((f) => f.account),
  ])
  return [...names].filter((n) => n && ACCOUNT_NAME_RE.test(n)).sort()
}

// ── Linked accounts (hashed faucet IP, internal) ───────────────────────────

/** Union accounts that share a hashed faucet IP with >= linkedMinAccounts accounts. Returns account -> group key (internal). */
export function linkedGroups(links: FaucetLink[], eligible: (a: string) => boolean): Map<string, string> {
  const byIp = new Map<string, Set<string>>()
  for (const l of links) {
    if (!eligible(l.account)) continue
    if (!byIp.has(l.ip_hash)) byIp.set(l.ip_hash, new Set())
    byIp.get(l.ip_hash)!.add(l.account)
  }
  const parent = new Map<string, string>()
  const find = (a: string): string => {
    while (parent.get(a) !== a) a = parent.get(a)!
    return a
  }
  for (const set of byIp.values()) {
    if (set.size < TRACKER_CONFIG.linkedMinAccounts) continue
    const list = [...set].sort()
    for (const a of list) if (!parent.has(a)) parent.set(a, a)
    for (const a of list.slice(1)) {
      const ra = find(a)
      const r0 = find(list[0])
      if (ra !== r0) parent.set(ra < r0 ? r0 : ra, ra < r0 ? ra : r0)
    }
  }
  const out = new Map<string, string>()
  for (const a of parent.keys()) out.set(a, find(a))
  return out
}

// ── Scoring ────────────────────────────────────────────────────────────────

export interface CategoryScore {
  points: number
  cap: number
  /** false = the data is not available yet (shown as such, scores 0). */
  tracked: boolean
  detail: string
}

export interface TrackerRow {
  account: string
  score: number
  active_days: number
  categories: Record<TrackerCategory, CategoryScore>
  /** Scored together with related accounts (only the best one is ranked). */
  grouped: boolean
}

export interface TrackerInput {
  st: Obj
  activity: AccountActivity[]
  events: StoredEvent[]
  days: ActiveDay[]
  faucet: FaucetDay[]
  links: FaucetLink[]
  now: number
}

const logPts = (cap: number, v: number, scale: number) => Math.min(cap, cap * (Math.log10(1 + Math.max(0, v) / scale) / Math.log10(1 + 1000)))
const r1 = (x: number) => Math.round(x * 10) / 10
const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d })

export function windowStart(now: number, days = TRACKER_CONFIG.windowDays): string {
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10)
}

function pricesFpl(st: Obj): Record<string, number> {
  const out: Record<string, number> = { FPL: 1 }
  for (const m of arr(st.defi_markets)) out[s(m.asset)] = Number(m.price_fpl) || 0
  return out
}

/** Score one account. Pure. */
export function scoreAccount(name: string, inp: TrackerInput): TrackerRow {
  const c = TRACKER_CONFIG.caps
  const since = windowStart(inp.now)
  const price = pricesFpl(inp.st)
  const a = inp.activity.find((x) => x.account === name)
  const mine = inp.events.filter((e) => e.account === name)
  const val = (e: StoredEvent) => toFloat(e.amount, ASSET_DECIMALS[e.asset] ?? 0) * (price[e.asset] ?? 0)
  const bridged = mine.reduce((t, e) => t + val(e), 0)
  const bridgePts = mine.length ? Math.min(c.bridging, logPts(c.bridging * 0.7, bridged, 1) + Math.min(c.bridging * 0.3, mine.length * 1.5)) : 0
  const faucetDays = new Set(inp.faucet.filter((f) => f.account === name && f.day >= since).map((f) => f.day))
  const dayset = new Set([...inp.days.filter((d) => d.account === name && d.day >= since).map((d) => d.day), ...faucetDays])
  const lp = a?.lp_fpl_hours ?? 0
  const lend = a?.lend_fpl_hours ?? 0
  const tx = a?.tx_count ?? 0
  const cat: Record<TrackerCategory, CategoryScore> = {
    bridging: { points: bridgePts, cap: c.bridging, tracked: true, detail: `${mine.length} bridge transfers · ${fmt(bridged)} FPL value` },
    swaps: { points: 0, cap: c.swaps, tracked: false, detail: 'Not exposed by the node per account yet' },
    liquidity: { points: logPts(c.liquidity, lp, 10), cap: c.liquidity, tracked: true, detail: `${fmt(lp)} FPL·hours in AMM pools` },
    lending: { points: logPts(c.lending, lend, 10), cap: c.lending, tracked: true, detail: `${fmt(lend)} FPL·hours supplied` },
    payments: { points: logPts(c.payments, tx, 0.1), cap: c.payments, tracked: true, detail: `${fmt(tx)} transactions (account sequence)` },
    consistency: {
      points: c.consistency * Math.min(1, dayset.size / TRACKER_CONFIG.consistencyFullDays),
      cap: c.consistency,
      tracked: true,
      detail: `${dayset.size} active days in the last ${TRACKER_CONFIG.windowDays}`,
    },
    faucet: {
      points: c.faucet * Math.min(1, faucetDays.size / TRACKER_CONFIG.faucetFullDays),
      cap: c.faucet,
      tracked: true,
      detail: `${faucetDays.size} days with a faucet claim`,
    },
    arcade: { points: 0, cap: c.arcade, tracked: false, detail: 'Arcade scores are not linked to Falcon PL accounts yet' },
    infra: { points: 0, cap: c.infra, tracked: false, detail: 'Community watcher tracking is not live yet' },
  }
  for (const k of Object.keys(cat) as TrackerCategory[]) cat[k].points = r1(cat[k].points)
  const score = r1(Object.values(cat).reduce((t, x) => t + x.points, 0))
  return { account: name, score, active_days: dayset.size, categories: cat, grouped: false }
}

export interface TrackerResult {
  board: TrackerRow[]
  /** Users below the ranking threshold (still collecting activity). */
  building: TrackerRow[]
  operators: OperatorRow[]
  stats: {
    discovered: number
    node_accounts: number | null
    by_kind: Record<AccountKind, number>
    grouped_accounts: number
  }
}

const eligible = (r: TrackerRow) =>
  Object.values(r.categories).filter((x) => x.points > 0).length >= TRACKER_CONFIG.minCategories && r.active_days >= TRACKER_CONFIG.minActiveDays

export function buildTracker(inp: TrackerInput): TrackerResult {
  const ctx = statusContext(inp.st)
  const names = discoverAccounts(inp.st, inp)
  const by_kind: Record<AccountKind, number> = { user: 0, operator: 0, system: 0, test: 0, harness: 0 }
  const users: string[] = []
  for (const n of names) {
    const k = classify(n, ctx).kind
    by_kind[k]++
    if (k === 'user') users.push(n)
  }
  const userSet = new Set(users)
  const groups = linkedGroups(inp.links, (a) => userSet.has(a))
  const rows = users.map((n) => scoreAccount(n, inp))
  // Linked groups: rank only the best member; the rest are marked grouped and not listed.
  const best = new Map<string, TrackerRow>()
  for (const r of rows) {
    const g = groups.get(r.account)
    if (!g) continue
    const cur = best.get(g)
    if (!cur || r.score > cur.score || (r.score === cur.score && r.account < cur.account)) best.set(g, r)
  }
  let grouped = 0
  const listed: TrackerRow[] = []
  for (const r of rows) {
    const g = groups.get(r.account)
    if (g) {
      if (best.get(g) !== r) {
        grouped++
        continue
      }
      r.grouped = true
    }
    listed.push(r)
  }
  const sort = (a: TrackerRow, b: TrackerRow) => b.score - a.score || a.account.localeCompare(b.account)
  return {
    board: listed.filter(eligible).sort(sort),
    building: listed.filter((r) => !eligible(r) && r.score > 0).sort(sort),
    operators: operatorsBoard(inp.st),
    stats: { discovered: names.length, node_accounts: inp.st.accounts_count == null ? null : num(inp.st.accounts_count), by_kind, grouped_accounts: grouped },
  }
}

/** Public view of one account's tracker state (no linkage details). */
export function accountView(name: string, inp: TrackerInput, res: TrackerResult) {
  const ctx = statusContext(inp.st)
  const cls = classify(name, ctx)
  const row = cls.kind === 'user' ? scoreAccount(name, inp) : null
  const rank = res.board.findIndex((r) => r.account === name)
  const userSet = new Set(discoverAccounts(inp.st, inp).filter((n) => classify(n, ctx).kind === 'user'))
  const groupKey = linkedGroups(inp.links, (a) => userSet.has(a)).get(name)
  const listed = res.board.some((r) => r.account === name) || res.building.some((r) => r.account === name)
  const since = windowStart(inp.now)
  const days = [...new Set([
    ...inp.days.filter((d) => d.account === name && d.day >= since).map((d) => d.day),
    ...inp.faucet.filter((f) => f.account === name && f.day >= since).map((f) => f.day),
  ])].sort()
  return {
    account: name,
    classification: cls,
    row,
    rank: rank >= 0 ? rank + 1 : null,
    /** True when this account is scored together with related accounts and another one represents the group. */
    scored_with_group: !!groupKey && !listed,
    active_days: days,
    events: inp.events.filter((e) => e.account === name).sort((a, b) => b.first_seen - a.first_seen).slice(0, 50),
    operator: res.operators.find((o) => o.id === name) ?? null,
  }
}

// ── Operators board (validators; separate from users) ──────────────────────

export interface OperatorRow {
  id: string
  bond: number
  online: boolean
  jailed: boolean
  jail_count: number
  slash_total: number
  pack_count: number
  perf: number | null
  epoch_pack_txs: number
  proposer_credit: number
  vote_credit: number
  floor_weight: number
  /** This epoch's work share, weighted like the validator reward split (proposer 50 / voter 40 / floor 10), in %. */
  work_share: number
}

export function operatorsBoard(st: Obj): OperatorRow[] {
  const rv = obj(st.rewards_v2)
  const prop = obj(rv.epoch_proposer_credit)
  const vote = obj(rv.epoch_vote_credit)
  const floor = obj(rv.floor_weights)
  const packs = obj(st.epoch_pack_txs)
  const online = new Set(Array.isArray(st.online_seats) ? (st.online_seats as unknown[]).map(s) : [])
  const sum = (m: Obj) => Object.values(m).reduce<number>((t, v) => t + num(v), 0) || 1
  const [P, V, F] = [sum(prop), sum(vote), sum(floor)]
  const rows = validatorList(st).map((v) => {
    const id = s(v.id)
    const p = num(prop[id])
    const vc = num(vote[id])
    const f = num(floor[id])
    return {
      id,
      bond: num(v.bond),
      online: online.has(id),
      jailed: v.jailed === true,
      jail_count: num(v.jail_count),
      slash_total: num(v.slash_total),
      pack_count: num(v.pack_count),
      perf: v.perf == null ? null : num(v.perf),
      epoch_pack_txs: num(packs[id]),
      proposer_credit: p,
      vote_credit: vc,
      floor_weight: f,
      work_share: r1(100 * (0.5 * (p / P) + 0.4 * (vc / V) + 0.1 * (f / F))),
    }
  })
  return rows.sort((a, b) => b.work_share - a.work_share || b.pack_count - a.pack_count || a.id.localeCompare(b.id))
}

// ── Export ─────────────────────────────────────────────────────────────────

const CATS: TrackerCategory[] = ['bridging', 'swaps', 'liquidity', 'lending', 'payments', 'consistency', 'faucet', 'arcade', 'infra']

export function trackerCsv(rows: TrackerRow[]): string {
  const head = ['rank', 'account', 'score', 'active_days', ...CATS].join(',')
  const lines = rows.map((r, i) => [i + 1, r.account, r.score, r.active_days, ...CATS.map((k) => (r.categories[k].tracked ? r.categories[k].points : 'not_tracked'))].join(','))
  return [head, ...lines].join('\n') + '\n'
}

export function operatorsCsv(rows: OperatorRow[]): string {
  const head = 'rank,validator,work_share_pct,online,jailed,bond,pack_count,epoch_pack_txs,proposer_credit,vote_credit,floor_weight'
  return [head, ...rows.map((o, i) => [i + 1, o.id, o.work_share, o.online, o.jailed, o.bond, o.pack_count, o.epoch_pack_txs, o.proposer_credit, o.vote_credit, o.floor_weight].join(','))].join('\n') + '\n'
}
