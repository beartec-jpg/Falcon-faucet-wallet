import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { big, formatUnits, parseExact } from '@/lib/pl-exact-json'
import { buildPools, buildRails, inferSwaps, lpCandidates, lpValue, type PoolSample } from '@/lib/rails-pools'
import {
  exclusionSet,
  indexActivity,
  isExcluded,
  memoryActivityStore,
  pickAccounts,
  snapshotFromAccountQuery,
  stepAccount,
} from '@/lib/activity-index'
import bridgeConfig from '../public/config/pl-2300-bridge.json'

// Real falcon2 status_req (brief), captured read-only 2026-10-14, trimmed to the fields used.
const RAW = readFileSync('tests/fixtures/pl-status-rails-pools.json', 'utf8')
const st = (parseExact(RAW) as { body: Record<string, unknown> }).body

describe('exact JSON', () => {
  it('keeps 18-decimal amounts exact', () => {
    const v = parseExact('{"a": 330000000000000000, "b": [111578238666169684, 7], "c": 12}') as { a: string; b: unknown[]; c: number }
    expect(v.a).toBe('330000000000000000')
    expect(v.b).toEqual(['111578238666169684', 7])
    expect(v.c).toBe(12)
    expect(formatUnits('330000000000000000', 18)).toBe('0.33')
    expect(formatUnits(350000000n, 6)).toBe('350')
    expect(formatUnits('1234567', 0)).toBe('1,234,567')
    expect(big('-5')).toBe(-5n)
  })
})

describe('rails', () => {
  const rails = buildRails(st, { config: bridgeConfig, btcPolicy: { kickoffFeeSats: 1000, minPegoutSats: 2000, csvBlocks: 6 } })
  const by = Object.fromEntries(rails.map((r) => [r.asset, r]))

  it('has USDC, ETH and BTC with exact totals from status.rails', () => {
    expect(rails.map((r) => r.asset)).toEqual(['USDC', 'ETH', 'BTC'])
    for (const r of rails) expect(big(r.outstanding)).toBe(big(r.minted) - big(r.burned))
    const ethRail = (st.rails as Record<string, unknown>[]).find((r) => r.asset === 'ETH')!
    expect(by.ETH.minted).toBe(String(ethRail.total_minted))
    expect(by.BTC.vault?.sats).toBeGreaterThan(0)
    expect(by.BTC.headers.kind).toBe('bitcoin')
  })

  it('lists real contracts, withdrawals and V3 deposit resolutions', () => {
    expect(by.ETH.addresses.some((a) => a.value.toLowerCase() === String(st.eth_v3_bridge).toLowerCase())).toBe(true)
    expect(by.USDC.addresses.some((a) => a.label.includes('USDC token'))).toBe(true)
    expect(by.BTC.addresses[0].value).toMatch(/^tb1p/)
    for (const r of rails) expect(r.withdrawals.list.every((w) => w.account && big(w.amount) > 0n)).toBe(true)
    const res = (st.eth_v3_resolutions as Record<string, unknown>[]).filter((x) => x.asset === 'ETH')
    expect(by.ETH.deposits.recent).toHaveLength(res.length)
    expect(by.ETH.depositors.byVolume[0]?.account).toBeTruthy()
    // BTC per-depositor data is not exposed: empty board, explained in gaps.
    expect(by.BTC.depositors.byVolume).toEqual([])
    expect(by.BTC.gaps.join(' ')).toMatch(/not exposed/)
    expect(by.BTC.fees.map((f) => f.label)).toContain('Peg-out kickoff fee')
    expect(by.ETH.gaps.join(' ')).toMatch(/fees .* not exposed/i)
  })

  it('merges indexed history without double-counting', () => {
    const first = by.USDC.deposits.recent[0]
    const again = buildRails(st, { history: [first, { ...first, id: 'in:older', account: 'zed', amount: '1000000' }] })
    const u = again.find((r) => r.asset === 'USDC')!
    expect(u.deposits.recent).toHaveLength(by.USDC.deposits.recent.length + 1)
    expect(u.depositors.byCount.find((r) => r.account === 'zed')?.count).toBe(1)
  })
})

