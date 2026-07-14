/** LoanManage transaction flags and broker enforcement helpers. */

export const TF_LOAN_DEFAULT = 0x00010000
export const TF_LOAN_IMPAIR = 0x00020000
export const TF_LOAN_UNIMPAIR = 0x00040000

export const LSF_LOAN_DEFAULT = 0x00010000
export const LSF_LOAN_IMPAIRED = 0x00020000

export type LoanManageAction = 'impair' | 'unimpair' | 'default'

export function loanManageFlags(action: LoanManageAction): number {
  switch (action) {
    case 'impair':
      return TF_LOAN_IMPAIR
    case 'unimpair':
      return TF_LOAN_UNIMPAIR
    case 'default':
      return TF_LOAN_DEFAULT
  }
}

export function loanEntryFlags(obj: Record<string, unknown>): {
  impaired: boolean
  defaulted: boolean
} {
  const raw = Number(obj.Flags ?? obj.flags ?? 0)
  return {
    impaired: (raw & LSF_LOAN_IMPAIRED) !== 0,
    defaulted: (raw & LSF_LOAN_DEFAULT) !== 0,
  }
}

/** Ripple epoch offset: seconds since 2000-01-01 00:00:00 UTC. */
const RIPPLE_EPOCH = 946684800

export function rippleTimeNowSec(): number {
  return Math.floor(Date.now() / 1000) - RIPPLE_EPOCH
}

export function paymentDefaultEligible(
  obj: Record<string, unknown>,
  nowRippleSec = rippleTimeNowSec(),
): boolean {
  const due = Number(obj.NextPaymentDueDate ?? 0)
  const grace = Number(obj.GracePeriod ?? 0)
  if (!Number.isFinite(due) || due <= 0) return false
  return nowRippleSec >= due + grace
}

export type LoanEnforcementAction = LoanManageAction | 'none' | 'monitor'

/** Broker daemon / risk API: map HF + ledger state to on-chain LoanManage action. */
export function recommendLoanManageAction(
  healthFactor: number | null,
  flags: { impaired: boolean; defaulted: boolean },
  paymentDefaultEligible: boolean,
): LoanEnforcementAction {
  if (flags.defaulted) return 'none'
  if (paymentDefaultEligible) return 'default'
  if (healthFactor == null) return 'monitor'
  if (healthFactor < 1.0) return flags.impaired ? 'monitor' : 'impair'
  if (healthFactor < 1.1) return flags.impaired ? 'monitor' : 'impair'
  if (flags.impaired && healthFactor >= 1.1) return 'unimpair'
  return 'none'
}