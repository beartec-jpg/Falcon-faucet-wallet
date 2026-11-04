import { describe, expect, it } from 'vitest'
import { OPERATOR_FLOOR_FPL, OPERATOR_MAX_FPL, OPERATORS_POOL_FPL } from '@/config/operators'
import { allocateOperators, proRataCapped, splitOperators, type EpochWork } from '@/lib/operator-score'

const sum = (a: number[]) => a.reduce((t, x) => t + x, 0)
function rows(shares: Record<string, number>, epochs = 4, over: Partial<Record<string, Partial<EpochWork>[]>> = {}): EpochWork[] {
  const out: EpochWork[] = []
  for (let e = 1; e <= epochs; e++)
    for (const [v, s] of Object.entries(shares)) out.push({ epoch: e, validator: v, workShare: s, jailed: false, locked: false, ...(over[v]?.[e - 1] ?? {}) })
  return out
}

describe('operators split', () => {
  it('5 operators: top 1%, lowest exactly 0.7%, linear between', () => {
    const a = splitOperators([40, 30, 20, 10, 0])
    expect(a[0]).toBeCloseTo(OPERATOR_MAX_FPL)
    expect(a[4]).toBeCloseTo(OPERATOR_FLOOR_FPL)
    expect(a[1]).toBeCloseTo(9_250_000)
    expect(a[2]).toBeCloseTo(8_500_000)
    for (const x of a) expect(x).toBeGreaterThanOrEqual(OPERATOR_FLOOR_FPL)
    expect(sum(a)).toBeLessThan(OPERATORS_POOL_FPL)
  })
  it('10 operators, equal scores: each 1%, whole pool used', () => {
    const a = splitOperators(Array(10).fill(10))
    expect(a.every((x) => x === OPERATOR_MAX_FPL)).toBe(true)
    expect(sum(a)).toBeCloseTo(OPERATORS_POOL_FPL)
  })
  it('20 operators: pro-rata, whole pool, nobody above 1%', () => {
    const s = Array.from({ length: 20 }, (_, i) => i + 1)
    const a = splitOperators(s)
    expect(sum(a)).toBeCloseTo(OPERATORS_POOL_FPL, 0)
    expect(Math.max(...a)).toBeLessThanOrEqual(OPERATOR_MAX_FPL + 1e-6)
    expect(a[0] / a[1]).toBeCloseTo(0.5)
  })
  it('cap redistribution: dominant operator capped, excess spread pro-rata', () => {
    const s = [1000, ...Array(11).fill(1)]
    const a = splitOperators(s)
    expect(a[0]).toBe(OPERATOR_MAX_FPL)
    expect(sum(a)).toBeCloseTo(OPERATORS_POOL_FPL, 0)
    expect(a[1]).toBeCloseTo((OPERATORS_POOL_FPL - OPERATOR_MAX_FPL) / 11, 0)
    expect(proRataCapped([3, 1], 100, 60)).toEqual([60, 40])
  })
})

describe('allocateOperators', () => {
  it('single operator gets 1%', () => {
    expect(splitOperators([3])).toEqual([OPERATOR_MAX_FPL])
  })
  it('epochs with no samples (our outage) leave the denominator; missing seat in a sampled epoch scores 0', () => {
    // epochs 1,2,4 sampled (3 = outage). nodesafe missing from epoch 4.
    const r: EpochWork[] = [1, 2, 4].flatMap((e) => [
      { epoch: e, validator: 'other', workShare: 50, jailed: false, locked: false },
      ...(e === 4 ? [] : [{ epoch: e, validator: 'nodesafe', workShare: 30, jailed: false, locked: false }]),
    ])
    const a = allocateOperators(r, 1)
    const n = a.operators.find((o) => o.validator === 'nodesafe')!
    expect(a.windowEpochs).toBe(3)
    expect(n.score).toBeCloseTo(20)
    expect(n.epochsActive).toBe(2)
    expect(allocateOperators(r, 2).windowEpochs).toBe(2)
  })
  it('excludes internal seats and operators under the activity threshold; remainder returns to users', () => {
    const r = allocateOperators(rows({ v1: 50, 'falcon-node': 10, nodesafe: 25, 'crypto-dashboard': 15 }, 4, {
      // crypto-dashboard: jailed 2 epochs, locked 1 => active 1/4 < 50%
      'crypto-dashboard': [{ jailed: true }, { jailed: true }, { locked: true }],
    }))
    const by = Object.fromEntries(r.operators.map((o) => [o.validator, o]))
    expect(by.v1.eligible).toBe(false)
    expect(by.v1.reason).toBe('Falcon-operated seat')
    expect(by['falcon-node'].eligible).toBe(false)
    expect(by['crypto-dashboard'].eligible).toBe(false)
    expect(by['crypto-dashboard'].score).toBeCloseTo(15 / 4)
    expect(by.nodesafe.eligible).toBe(true)
    expect(by.nodesafe.projectedFpl).toBe(OPERATOR_MAX_FPL)
    expect(r.returnedFpl).toBe(OPERATORS_POOL_FPL - OPERATOR_MAX_FPL)
    expect(r.userPoolFpl).toBe(850_000_000 + r.returnedFpl)
  })
  it('exactly 50% active is eligible', () => {
    const r = allocateOperators(rows({ nodesafe: 20 }, 4, { nodesafe: [{ jailed: true }, { locked: true }] }))
    expect(r.operators[0].eligible).toBe(true)
    expect(r.operators[0].score).toBeCloseTo(10)
  })
  it('no eligible operators: whole pool returns', () => {
    const r = allocateOperators(rows({ v2: 100 }))
    expect(r.allocatedFpl).toBe(0)
    expect(r.userPoolFpl).toBe(950_000_000)
    expect(r.returnedFpl).toBe(OPERATORS_POOL_FPL)
  })
})
