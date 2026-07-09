/** Epoch / CID / PoPL display parameters (UI + preview math; chain uses daemon constants). */

export const EPOCHS_PER_YEAR = 52

export const CID_YEAR1_AVG_PCT = 12
export const CID_YEAR5_AVG_PCT = 4.5
export const CID_YEARLY_FLOOR_PCT = 1.5
export const CID_DECLINE_NUM = 750
export const CID_DECLINE_DEN = 10816
export const CID_EPOCH_FLOOR_BPS = 3

/** Each active vault depositor adds 1% to the LP basket; capped at 50 providers → 50%. */
export const POPL_LP_BPS_PER_PROVIDER = 100
export const POPL_LP_MAX_PROVIDERS = 50
export const POPL_LP_MAX_PCT = 50

export const LEDGERS_PER_EPOCH = 172_800

export interface EpochOverview {
  number: number | null
  poolBalanceFalcon: number | null
  emissionRateFalcon: number | null
  lpAllocationPct: number | null
  lpProviderCount: number | null
  cidEmissionPct: number | null
  cidYearlyAvgPct: number | null
}

function cidEpochBpsNumerator(epoch: number): number {
  return (
    CID_YEAR1_AVG_PCT * 100 * CID_DECLINE_DEN +
    1326 * CID_DECLINE_NUM -
    CID_DECLINE_NUM * (epoch - 1) * EPOCHS_PER_YEAR
  )
}

function cidEpochBpsDenominator(): number {
  return EPOCHS_PER_YEAR * CID_DECLINE_DEN
}

/** LP share of epoch emission from active lending vault provider count (1% each, cap 50%). */
export function lpAllocationPctFromProviders(providerCount: number): number {
  if (providerCount <= 0) return 0
  return Math.min(providerCount, POPL_LP_MAX_PROVIDERS)
}

/** Convert on-chain sfLPAllocationBps (0–5000) to a display percentage. */
export function lpAllocationPctFromBps(lpAllocationBps: number | null | undefined): number | null {
  if (lpAllocationBps == null || !Number.isFinite(lpAllocationBps)) return null
  return lpAllocationBps / 100
}

/** Yearly-average CID target (% of treasury per calendar year). */
export function cidYearlyAvgPct(epoch: number): number {
  if (epoch <= 0) return CID_YEAR1_AVG_PCT
  const year0 = Math.floor((epoch - 1) / EPOCHS_PER_YEAR)
  const denom = cidEpochBpsDenominator()
  const numer =
    EPOCHS_PER_YEAR * (CID_YEAR1_AVG_PCT * 100 * CID_DECLINE_DEN + 1326 * CID_DECLINE_NUM) -
    EPOCHS_PER_YEAR * CID_DECLINE_NUM * (EPOCHS_PER_YEAR * EPOCHS_PER_YEAR * year0 + 1326)
  const yearlyBps = Math.round(numer / denom)
  return Math.max(CID_YEARLY_FLOOR_PCT, yearlyBps / 100)
}

/** Per-epoch CID rate (% of treasury this epoch). Declines linearly every epoch. */
export function cidEmissionPct(epoch: number): number {
  if (epoch <= 0) epoch = 1
  const denom = cidEpochBpsDenominator()
  const numer = cidEpochBpsNumerator(epoch)
  const rounded = Math.round(numer / denom)
  return Math.max(CID_EPOCH_FLOOR_BPS, rounded) / 100
}

/** Full yearly schedule for docs / charts (epochs are 1-based, inclusive). */
export function cidYearlySchedule(maxYear = 10): Array<{
  year: number
  epochStart: number
  epochEnd: number
  yearlyAvgPct: number
  firstEpochPct: number
  lastEpochPct: number
}> {
  const rows = []
  for (let year = 1; year <= maxYear; year++) {
    const epochStart = (year - 1) * EPOCHS_PER_YEAR + 1
    const epochEnd = epochStart + EPOCHS_PER_YEAR - 1
    rows.push({
      year,
      epochStart,
      epochEnd,
      yearlyAvgPct: cidYearlyAvgPct(epochStart),
      firstEpochPct: cidEmissionPct(epochStart),
      lastEpochPct: cidEmissionPct(epochEnd),
    })
  }
  return rows
}