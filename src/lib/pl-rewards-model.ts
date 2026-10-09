/**
 * Falcon PL (2300) epoch reward model: integer mirror of
 * `falcon-pl-rs/crates/fd-pl/src/economy.rs::settle_epoch` and the equal
 * check credit of `lib.rs::epoch_work_from_chain`. Same maths as
 * `docs/ops/tools/pl-rewards-check.py` in Falcon-PL. Keep the constants in sync.
 *
 * Pure and isomorphic (no Node builtins). All amounts are FPL (0 decimals) as BigInt.
 */

export const SHARE_VALIDATORS_PCT = 55n
export const SHARE_WATCHERS_PCT = 5n
export const SHARE_AMM_PCT = 20n
export const SHARE_LEND_PCT = 20n
/** Per-account cap, in 1/10 000 of the epoch emission. */
export const CAP_LP_PER_ACCOUNT_E4 = 50n
export const CAP_WATCHER_PER_ACCOUNT_E4 = 5n
export const WATCHER_SLOTS_PER_EPOCH = 168n
const U64_MAX = (1n << 64n) - 1n
/** params_v2.rs (rewards v2, node 2.9.62). Keep in sync. */
export const FEE_BURN_PCT = 50n
export const FEE_PROPOSER_PCT = 30n
export const POT_PROPOSER_PCT = 50n
export const POT_VOTER_PCT = 40n
export const BLOCK_BASE_CREDIT = 64n
export const TX_BONUS_CAP = 64n

export type Weights = Record<string, bigint>

/** JSON.parse that keeps integers of 16+ digits as strings (u64 weights overflow JS numbers). */
export function parseBigJson(raw: string): unknown {
  return JSON.parse(raw.replace(/([:\[,]\s*)(\d{16,})(?=\s*[,}\]])/g, '$1"$2"'))
}

export function big(v: unknown): bigint {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v))
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return BigInt(v.trim())
  return 0n
}

export function bigMap(v: unknown): Weights {
  const out: Weights = {}
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = big(x)
  }
  return out
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b
}

/** economy.rs `pro_rata_capped`: floor(pot·w/total) per account, capped; returns paid + remainder. */
export function proRataCapped(pot: bigint, weights: Weights, perCap: bigint): { paid: Weights; rem: bigint } {
  let total = 0n
  for (const w of Object.values(weights)) total += w
  if (pot === 0n || total === 0n) return { paid: {}, rem: pot }
  const paid: Weights = {}
  let used = 0n
  for (const k of Object.keys(weights).sort()) {
    const w = weights[k]
    if (w === 0n) continue
    const give = minBig((pot * w) / total, perCap)
    if (give > 0n) {
      paid[k] = give
      used += give
    }
  }
  return { paid, rem: pot - used }
}

/** weight = work × min(slots,168) / 168 (integer). */
export function watcherWeights(work: Weights, slots: Weights): Weights {
  const out: Weights = {}
  for (const [k, w] of Object.entries(work)) {
    if (w === 0n) continue
    const s = minBig(slots[k] ?? 0n, WATCHER_SLOTS_PER_EPOCH)
    const weight = (w * s) / WATCHER_SLOTS_PER_EPOCH
    if (weight > 0n) out[k] = weight
  }
  return out
}

export type RewardsInput = {
  treasury: bigint
  emissionBps: bigint
  epochClaimable: boolean
  ammLp: Weights
  lendLp: Weights
  watcherWork: Weights
  watcherSlots: Weights
  packTxs: Weights
  /** Bonded, non-jailed validator ids (one equal check credit each). */
  eligibleValidators: string[]
  /** Epoch fee pool share. Not exposed by status; 0 gives a lower bound. */
  feePool?: bigint
}

export type RewardsProjection = {
  emit: bigint
  buckets: { validators: bigint; watchers: bigint; amm: bigint; lend: bigint }
  lpCap: bigint
  watcherCap: bigint
  validatorPot: bigint
  packHalf: bigint
  checkHalf: bigint
  packTxsTotal: bigint
  watcherWeights: Weights
  pays: Weights
  validatorPays: Weights
  watcherPays: Weights
  ammPays: Weights
  lendPays: Weights
}

