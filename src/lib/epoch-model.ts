/** Epoch / CID / PoPL display parameters (UI + preview math; chain uses daemon constants). */

export const CID_START_PCT = 12
export const CID_FLOOR_PCT = 1.5
export const CID_STEP_BPS = 3

export const POPL_LP_START_PCT = 50
export const POPL_LP_END_PCT = 30
export const POPL_TAPER_EPOCHS = 24

export interface EpochOverview {
  number: number | null
  poolBalanceFalcon: number | null
  emissionRateFalcon: number | null
  lpAllocationPct: number | null
  cidEmissionPct: number | null
}

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