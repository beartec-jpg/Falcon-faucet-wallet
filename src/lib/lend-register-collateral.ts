import type { LendOverview } from '@/lib/lend-model'
import type { NetworkKey } from '@/lib/networks'
import { withNetworkQuery } from '@/lib/network-query'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function postLoanCollateral(
  loanId: string,
  borrower: string,
  collateralFalcon: number,
): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch('/api/lend/collateral', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loanId, borrower, collateralFalcon }),
  })
  const j = (await r.json().catch(() => ({}))) as { error?: string }
  if (!r.ok) return { ok: false, error: j.error ?? 'Collateral save failed' }
  return { ok: true }
}

function findLoanForCollateral(
  overview: LendOverview,
  principalNum: number,
  loanId?: string,
): { id: string } | null {
  if (loanId) {
    const exact = overview.loans?.find((l) => l.id.toUpperCase() === loanId.toUpperCase())
    if (exact) return exact
  }
  return (
    overview.loans?.find(
      (l) => l.collateralFalcon <= 0 && Math.abs(l.principalFusdc - principalNum) < 0.5,
    ) ??
    overview.loans?.find((l) => l.collateralFalcon <= 0) ??
    null
  )
}

/** Poll overview until the new loan appears, then persist declared collateral. */
export async function registerLoanCollateralWithRetry(
  networkKey: NetworkKey,
  borrower: string,
  principalNum: number,
  collateralFalcon: number,
  loanId?: string,
): Promise<{ ok: boolean; loanId?: string; error?: string }> {
  const delays = [1200, 2000, 2000, 2500, 3000, 3500, 4000]
  let lastError: string | undefined

  for (const delay of delays) {
    await sleep(delay)
    const overviewR = await fetch(
      withNetworkQuery(`/api/lend/overview?address=${encodeURIComponent(borrower)}`, networkKey),
    )
    if (!overviewR.ok) {
      lastError = 'Overview refresh failed while saving collateral'
      continue
    }
    const overview = (await overviewR.json()) as LendOverview
    const loan = findLoanForCollateral(overview, principalNum, loanId)
    if (!loan?.id) {
      lastError = 'Loan not visible on ledger yet'
      continue
    }
    const posted = await postLoanCollateral(loan.id, borrower, collateralFalcon)
    if (posted.ok) return { ok: true, loanId: loan.id }
    lastError = posted.error
  }

  return { ok: false, error: lastError ?? 'Timed out saving collateral' }
}