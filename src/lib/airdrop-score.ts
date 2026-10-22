/**
 * Airdrop scoring helpers (mainnet contribution window).
 * Spec: docs/MAINNET_LAUNCH_SPEC.md
 */

/** Faucet engagement: 60% active days + 40% daily intensity (claims/5 per day). */
export function faucetEngagementScore(opts: {
  windowDays: number
  /** claims per UTC day key */
  claimsByDay: Record<string, number>
  claimsPerDayCap?: number
}): {
  score: number
  activeDays: number
  totalClaims: number
  intensitySum: number
} {
  const cap = opts.claimsPerDayCap ?? 5
  const window = Math.max(1, opts.windowDays)
  const days = Object.keys(opts.claimsByDay)
  let activeDays = 0
  let totalClaims = 0
  let intensitySum = 0
  for (const d of days) {
    const c = Math.max(0, Math.min(cap, opts.claimsByDay[d] ?? 0))
    if (c > 0) activeDays++
    totalClaims += c
    intensitySum += c / cap
  }
  const score = Math.min(
    1,
    0.6 * (activeDays / window) + 0.4 * (intensitySum / window),
  )
  return { score, activeDays, totalClaims, intensitySum }
}

/**
 * Proposed allocation model (2026-10-14). Nothing promised; subject to change.
 * Community bucket 2B = 1B pre-mainnet airdrop (testnet snapshot, credited at
 * mainnet genesis) + 1B release-phase giveaway (mainnet epochs 1-7, per epoch,
 * capped). First-35 prize seats (12M) come from the 1B builder pot; mainnet
 * faucet drips from the 1B faucet bucket; operators have a separate pool.
 * This module scores the release-phase giveaway (mainnet activity).
 * See Falcon-PL docs/MAINNET_TRANSITION.md.
 */
export const COMMUNITY_BUCKET_FPL = 2_000_000_000
export const PRE_MAINNET_AIRDROP_FPL = 1_000_000_000
export const RELEASE_PHASE_GIVEAWAY_FPL = 1_000_000_000
export const FIRST35_SEATS_FPL = 12_000_000

/**
 * Category weights of the release-phase pool. Weights are relative (allocation is
 * score / sum of scores); buffer is held back. Validators are not in the user
 * scorer: they are paid from the operators pool (config/operators.ts).
 */
export const AIRDROP_WEIGHTS = {
  validator: 0,
  setup: 0,
  dexLp: 0.35,
  faucet: 0.1,
  buffer: 0.05,
} as const

/** Release-phase giveaway pool (mainnet epochs 1-7). */
export const AIRDROP_POOL_FALCON = RELEASE_PHASE_GIVEAWAY_FPL
/** Mainnet epochs 1-7 (7 x 7 days), before protocol emission starts at epoch 8. */
export const AIRDROP_WINDOW_DAYS = 49
export const FIRST_EMISSION_EPOCH = 8
