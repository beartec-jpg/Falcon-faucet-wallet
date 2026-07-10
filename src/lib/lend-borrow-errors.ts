import type { LendOverview } from '@/lib/lend-model'

/** Minimum broker first-loss cover required for a principal (CoverRateMinimum is tenth-bips / 1000 = %). */
export function minBrokerCoverForPrincipal(
  principalFusdc: number,
  coverRateMinPct: number | null | undefined,
): number {
  if (!Number.isFinite(principalFusdc) || principalFusdc <= 0) return 0
  const pct = coverRateMinPct ?? 1
  return (principalFusdc * pct) / 100
}

export function borrowBlockedReason(
  data: LendOverview | null,
  principalFusdc?: number,
): string | null {
  if (!data?.protocol.txSigningReady) return 'Lending protocol is not active on this network.'
  if (!data.lending.cosignReady) {
    return 'Borrow co-sign is not configured on the server (TESTNET_LENDING_BROKER_SECRET).'
  }
  const vault = data.vaults?.[0]
  if (!vault) return 'Lend vault is not configured.'
  const available = vault.assetsAvailable ?? 0
  if (principalFusdc != null && principalFusdc > available) {
    return `Only ${available.toLocaleString()} F-USDC is available to borrow from the vault right now.`
  }
  const cover = data.pool?.borrow.brokerCoverFusdc ?? 0
  const coverPct = data.pool?.borrow.coverRateMinPct ?? 1
  const minCover =
    principalFusdc != null
      ? minBrokerCoverForPrincipal(principalFusdc, coverPct)
      : minBrokerCoverForPrincipal(1, coverPct)
  if (cover < minCover) {
    return `Loan broker first-loss cover is ${cover.toLocaleString()} F-USDC (need at least ~${minCover.toLocaleString()} F-USDC). The pool operator must post broker cover before borrows can open.`
  }
  return null
}

type RepayLoanFields = {
  principalFusdc?: number
  paymentDueRaw?: string | null
  paymentDueFusdc?: number | null
  totalOutstandingFusdc?: number | null
}

/** Loan still has outstanding debt and can accept LoanPay. */
export function isRepayableLoan(loan: RepayLoanFields | null | undefined): boolean {
  if (!loan) return false
  const outstanding = loan.totalOutstandingFusdc ?? loan.principalFusdc ?? 0
  return outstanding > 0
}

/** Minimum installment / full payoff due from ledger fields. */
export function repayDueFusdc(loan: RepayLoanFields | null | undefined): number | null {
  if (!loan || !isRepayableLoan(loan)) return null
  const raw = loan.paymentDueRaw?.trim()
  if (raw) {
    const n = parseFloat(raw)
    if (Number.isFinite(n) && n > 0) return n
  }
  const due = loan.paymentDueFusdc ?? loan.totalOutstandingFusdc
  return due != null && due > 0 ? due : null
}

/** LoanPay amount: round up to 6 dp so submission clears accrued interest/fees on-chain. */
export function formatRepayAmount(due: number): string {
  const scaled = Math.ceil(due * 1_000_000 - 1e-12) / 1_000_000
  return scaled.toFixed(6)
}

/** Full repay amount for auto-fill and Pay full amount (principal + interest/fees). */
export function fullRepayAmount(loan: RepayLoanFields | null | undefined): string | null {
  const due = repayDueFusdc(loan)
  if (due == null) return null
  return formatRepayAmount(due)
}

/** @deprecated Use fullRepayAmount */
export const suggestedRepayAmount = fullRepayAmount

export function repayBlockedReason(
  data: LendOverview | null,
  loanId: string,
  amountStr: string,
): string | null {
  const loan = data?.loans?.find((l) => l.id === loanId) ?? data?.loans?.find(isRepayableLoan)
  if (!loan || !isRepayableLoan(loan)) return 'No active loan found on this account.'
  const amount = parseFloat(amountStr)
  if (!Number.isFinite(amount) || amount <= 0) return 'Enter a repay amount.'
  const due = repayDueFusdc(loan)
  if (due != null && amount + 1e-9 < due) {
    const full = fullRepayAmount(loan)
    return `Repay amount is too low. This installment requires at least ${full ?? formatRepayAmount(due)} F-USDC (principal ${loan.principalFusdc} + interest/fees). Tap Pay full amount to use the exact due.`
  }
  const balance = data?.wallet?.fusdcBalance
  if (balance != null && amount > balance + 1e-9) {
    return `Insufficient F-USDC in wallet (${balance.toLocaleString(undefined, { maximumFractionDigits: 4 })} available).`
  }
  return null
}

export function explainLendSubmitError(
  engineResult: string | undefined,
  engineMessage: string | undefined,
  data: LendOverview | null,
  opts?: { paymentDueFusdc?: number | null },
): string {
  const base = [engineResult, engineMessage].filter(Boolean).join(' — ')
  if (engineResult === 'tecINSUFFICIENT_PAYMENT') {
    const due = opts?.paymentDueFusdc ?? data?.loans?.[0]?.paymentDueFusdc ?? data?.loans?.[0]?.totalOutstandingFusdc
    if (due != null && due > 0) {
      return `Repay failed: payment is not sufficient. This installment requires at least ~${due.toLocaleString(undefined, { maximumFractionDigits: 6 })} F-USDC (principal + interest/fees) — repaying only the borrowed principal (e.g. 10) is not enough.`
    }
    return 'Repay failed: payment is not sufficient. Include accrued interest and fees — use the payment due amount shown on Positions, not just the principal.'
  }
  if (engineResult === 'tecINSUFFICIENT_FUNDS') {
    const cover = data?.pool?.borrow.brokerCoverFusdc ?? 0
    if (cover < 0.01) {
      return 'Borrow failed: loan broker has no first-loss cover (0 F-USDC). The pool operator must deposit F-USDC broker cover before anyone can borrow — vault liquidity alone is not enough.'
    }
    if ((data?.vaults?.[0]?.assetsAvailable ?? 0) <= 0) {
      return 'Borrow failed: no F-USDC available in the lend vault to fund loans.'
    }
    return base
      ? `Borrow failed (${base}). Check vault liquidity and broker cover on the Overview tab.`
      : 'Borrow failed: insufficient funds (vault liquidity or broker cover).'
  }
  if (engineResult === 'tecINSUFFICIENT_RESERVE') {
    return 'Borrow failed: your Falcon wallet needs more FALCON for account reserve (fund the wallet via faucet first).'
  }
  return base || 'Transaction failed'
}