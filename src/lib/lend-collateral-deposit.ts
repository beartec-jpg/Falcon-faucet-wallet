import type { LendOverview } from '@/lib/lend-model'
import { isRepayableLoan } from '@/lib/lend-borrow-errors'

export function addCollateralBlockedReason(
  data: LendOverview | null,
  loanId: string,
  amountFalcon: number,
): string | null {
  if (!data?.protocol.txSigningReady) return 'Lending protocol is not active on this network.'
  if (!data.protocol.lendingCollateral) {
    return 'Add collateral requires the LendingCollateral amendment on validators.'
  }
  const loan = data.loans?.find((l) => l.id === loanId)
  if (!loan || !isRepayableLoan(loan)) return 'No active loan found on this account.'
  if (!Number.isFinite(amountFalcon) || amountFalcon <= 0) return 'Enter how much FALCON to add.'
  const balance = data.wallet?.falconBalance
  if (balance != null && amountFalcon > balance + 1e-9) {
    return `Insufficient FALCON in wallet (${balance.toLocaleString(undefined, { maximumFractionDigits: 4 })} available).`
  }
  return null
}