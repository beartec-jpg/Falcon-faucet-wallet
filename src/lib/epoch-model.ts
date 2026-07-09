/** Epoch / CID / PoPL display parameters (UI + preview math; chain uses daemon constants). */

export const EPOCHS_PER_YEAR = 52
export const CID_YEAR_WEIGHT_SUM = (EPOCHS_PER_YEAR * (EPOCHS_PER_YEAR + 1)) / 2

export const CID_YEARLY_START_PCT = 12
export const CID_YEARLY_FLOOR_PCT = 1.5
export const CID_STEP_BPS = 3
export const CID_YEARLY_STEP_BPS = CID_STEP_BPS * EPOCHS_PER_YEAR

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

export function lpAllocationPct(epoch: number): number {
  if (epoch <= 1) return POPL_LP_START_PCT
  if (epoch >= POPL_TAPER_EPOCHS) return POPL_LP_END_PCT
  return POPL_LP_START_PCT - ((POPL_LP_START_PCT - POPL_LP_END_PCT) * (epoch - 1)) / (POPL_TAPER_EPOCHS - 1)
}

/** Yearly-average CID target (% of treasury per calendar year). */
export function cidYearlyAvgPct(epoch: number): number {
  if (epoch <= 0) return CID_YEARLY_START_PCT
  const year = Math.floor((epoch - 1) / EPOCHS_PER_YEAR)
  const decline = (CID_YEARLY_STEP_BPS / 100) * year
  return Math.max(CID_YEARLY_FLOOR_PCT, CID_YEARLY_START_PCT - decline)
}

/** Per-epoch CID rate (% of treasury this epoch). Sums to yearly average over 52 epochs. */
export function cidEmissionPct(epoch: number): number {
  if (epoch <= 0) {
    return (CID_YEARLY_START_PCT * EPOCHS_PER_YEAR) / CID_YEAR_WEIGHT_SUM
  }
  const slot = (epoch - 1) % EPOCHS_PER_YEAR
  const weight = EPOCHS_PER_YEAR - slot
  const yearlyAvg = cidYearlyAvgPct(epoch)
  return Math.round((yearlyAvg * weight * 1000) / CID_YEAR_WEIGHT_SUM) / 1000
}