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

/** Suggested LoanPay amount: exact ledger periodic payment when available. */
export function suggestedRepayAmount(loan: {
  paymentDueRaw?: string | null
  paymentDueFusdc?: number | null
  totalOutstandingFusdc?: number | null
} | null | undefined): string | null {
  if (!loan) return null
  if (loan.paymentDueRaw?.trim()) return loan.paymentDueRaw.trim()
  const due = loan.paymentDueFusdc ?? loan.totalOutstandingFusdc
  if (due == null || due <= 0) return null
  return due.toFixed(6)
}

export function repayBlockedReason(
  data: LendOverview | null,
  loanId: string,
  amountStr: string,
): string | null {
  const loan = data?.loans?.find((l) => l.id === loanId) ?? data?.loans?.[0]
  if (!loan) return 'No active loan found on this account.'
  const amount = parseFloat(amountStr)
  if (!Number.isFinite(amount) || amount <= 0) return 'Enter a repay amount.'
  const due = loan.paymentDueFusdc ?? loan.totalOutstandingFusdc
  if (due != null && amount + 1e-9 < due) {
    const suggested = suggestedRepayAmount(loan)
    return `Repay amount is too low. This installment requires at least ${suggested ?? due.toLocaleString(undefined, { maximumFractionDigits: 6 })} F-USDC (principal ${loan.principalFusdc} + interest/fees). Partial payments below the installment are not supported on-chain.`
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