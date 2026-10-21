// Operators pool scoring: per-epoch work shares (operatorsBoard formula), window
// averages, eligibility and the allocation split. Pure functions; storage is in
// operator-store.ts. Copy rule: proposed model, nothing promised.

import { OPERATORS_CONFIG, OPERATOR_FLOOR_FPL, OPERATOR_MAX_FPL, OPERATORS_POOL_FPL } from '@/config/operators'
import { TRACKER_CONFIG } from '@/config/tracker'
import { operatorsBoard, validatorList } from '@/lib/tracker'

type Obj = Record<string, unknown>

/** One validator's work in one epoch. Jailed or earn-locked at any sample => scores 0 for the epoch. */
export interface EpochWork {
  epoch: number
  validator: string
  workShare: number
  jailed: boolean
  locked: boolean
}

export interface OperatorScore {
  validator: string
  internal: boolean
  epochsActive: number
  windowEpochs: number
  activeFraction: number
  /** Average epoch work share over the window (%), jailed / locked epochs count 0. */
  score: number
  eligible: boolean
  reason: string
  projectedFpl: number
  projectedShare: number
}

export interface OperatorsAllocation {
  poolFpl: number
  allocatedFpl: number
  /** Unallocated operator amount returned to the user pool. */
  returnedFpl: number
  userPoolFpl: number
  windowStart: string
  windowEpochs: number
  operators: OperatorScore[]
}

/** Excluded from the pool: Falcon seats (config list) plus the tracker's test / system / bond / watcher rules. */
export function isExcludedOperator(id: string): string | null {
  const n = id.toLowerCase()
  if (OPERATORS_CONFIG.internalSeats.includes(n)) return 'Falcon-operated seat'
  if (TRACKER_CONFIG.testAccounts.includes(n)) return 'Test account'
  if (TRACKER_CONFIG.systemAccounts.includes(n)) return 'System account'
  if (TRACKER_CONFIG.systemPatterns.some((re) => re.test(n))) return 'Bond or watcher account'
  if (TRACKER_CONFIG.harnessPatterns.some((re) => re.test(n))) return 'Load-test account'
  return null
}

/** This epoch's rows from node status (same formula as the operators board). */
export function epochWorkFromStatus(st: Obj): EpochWork[] {
  const epoch = Number(st.epoch)
  if (!Number.isFinite(epoch)) return []
  const locked = new Map(validatorList(st).map((v) => [String(v.id ?? ''), v.earn_locked === true]))
  return operatorsBoard(st).map((r) => ({
    epoch,
    validator: r.id,
    workShare: r.work_share,
    jailed: r.jailed,
    locked: locked.get(r.id) ?? false,
  }))
}

const effective = (w: EpochWork) => (w.jailed || w.locked ? 0 : Math.max(0, w.workShare))

/** Window averages. windowEpochs = distinct epochs recorded in the window (all validators). */
export function scoreOperators(rows: EpochWork[]): { windowEpochs: number; scores: Omit<OperatorScore, 'projectedFpl' | 'projectedShare'>[] } {
  const epochs = new Set(rows.map((r) => r.epoch))
  const windowEpochs = epochs.size
  const by = new Map<string, EpochWork[]>()
  for (const r of rows) by.set(r.validator, [...(by.get(r.validator) ?? []), r])
  const scores = [...by.entries()].map(([validator, list]) => {
    const active = list.filter((w) => effective(w) > 0).length
    const sum = list.reduce((t, w) => t + effective(w), 0)
    const activeFraction = windowEpochs ? active / windowEpochs : 0
    const score = windowEpochs ? sum / windowEpochs : 0
    const excl = isExcludedOperator(validator)
    const eligible = !excl && score > 0 && activeFraction >= OPERATORS_CONFIG.minActiveFraction
    const reason = excl ?? (eligible ? '' : `Active in ${active}/${windowEpochs} epochs (needs ${OPERATORS_CONFIG.minActiveFraction * 100}%)`)
    return { validator, internal: !!excl, epochsActive: active, windowEpochs, activeFraction, score, eligible, reason }
  })
  return { windowEpochs, scores }
}

/** Pro-rata split of `pool` by weight with a per-entry cap; capped excess is redistributed pro-rata. */
export function proRataCapped(weights: number[], pool: number, cap: number): number[] {
  const out = weights.map(() => 0)
  let open = weights.map((w, i) => (w > 0 ? i : -1)).filter((i) => i >= 0)
  let left = pool
  while (open.length && left > 1e-9) {
    const W = open.reduce((t, i) => t + weights[i], 0)
    const capped: number[] = []
    for (const i of open) if ((left * weights[i]) / W >= cap - out[i]) capped.push(i)
    if (!capped.length) {
      for (const i of open) out[i] += (left * weights[i]) / W
      left = 0
      break
    }
    for (const i of capped) {
      left -= cap - out[i]
      out[i] = cap
    }
    open = open.filter((i) => !capped.includes(i))
  }
  return out
}

/**
 * Split for eligible scores.
 * N <= smallSetMax: top score gets maxFpl; others floor + (max - floor) x score / top score.
 * N >  smallSetMax: pool pro-rata by score, max per operator, excess redistributed.
 */
export function splitOperators(scores: number[]): number[] {
  const n = scores.length
  if (!n) return []
  if (n <= OPERATORS_CONFIG.smallSetMax) {
    const top = Math.max(...scores)
    return scores.map((s) => OPERATOR_FLOOR_FPL + (OPERATOR_MAX_FPL - OPERATOR_FLOOR_FPL) * (top > 0 ? s / top : 1))
  }
  return proRataCapped(scores, OPERATORS_POOL_FPL, OPERATOR_MAX_FPL)
}

export function allocateOperators(rows: EpochWork[]): OperatorsAllocation {
  const { windowEpochs, scores } = scoreOperators(rows)
  const elig = scores.filter((s) => s.eligible)
  const amounts = splitOperators(elig.map((s) => s.score))
  const amt = new Map(elig.map((s, i) => [s.validator, amounts[i]]))
  const allocatedFpl = amounts.reduce((t, x) => t + x, 0)
  const returnedFpl = Math.max(0, OPERATORS_POOL_FPL - allocatedFpl)
  const A = OPERATORS_CONFIG.airdropFpl
  const operators = scores
    .map((s) => ({ ...s, projectedFpl: amt.get(s.validator) ?? 0, projectedShare: (amt.get(s.validator) ?? 0) / A }))
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.validator.localeCompare(b.validator))
  return {
    poolFpl: OPERATORS_POOL_FPL,
    allocatedFpl,
    returnedFpl,
    // User side: 1B less the 5% buffer less the 100M operators carve-out, plus any returned remainder.
    userPoolFpl: A * (1 - OPERATORS_CONFIG.userBuffer) - OPERATORS_POOL_FPL + returnedFpl,
    windowStart: OPERATORS_CONFIG.windowStart,
    windowEpochs,
    operators,
  }
}
