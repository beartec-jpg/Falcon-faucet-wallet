/** PoPL / CID display parameters (UI + preview math; chain uses daemon constants). */

export const LEND_FIXED_APR_BPS = 500 // 5%
export const LEND_MIN_COLLATERAL_RATIO = 1.5
export const LEND_LIQUIDATION_THRESHOLD = 1.1
export const LEND_GRACE_HOURS = 24

export const CID_START_PCT = 12
export const CID_FLOOR_PCT = 1.5
export const CID_STEP_BPS = 3

export const POPL_LP_START_PCT = 50
export const POPL_LP_END_PCT = 30
export const POPL_TAPER_EPOCHS = 24

export function lpAllocationPct(epoch: number): number {
  if (epoch <= 1) return POPL_LP_START_PCT
  if (epoch >= POPL_TAPER_EPOCHS) return POPL_LP_END_PCT
  return POPL_LP_START_PCT - ((POPL_LP_START_PCT - POPL_LP_END_PCT) * (epoch - 1)) / (POPL_TAPER_EPOCHS - 1)
}

export function cidEmissionPct(epoch: number): number {
  if (epoch <= 0) return CID_START_PCT
  const decline = (CID_STEP_BPS / 100) * (epoch - 1)
  return Math.max(CID_FLOOR_PCT, CID_START_PCT - decline)
}

/** Health factor = collateral value / debt (liquidation below threshold). */
export function healthFactor(
  collateralFalcon: number,
  debtFusdc: number,
  falconPerFusdc: number,
): number | null {
  if (debtFusdc <= 0) return null
  const collateralValue = collateralFalcon * falconPerFusdc
  return collateralValue / debtFusdc
}

export function hfStatus(hf: number | null): 'healthy' | 'warning' | 'grace' | 'liquidatable' | 'none' {
  if (hf == null) return 'none'
  if (hf >= LEND_MIN_COLLATERAL_RATIO) return 'healthy'
  if (hf >= LEND_LIQUIDATION_THRESHOLD) return 'warning'
  if (hf >= 1) return 'grace'
  return 'liquidatable'
}

export interface LendOverview {
  updatedAt: string
  protocol: {
    singleAssetVault: boolean
    lendingProtocol: boolean
    lendingReady: boolean
    chainBuildPending: boolean
    genesisRestartNeeded: boolean
  }
  token: { symbol: string; currency: string; issuer: string; configured: boolean }
  market: {
    live: boolean
    falconPerFusdc: number | null
    falconPool: number | null
    usdcPool: number | null
  }
  epoch: {
    number: number | null
    poolBalanceFalcon: number | null
    emissionRateFalcon: number | null
    lpAllocationPct: number | null
    cidEmissionPct: number | null
  }
  wallet: {
    address: string
    falconBalance: number | null
    fusdcBalance: number | null
    fusdcLimit: number | null
    hasFusdcTrustLine: boolean
  } | null
  vaults: Array<{ id: string; asset: string; sharesOutstanding: number }>
  loans: Array<{
    id: string
    vaultId: string
    principalFusdc: number
    collateralFalcon: number
    healthFactor: number | null
  }>
  lpPositions: Array<{
    vaultId: string
    shareBalance: number
    claimableEpoch: number | null
  }>
}