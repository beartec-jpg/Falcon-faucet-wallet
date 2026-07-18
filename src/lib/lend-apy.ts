/** LP yield model: PoPL emissions floor + borrower interest upside. */

export const EPOCH_LP_START_PCT = 50
export const EPOCH_LP_END_PCT = 30
export const EPOCH_TAPER_COUNT = 24
/** Default borrower APR when manifest missing: 5% = 5000 tenth-bps. */
export const LEND_FIXED_APR_TENTH_BPS = 5000
export const LEND_FIXED_APR_PCT = LEND_FIXED_APR_TENTH_BPS / 1000

/** LP share of emissions at epoch N (1-based); tapers 50% → 30% over 24 epochs. */
export function lpEmissionSharePct(epochNumber: number | null): number {
  if (epochNumber == null || epochNumber <= 0) return EPOCH_LP_START_PCT
  if (epochNumber >= EPOCH_TAPER_COUNT) return EPOCH_LP_END_PCT
  const step = (EPOCH_LP_START_PCT - EPOCH_LP_END_PCT) / EPOCH_TAPER_COUNT
  return EPOCH_LP_START_PCT - step * (epochNumber - 1)
}

export function estimateLpApyPct(params: {
  epochNumber: number | null
  emissionDropsPerEpoch: number
  aggregateLpShares: number | null
  userShareBalance: number | null
  vaultAssetsTotal: number
  utilizationPct: number
  fixedAprPct: number
}): {
  emissionFloorAprPct: number | null
  interestUpsideAprPct: number
  blendedAprPct: number | null
  lpEmissionSharePct: number
} {
  const lpSharePct = lpEmissionSharePct(params.epochNumber)
  const DROPS = 1_000_000

  let emissionFloorAprPct: number | null = null
  if (
    params.emissionDropsPerEpoch > 0 &&
    params.aggregateLpShares != null &&
    params.aggregateLpShares > 0 &&
    params.userShareBalance != null &&
    params.userShareBalance > 0 &&
    params.vaultAssetsTotal > 0
  ) {
    const lpPoolDrops = (params.emissionDropsPerEpoch * lpSharePct) / 100
    const userDrops =
      (lpPoolDrops * params.userShareBalance) / params.aggregateLpShares
    const falconPerEpoch = userDrops / DROPS
    const depositedFusdc =
      (params.userShareBalance / params.aggregateLpShares) * params.vaultAssetsTotal
    if (depositedFusdc > 0) {
      emissionFloorAprPct = (falconPerEpoch / depositedFusdc) * 100 * 52
    }
  }

  const interestUpsideAprPct =
    params.fixedAprPct * (params.utilizationPct / 100) * (lpSharePct / 100)

  const blendedAprPct =
    emissionFloorAprPct != null
      ? emissionFloorAprPct + interestUpsideAprPct
      : interestUpsideAprPct > 0
        ? interestUpsideAprPct
        : null

  return {
    emissionFloorAprPct,
    interestUpsideAprPct,
    blendedAprPct,
    lpEmissionSharePct: lpSharePct,
  }
}