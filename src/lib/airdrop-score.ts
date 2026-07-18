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

/** Category weights of the 2B airdrop pool (must sum to 1). */
export const AIRDROP_WEIGHTS = {
  validator: 0.4,
  setup: 0.1,
  dexLp: 0.35,
  faucet: 0.1,
  buffer: 0.05,
} as const

export const AIRDROP_POOL_FALCON = 2_000_000_000
export const AIRDROP_WINDOW_DAYS = 60
export const FIRST_EMISSION_EPOCH = 8
