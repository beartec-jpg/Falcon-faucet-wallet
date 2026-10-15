import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseExact } from '@/lib/pl-exact-json'
import {
  accountView,
  buildTracker,
  classify,
  discoverAccounts,
  linkedGroups,
  operatorsBoard,
  scoreAccount,
  statusContext,
  trackerCsv,
  type TrackerInput,
} from '@/lib/tracker'
import type { AccountActivity, ActiveDay, StoredEvent } from '@/lib/activity-index'
import { TRACKER_CONFIG } from '@/config/tracker'

// Real falcon2 status (2026-10-14, read-only): validators, online seats, epoch credits.
const ops = (parseExact(readFileSync('tests/fixtures/pl-status-operators.json', 'utf8')) as { body: Record<string, unknown> }).body
const rails = (parseExact(readFileSync('tests/fixtures/pl-status-rails-pools.json', 'utf8')) as { body: Record<string, unknown> }).body
const st = { ...rails, ...ops }
const NOW = Date.parse('2026-10-14T12:00:00Z')
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString().slice(0, 10)
const acct = (account: string, x: Partial<AccountActivity> = {}): AccountActivity => ({ account, tx_count: 0, lp_fpl_hours: 0, lend_fpl_hours: 0, last_lp_fpl: 0, last_lend_fpl: 0, last_at: NOW, ...x })

function input(over: Partial<TrackerInput> = {}): TrackerInput {
  return { st, activity: [], events: [], days: [], faucet: [], links: [], now: NOW, ...over }
}

describe('classification', () => {
  const ctx = statusContext(st)
  it('separates users from test, load-test, system and validator accounts', () => {
    const k = (n: string) => classify(n, ctx).kind
    for (const n of ['alice', 'bob', 'carol']) expect(k(n)).toBe('test')
    for (const n of ['w000', 'w819', 'loadgen01', 'loadgen120', 'm1-smoke-092301', 'bench-3']) expect(k(n)).toBe('harness')
    for (const n of ['faucet', 'admission', 'btc-headers', 'watcher-brain', 'watcher-eth-lc', 'falcon-node-bond', 'treasury']) expect(k(n)).toBe('system')
    for (const n of ['v1', 'v13', 'falcon-node', 'scottspersonalnode']) expect(k(n)).toBe('operator')
    for (const n of ['dave', 'sally', 'scott.reynolds.123', 'testing', 'alexcrypto19']) expect(k(n)).toBe('user')
  })

  it('discovers accounts from status, the index and faucet claims', () => {
    const names = discoverAccounts(st, { activity: [acct('sally')], events: [], days: [], faucet: [{ account: 'newbie', day: day(1), claims: 1 }] })
    expect(names).toEqual(expect.arrayContaining(['v1', 'falcon-node-bond', 'faucet', 'dave', 'sally', 'newbie']))
    expect(names).not.toContain('BAD NAME')
  })
})

describe('scoring', () => {
  it('scores faucet days and consistency, caps everything, marks untracked categories', () => {
    const faucet = Array.from({ length: 20 }, (_, i) => ({ account: 'sally', day: day(i), claims: 3 }))
    const days: ActiveDay[] = Array.from({ length: 40 }, (_, i) => ({ account: 'sally', day: day(i), source: 'tx' as const }))
    const r = scoreAccount('sally', input({ faucet, days, activity: [acct('sally', { tx_count: 25, lp_fpl_hours: 1e12, lend_fpl_hours: 1e12 })] }))
    expect(r.categories.faucet.points).toBe(TRACKER_CONFIG.caps.faucet)
    expect(r.categories.consistency.points).toBe(TRACKER_CONFIG.caps.consistency)
    expect(r.categories.liquidity.points).toBe(TRACKER_CONFIG.caps.liquidity)
    expect(r.categories.swaps).toMatchObject({ points: 0, tracked: true })
    expect(r.categories.arcade).toMatchObject({ points: 0, tracked: true })
    expect(r.categories.infra).toMatchObject({ points: 0, tracked: true })
    expect(r.score).toBeLessThanOrEqual(100)
    expect(r.active_days).toBe(40)
  })

  it('only counts the window and distinct days', () => {
    const faucet = [{ account: 'x1', day: day(1), claims: 5 }, { account: 'x1', day: day(1), claims: 1 }, { account: 'x1', day: day(90), claims: 1 }]
    const r = scoreAccount('x1', input({ faucet }))
    expect(r.categories.faucet.detail).toMatch(/^1 days/)
    expect(r.active_days).toBe(1)
  })

  it('ranks only eligible users; test, harness and operators never appear', () => {
    const days: ActiveDay[] = []
    for (const a of ['dave', 'sally', 'alice', 'w001', 'v1', 'one-day']) days.push({ account: a, day: day(1), source: 'tx' }, { account: a, day: a === 'one-day' ? day(1) : day(2), source: 'tx' })
    const activity = ['dave', 'sally', 'alice', 'w001', 'v1', 'one-day'].map((a) => acct(a, { tx_count: 30, lp_fpl_hours: 100 }))
    const res = buildTracker(input({ days, activity }))
    const ranked = res.board.map((r) => r.account)
    expect(ranked).toEqual(expect.arrayContaining(['dave', 'sally']))
    for (const a of ['alice', 'w001', 'v1']) expect(ranked).not.toContain(a)
    expect(res.building.map((r) => r.account)).toContain('one-day')
    expect(res.stats.by_kind.test).toBeGreaterThanOrEqual(1)
    expect(res.stats.node_accounts).toBe(968)
  })
})

