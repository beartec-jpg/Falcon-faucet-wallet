/** Read FALCON collateral locked on-chain on Loan ledger objects. */

const DROPS_PER_FALCON = 1_000_000

export function collateralFromLoanObject(obj: Record<string, unknown>): number {
  const raw = obj.Collateral
  if (raw == null) return 0
  if (typeof raw === 'string' || typeof raw === 'number') {
    const drops = typeof raw === 'string' ? parseInt(raw, 10) : Math.trunc(raw)
    if (!Number.isFinite(drops) || drops <= 0) return 0
    return drops / DROPS_PER_FALCON
  }
  return 0
}

/** FALCON drops string for LoanSet Collateral field. */
export function collateralDropsFromFalcon(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '0'
  return String(Math.round(amount * DROPS_PER_FALCON))
}