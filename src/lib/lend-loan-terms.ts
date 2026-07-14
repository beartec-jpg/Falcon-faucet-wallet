/** Loan duration in PoPL epochs (7 days each, 52 per year). */

export const LEND_EPOCH_DAYS = 7
export const LEND_EPOCH_SECONDS = LEND_EPOCH_DAYS * 86_400
export const LEND_EPOCHS_PER_YEAR = 52

export const LEND_DURATION_PRESETS: { label: string; epochs: number }[] = [
  { label: '7 days (1 epoch)', epochs: 1 },
  { label: '4 weeks', epochs: 4 },
  { label: '3 months (~12 epochs)', epochs: 12 },
  { label: '6 months (~26 epochs)', epochs: 26 },
  { label: '12 months (52 epochs)', epochs: 52 },
]

export function clampLoanEpochs(epochs: number): number {
  if (!Number.isFinite(epochs)) return 1
  return Math.min(LEND_EPOCHS_PER_YEAR, Math.max(1, Math.round(epochs)))
}

/** Wall-clock seconds for a bullet loan due after N epochs. */
export function paymentIntervalForEpochs(epochs: number): number {
  return clampLoanEpochs(epochs) * LEND_EPOCH_SECONDS
}

/** Human label for loan duration. */
export function formatLoanDuration(epochs: number): string {
  const n = clampLoanEpochs(epochs)
  const days = n * LEND_EPOCH_DAYS
  if (n === 1) return '7 days (1 epoch)'
  if (n === LEND_EPOCHS_PER_YEAR) return '52 epochs (~12 months)'
  return `${days} days (${n} epoch${n === 1 ? '' : 's'})`
}

/** APR percent for display (500 tenth-bips → 5%). */
export function aprPctFromTenthBips(tenthBips: number): number {
  return tenthBips / 100
}

/** APR as decimal (500 tenth-bips → 0.05). */
export function aprDecimalFromTenthBips(tenthBips: number): number {
  return tenthBips / 10_000
}

/**
 * Bullet loan estimate: interest = principal × APR × (epochs / 52).
 * Matches on-chain proration for payment_total=1 (≈ interval / year).
 */
export function estimateBulletLoanDue(
  principalFusdc: number,
  epochs: number,
  interestRateTenthBps: number,
): { interestFusdc: number; totalDueFusdc: number } | null {
  if (!Number.isFinite(principalFusdc) || principalFusdc <= 0) return null
  const n = clampLoanEpochs(epochs)
  const apr = aprDecimalFromTenthBips(interestRateTenthBps)
  const interestFusdc = principalFusdc * apr * (n / LEND_EPOCHS_PER_YEAR)
  return {
    interestFusdc,
    totalDueFusdc: principalFusdc + interestFusdc,
  }
}