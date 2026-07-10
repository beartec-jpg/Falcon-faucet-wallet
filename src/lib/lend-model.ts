/** Lending UI parameters (preview math; chain uses daemon constants). */

export const LEND_FIXED_APR_BPS = 500 // 5%
export const LEND_MIN_COLLATERAL_RATIO = 1.5
export const LEND_LIQUIDATION_THRESHOLD = 1.1
export const LEND_GRACE_HOURS = 24

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
    /** Portal can submit VaultDeposit / LoanSet txs (not yet wired). */
    txSigningReady: boolean
  }
  token: { symbol: string; currency: string; issuer: string; configured: boolean }
  market: {
    live: boolean
    falconPerFusdc: number | null
    falconPool: number | null
    usdcPool: number | null
  }
  wallet: {
    address: string
    falconBalance: number | null
    fusdcBalance: number | null
    fusdcLimit: number | null
    hasFusdcTrustLine: boolean
  } | null
  vaults: Array<{
    id: string
    asset: string
    assetsTotal: number
    assetsAvailable: number
    sharesOutstanding: number
    shareMptId: string
    shareScale: number
    fixedAprPct: number
  }>
  loans: Array<{
    id: string
    vaultId: string
    principalFusdc: number
    collateralFalcon: number
    healthFactor: number | null
  }>
  lpPositions: Array<{
    vaultId: string
    shareMptId: string
    shareBalance: number
    sharePct: number | null
    depositedFusdc: number | null
    estEpochRewardFalcon: number | null
    claimableEpoch: number | null
    canClaim: boolean
  }>
  epoch: {
    number: number | null
    lpAllocationPct: number | null
    aggregateLpShares: number | null
  }
  pool: {
    supply: {
      totalFusdc: number
      availableFusdc: number
      borrowedFusdc: number
      utilizationPct: number
      providerCount: number
      sharesOutstanding: number
    }
    borrow: {
      borrowerCount: number
      totalDebtFusdc: number
      brokerCoverFusdc: number
      debtMaximumFusdc: number | null
      coverRateMinPct: number | null
      coverRateLiqPct: number | null
      loansOutstanding: number
    }
    contributors: Array<{
      address: string
      shareBalance: number
      sharePct: number
      depositedFusdc: number
    }>
    borrowers: Array<{ address: string; principalFusdc: number; loanId: string }>
  } | null
  lending: {
    configured: boolean
    vaultId: string | null
    loanBrokerId: string | null
    brokerOwner: string | null
    vaultAssetsAvailable: number | null
    interestRateTenthBps: number | null
    cosignReady: boolean
  }
}