describe('linked accounts (hashed faucet IP, internal)', () => {
  it('groups accounts sharing an IP hash at the threshold and lists only the best', () => {
    const links = ['farm1', 'farm2', 'farm3'].map((account) => ({ account, ip_hash: 'h-shared' })).concat([{ account: 'pair1', ip_hash: 'h-pair' }, { account: 'pair2', ip_hash: 'h-pair' }])
    const g = linkedGroups(links, () => true)
    expect(new Set(['farm1', 'farm2', 'farm3'].map((a) => g.get(a))).size).toBe(1)
    expect(g.has('pair1')).toBe(false) // below threshold (households)
    const days: ActiveDay[] = []
    const activity: AccountActivity[] = []
    for (const [a, tx] of [['farm1', 5], ['farm2', 50], ['farm3', 10]] as const) {
      days.push({ account: a, day: day(1), source: 'tx' }, { account: a, day: day(2), source: 'lp' })
      activity.push(acct(a, { tx_count: tx, lp_fpl_hours: 50 }))
    }
    const inp = input({ days, activity, links })
    const res = buildTracker(inp)
    const listed = [...res.board, ...res.building].map((r) => r.account)
    expect(listed.filter((a) => a.startsWith('farm'))).toEqual(['farm2'])
    expect(res.stats.grouped_accounts).toBe(2)
    // Nothing public carries the hash.
    const pub = JSON.stringify({ ...res, profile: accountView('farm1', inp, res) })
    expect(pub).not.toContain('h-shared')
    expect(accountView('farm1', inp, res).scored_with_group).toBe(true)
    expect(accountView('farm2', inp, res).scored_with_group).toBe(false)
    expect(trackerCsv(res.board)).not.toContain('h-shared')
  })
})

describe('operators board', () => {
  it('ranks validator seats by epoch work share from real status', () => {
    const rows = operatorsBoard(st)
    expect(rows).toHaveLength((ops.validators as unknown[]).length)
    const total = rows.reduce((t, r) => t + r.work_share, 0)
    expect(total).toBeGreaterThan(99)
    expect(total).toBeLessThan(101)
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].work_share).toBeGreaterThanOrEqual(rows[i].work_share)
    const offline = rows.filter((r) => !r.online)
    expect(offline.every((r) => r.proposer_credit === 0)).toBe(true)
    expect(rows.find((r) => r.id === 'falcon-node')?.bond).toBe(50000)
  })

  it('handles the brief {id: bond} validator map', () => {
    expect(operatorsBoard({ validators: { v1: 1000, v2: 900 } }).map((r) => r.id).sort()).toEqual(['v1', 'v2'])
  })
})

describe('profile', () => {
  it('returns classification, rank, days and bridge events', () => {
    const ev: StoredEvent = { id: 'in:1', kind: 'bridge_in', asset: 'USDC', account: 'dave', amount: '1000000', external: '', status: 'minted', ext_block: 1, first_seen: NOW - 1000 }
    const days: ActiveDay[] = [{ account: 'dave', day: day(0), source: 'bridge' }, { account: 'dave', day: day(3), source: 'tx' }]
    const inp = input({ events: [ev], days, activity: [acct('dave', { tx_count: 56 })] })
    const res = buildTracker(inp)
    const v = accountView('dave', inp, res)
    expect(v.classification.kind).toBe('user')
    expect(v.rank).toBe(1)
    expect(v.active_days).toEqual([day(3), day(0)])
    expect(v.events).toHaveLength(1)
    const op = accountView('v1', inp, res)
    expect(op.classification.kind).toBe('operator')
    expect(op.row).toBeNull()
    expect(op.operator?.id).toBe('v1')
  })
})

describe('swaps, arcade and watchers', () => {
  it('weights total 100', () => {
    expect(Object.values(TRACKER_CONFIG.caps).reduce((t, x) => t + x, 0)).toBe(100)
  })

  it('scores logged swaps, capped, and counts swap days as active', () => {
    const swaps = Array.from({ length: 30 }, (_, i) => ({ account: 'dave', day: day(i % 5), token_in: 'FPL', amount_in: '1000000000000000' }))
    const r = scoreAccount('dave', input({ swaps }))
    expect(r.categories.swaps.points).toBeGreaterThan(0)
    expect(r.categories.swaps.points).toBeLessThanOrEqual(TRACKER_CONFIG.caps.swaps)
    expect(r.active_days).toBe(5)
    expect(scoreAccount('sally', input({ swaps })).categories.swaps.points).toBe(0)
  })

  it('scores arcade days and game variety', () => {
    const arcade = Array.from({ length: 7 }, (_, i) => ({ account: 'dave', game: 'g' + (i % 2), day: day(i), score: 10 }))
    const full = scoreAccount('dave', input({ arcade, arcadeGames: 2 }))
    expect(full.categories.arcade.points).toBe(TRACKER_CONFIG.caps.arcade)
    const zero = scoreAccount('dave', input({ arcade: arcade.map((a) => ({ ...a, score: 0 })), arcadeGames: 2 }))
    expect(zero.categories.arcade.points).toBe(0)
  })

  it('scores a community watcher from node status; team watcher keys stay system', () => {
    const st2 = { ...st, watcher_slots: { ...(st.watcher_slots as object), dave: 50 }, watcher_work: { ...(st.watcher_work as object), dave: 500 } }
    const r = scoreAccount('dave', input({ st: st2 }))
    expect(r.categories.infra.points).toBe(TRACKER_CONFIG.caps.infra)
    const ctx = statusContext(st2)
    expect(classify('dave', ctx).kind).toBe('user')
    for (const n of ['watcher-brain', 'watcher-falcon2', 'watcher-browser', 'loadgen01', 'faucet']) expect(classify(n, ctx).kind).not.toBe('user')
    expect(classify('v1', ctx).kind).toBe('operator')
  })
})