/** Projected payouts if the current epoch settled with today's counters. */
export function projectSettle(i: RewardsInput): RewardsProjection {
  const emit = i.epochClaimable ? (i.treasury * i.emissionBps) / 10_000n : 0n
  const v = (emit * SHARE_VALIDATORS_PCT) / 100n
  const w = (emit * SHARE_WATCHERS_PCT) / 100n
  const a = (emit * SHARE_AMM_PCT) / 100n
  const l = (emit * SHARE_LEND_PCT) / 100n
  const lpCap = (emit * CAP_LP_PER_ACCOUNT_E4) / 10_000n || 1n
  const watcherCap = (emit * CAP_WATCHER_PER_ACCOUNT_E4) / 10_000n || 1n
  const amm = proRataCapped(a, i.ammLp, lpCap)
  const lend = proRataCapped(l, i.lendLp, lpCap)
  const ww = watcherWeights(i.watcherWork, i.watcherSlots)
  const wat = proRataCapped(w, ww, watcherCap)
  const validatorPot = v + amm.rem + lend.rem + wat.rem + (i.feePool ?? 0n)
  const packHalf = validatorPot / 2n
  const checkHalf = validatorPot - packHalf
  const pack = proRataCapped(packHalf, i.packTxs, U64_MAX)
  const eligible: Weights = {}
  for (const id of i.eligibleValidators) eligible[id] = 1n
  const check = proRataCapped(checkHalf, eligible, U64_MAX)
  const validatorPays: Weights = {}
  for (const d of [pack.paid, check.paid]) {
    for (const [k, x] of Object.entries(d)) validatorPays[k] = (validatorPays[k] ?? 0n) + x
  }
  const pays: Weights = { ...validatorPays }
  for (const d of [wat.paid, amm.paid, lend.paid]) {
    for (const [k, x] of Object.entries(d)) pays[k] = (pays[k] ?? 0n) + x
  }
  let packTxsTotal = 0n
  for (const x of Object.values(i.packTxs)) packTxsTotal += x
  return {
    emit,
    buckets: { validators: v, watchers: w, amm: a, lend: l },
    lpCap,
    watcherCap,
    validatorPot,
    packHalf,
    checkHalf,
    packTxsTotal,
    watcherWeights: ww,
    pays,
    validatorPays,
    watcherPays: wat.paid,
    ammPays: amm.paid,
    lendPays: lend.paid,
  }
}

/** economy.rs `fee_split_v2`: [burn, proposer now, epoch reward pool]. */
export function feeSplitV2(fee: bigint): [bigint, bigint, bigint] {
  const burn = (fee * FEE_BURN_PCT) / 100n
  const prop = (fee * FEE_PROPOSER_PCT) / 100n
  return [burn, prop, fee - burn - prop]
}

/** economy.rs `proposer_block_credit`: 64 + min(fee-paying txs, 64). */
export function proposerBlockCredit(feePayingTxs: bigint): bigint {
  return BLOCK_BASE_CREDIT + minBig(feePayingTxs, TX_BONUS_CAP)
}

export type RewardsInputV2 = {
  treasury: bigint
  emissionBps: bigint
  epochClaimable: boolean
  /** v2 FPL value weights (status `rewards_v2.amm_lp_value_weights`). */
  ammLp: Weights
  lendLp: Weights
  watcherWork: Weights
  watcherSlots: Weights
  proposerCredit: Weights
  voteCredit: Weights
  /** 100 per eligible seat, 105 with the archive role. */
  floorWeights: Weights
  feePool: bigint
}

export type RewardsProjectionV2 = Omit<RewardsProjection, 'packTxsTotal'> & {
  formula: 'v2'
  propPool: bigint
  votePool: bigint
  floorPool: bigint
  feePool: bigint
  proposerPays: Weights
  votePays: Weights
  floorPays: Weights
}

