/** Epoch / CID / PoPL display parameters (UI + preview math; chain uses daemon constants). */

export const EPOCHS_PER_YEAR = 52

export const CID_YEAR1_AVG_PCT = 12
export const CID_YEAR5_AVG_PCT = 4.5
export const CID_YEARLY_FLOOR_PCT = 1.5
export const CID_DECLINE_NUM = 750
export const CID_DECLINE_DEN = 10816
export const CID_EPOCH_FLOOR_BPS = 3

export const POPL_LP_START_PCT = 50
export const POPL_LP_END_PCT = 30
export const POPL_TAPER_EPOCHS = 24

export interface EpochOverview {
  number: number | null
  poolBalanceFalcon: number | null
  emissionRateFalcon: number | null
  lpAllocationPct: number | null
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

export function lpAllocationPct(epoch: number): number {
  if (epoch <= 1) return POPL_LP_START_PCT
  if (epoch >= POPL_TAPER_EPOCHS) return POPL_LP_END_PCT
  return POPL_LP_START_PCT - ((POPL_LP_START_PCT - POPL_LP_END_PCT) * (epoch - 1)) / (POPL_TAPER_EPOCHS - 1)
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