describe('pools', () => {
  const positions = [
    { account: 'dave', pool_id: 'usdc-fpl', lp: '605984' },
    { account: 'scott.reynolds.123', pool_id: 'usdc-fpl', lp: '411982' },
  ]
  it('reserves, price, TVL and LP holders from status + account_query', () => {
    const pools = buildPools(st, positions)
    const u = pools.find((p) => p.id === 'usdc-fpl')!
    const raw = (st.defi_pools as Record<string, unknown>[]).find((p) => p.id === 'usdc-fpl')!
    expect(u.reserve_a).toBe(String(raw.reserve_a))
    expect(u.tvl_fpl).toBe(Number(raw.reserve_a) * 2)
    expect(u.price_fpl).toBeCloseTo(Number(raw.reserve_a) / (Number(raw.reserve_b) / 1e6))
    expect(u.lp_count).toBe(2)
    expect(u.top_lps[0].account).toBe('dave')
    expect(u.volume_24h_fpl).toBeNull()
    expect(u.gaps.join(' ')).toMatch(/swappers are not exposed/)
    expect(lpCandidates(st)).toContain('dave')
  })

  it('infers swaps from reserve samples only when LP supply is unchanged', () => {
    const t0 = 1_000_000
    const S = (at: number, a: number, b: number, l = 100): PoolSample => ({ pool_id: 'usdc-fpl', at, reserve_a: String(a), reserve_b: String(b), lp_supply: String(l) })
    const samples = [S(t0, 1000, 2_000_000), S(t0 + 300_000, 1100, 1_820_000), S(t0 + 600_000, 1200, 2_000_000, 110), S(t0 + 900_000, 1150, 2_090_000, 110)]
    const sw = inferSwaps(samples)
    expect(sw.map((x) => x.side)).toEqual(['sell', 'buy'])
    expect(sw[1].fpl).toBe(100)
    const pools = buildPools(st, [], samples, t0 + 900_000)
    const u = pools.find((p) => p.id === 'usdc-fpl')!
    expect(u.volume_24h_fpl).toBe(150)
    expect(u.recent_swaps).toHaveLength(2)
    expect(lpValue(samples[0], 6)).toBeCloseTo(Math.sqrt(1000 * 2) / 100)
  })
})

describe('activity index', () => {
  it('excludes validators, bond accounts, watchers, faucet and loadgen while allowing nodesafe', () => {
    const stWithNodesafe = { ...st, validators: [...(st.validators as unknown[]), { id: 'nodesafe', bond: 50000 }] }
    const ex = exclusionSet(stWithNodesafe)
    for (const a of ['v1', 'falcon-node', 'falcon-node-bond', 'nodesafe-bond', 'watcher-browser', 'faucet', 'loadgen', 'lg-7', 'bench_1']) expect(isExcluded(a, ex)).toBe(true)
    for (const a of ['dave', 'sally', 'scott.reynolds.123', 'nodesafe']) expect(isExcluded(a, ex)).toBe(false)
  })

  it('records rail events, time-weights LP and lending, caps every component', async () => {
    const store = memoryActivityStore()
    const snap = snapshotFromAccountQuery('dave', {
      sequence: 56,
      lp: [{ pool_id: 'usdc-fpl', lp: 605984 }],
      lend_positions: [{ asset: 'USDC', shares: 10000000 }],
    })
    const t0 = 5_000_000
    await indexActivity(st, [snap], t0, store)
    await indexActivity(st, [snap], t0 + 300_000, store)
    await indexActivity(st, [snap], t0 + 600_000, store)
    const [a] = await store.accounts()
    expect(a.tx_count).toBe(56)
    expect(a.lp_fpl_hours).toBeCloseTo(a.last_lp_fpl * (10 / 60))
    expect(a.lend_fpl_hours).toBeCloseTo(10 * 48 * (10 / 60), 0)
    const ev = await store.events()
    expect(ev.length).toBeGreaterThan(0)
    expect(new Set(ev.map((e) => e.id)).size).toBe(ev.length)
    // A long gap does not count as LP time.
    const b = stepAccount(a, snap, { lp: 1000, lend: 0 }, a.last_at + 10 * 3600_000)
    expect(b.lp_fpl_hours - a.lp_fpl_hours).toBeCloseTo(a.last_lp_fpl * 0.25)

    // Active days: a baseline on the first run, then tx / lp / lend days once the sequence moves.
    const later = snapshotFromAccountQuery('dave', { sequence: 57, lp: [{ pool_id: 'usdc-fpl', lp: 605984 }], lend_positions: [] })
    await indexActivity(st, [later], t0 + 900_000, store)
    const days = await store.activeDays('1970-01-01')
    expect(days.filter((d) => d.source === 'tx')).toHaveLength(1)
    expect(days.some((d) => d.source === 'lp')).toBe(true)
  })

  it('rotates account snapshots by staleness and caps them', () => {
    const known = [{ account: 'b', last_at: 5 }, { account: 'a', last_at: 9 }].map((x) => ({ ...x, tx_count: 0, lp_fpl_hours: 0, lend_fpl_hours: 0, last_lp_fpl: 0, last_lend_fpl: 0 }))
    expect(pickAccounts(['a', 'b', 'c', 'BAD NAME'], known, 2)).toEqual(['c', 'b'])
  })
})