/** Mirror of economy.rs `settle_epoch_v2` (50 % proposer credit / 40 % vote credit / 10 % floor). */
export function projectSettleV2(i: RewardsInputV2): RewardsProjectionV2 {
  const emit = i.epochClaimable ? (i.treasury * i.emissionBps) / 10_000n : 0n
  const v = (emit * SHARE_VALIDATORS_PCT) / 100n
  const w = (emit * SHARE_WATCHERS_PCT) / 100n
  const a = (emit * SHARE_AMM_PCT) / 100n
  const l = (emit * SHARE_LEND_PCT) / 100n
  const lpCap = (emit * CAP_LP_PER_ACCOUNT_E4) / 10_000n || 1n
  const watcherCap = (emit * CAP_WATCHER_PER_ACCOUNT_E4) / 10_000n || 1n
  const amm = proRataCapped(a, i.ammLp, lpCap)
  const lend = proRataCapped(l, i.lendLp, lpCap)
  const ww = watcherWeights(i.watcherWork, i.watcherSlots)
  const wat = proRataCapped(w, ww, watcherCap)
  const validatorPot = v + amm.rem + lend.rem + wat.rem + i.feePool
  const propPool = (validatorPot * POT_PROPOSER_PCT) / 100n
  const votePool = (validatorPot * POT_VOTER_PCT) / 100n
  const floorPool = validatorPot - propPool - votePool
  const prop = proRataCapped(propPool, i.proposerCredit, U64_MAX)
  const vote = proRataCapped(votePool, i.voteCredit, U64_MAX)
  const floor = proRataCapped(floorPool, i.floorWeights, U64_MAX)
  const validatorPays: Weights = {}
  for (const d of [prop.paid, vote.paid, floor.paid]) {
    for (const [k, x] of Object.entries(d)) validatorPays[k] = (validatorPays[k] ?? 0n) + x
  }
  const pays: Weights = { ...validatorPays }
  for (const d of [wat.paid, amm.paid, lend.paid]) {
    for (const [k, x] of Object.entries(d)) pays[k] = (pays[k] ?? 0n) + x
  }
  return {
    formula: 'v2',
    emit,
    buckets: { validators: v, watchers: w, amm: a, lend: l },
    lpCap,
    watcherCap,
    validatorPot,
    packHalf: propPool,
    checkHalf: votePool + floorPool,
    propPool,
    votePool,
    floorPool,
    feePool: i.feePool,
    watcherWeights: ww,
    pays,
    validatorPays,
    proposerPays: prop.paid,
    votePays: vote.paid,
    floorPays: floor.paid,
    watcherPays: wat.paid,
    ammPays: amm.paid,
    lendPays: lend.paid,
  }
}

/** Chain-time ms until the current epoch settles (`genesis + epoch·epoch_ms − now`). */
export function settleEtaMs(epoch: number, epochMs: number, genesisMs: number, nowMs: number): number {
  if (!(epochMs > 0)) return 0
  return Math.max(0, genesisMs + epoch * epochMs - nowMs)
}

/** Treasury emission per epoch as a percentage (30 bps → 0.30). */
export function emissionPctPerEpoch(bps: number): number {
  return bps / 100
}

/** Remaining-treasury emitted per year at `bps` per `epochMs` epoch, compounding (0.30%/7d ≈ 14.5%). */
export function emissionPctPerYear(bps: number, epochMs = 604_800_000): number {
  if (!(bps > 0) || !(epochMs > 0)) return 0
  const epochsPerYear = (365.25 * 86_400_000) / epochMs
  return (1 - Math.pow(1 - bps / 10_000, epochsPerYear)) * 100
}

/** Stringify every bigint in a value (for JSON responses). */
export function stringifyBigs<T>(v: T): unknown {
  if (typeof v === 'bigint') return v.toString()
  if (Array.isArray(v)) return v.map((x) => stringifyBigs(x))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = stringifyBigs(x)
    return out
  }
  return v
}
