import { describe, expect, it } from 'vitest'
import { rateBetween, windowIntake, windowRate, type NetSample } from '@/lib/net-metrics'

const S = (t: number, height: number, txs: number, extra: Partial<NetSample> = {}): NetSample => ({
  t, height, txs_sealed: txs, ledgers_sealed: height, mempool: 150, peers: 10, online: 10,
  last_pack_txs: 0, last_pack_packer: '', min_fee: 1, fee_multiplier: 1,
  watchers_live: null, watchers_epoch: null, wallets_activated: null, seats: [], ...extra,
})

describe('network rate sanity', () => {
  it('computes real rates from consistent counters', () => {
    const r = rateBetween(S(0, 619160, 15_688_000), S(60_000, 619172, 15_688_871))!
    expect(r.blocks_min).toBeCloseTo(12)
    expect(r.tps).toBeCloseTo(14.5, 1)
    expect(r.txs_per_block).toBeCloseTo(72.6, 1)
  })

  it('rejects a zero / missing-counter baseline (the 190k tx/s bug)', () => {
    const base = S(0, 619100, 0, { ledgers_sealed: 619100 })
    expect(rateBetween(base, S(82_000, 619172, 15_688_871))).toBeNull()
    expect(rateBetween(S(0, 619100, 15_000_000, { metrics_ok: false }), S(82_000, 619172, 15_688_871))).toBeNull()
  })

  it('rejects ledger counters that disagree with the height (stale / other seat baseline)', () => {
    const a = S(0, 619160, 15_688_000, { ledgers_sealed: 404_000 })
    expect(rateBetween(a, S(82_000, 619172, 15_688_871))).toBeNull()
  })

  it('clamps absurd values and too-short spans', () => {
    expect(rateBetween(S(0, 1000, 1_000), S(60_000, 1012, 10_000_000))).toBeNull()
    expect(rateBetween(S(0, 1000, 1_000), S(500, 1001, 1_050))).toBeNull()
  })

  it('windowRate ignores bad samples; null (shown as —) with insufficient data', () => {
    expect(windowRate([S(0, 1, 100)], 60_000)).toBeNull()
    const arr = [S(0, 619100, 0, { metrics_ok: false }), S(30_000, 619166, 15_688_400), S(60_000, 619172, 15_688_871)]
    const r = windowRate(arr, 60_000)!
    expect(r.tps).toBeLessThan(100)
    expect(windowIntake(arr, r)).toBeGreaterThanOrEqual(0)
    expect(windowIntake(arr, r)!).toBeLessThan(100)
  })
})
