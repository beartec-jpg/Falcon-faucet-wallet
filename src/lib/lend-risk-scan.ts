import { collateralFromLoanObject } from '@/lib/lend-loan-onchain'
import { loanHealthSnapshot } from '@/lib/lend-collateral'
import {
  loanEntryFlags,
  paymentDefaultEligible,
  recommendLoanManageAction,
  rippleTimeNowSec,
} from '@/lib/lend-loan-manage'
import {
  iouAmount,
  isActiveChainLoan,
  listChainLoans,
  loanOutstandingFusdc,
} from '@/lib/lend-pool-stats'
import { getUsdcMarket } from '@/lib/swap/quote'
import { loadStableToken } from '@/lib/swap/token-config'
import { serverRpcCall, type resolveNetworkKey } from '@/lib/network-server'

type NetworkKey = ReturnType<typeof resolveNetworkKey>

export interface RiskLoanRow {
  loanId: string
  borrower: string
  debtFusdc: number
  collateralFalcon: number
  healthFactor: number | null
  hfStatus: string
  impaired: boolean
  defaulted: boolean
  paymentDefaultEligible: boolean
  recommendedAction: string
}

export async function scanChainLoanRisk(networkKey: NetworkKey): Promise<{
  falconPerFusdc: number | null
  loans: RiskLoanRow[]
  atRiskCount: number
}> {
  const stable = await loadStableToken()
  const token = { currency: stable.currency, issuer: stable.issuer }
  let falconPerFusdc: number | null = null
  try {
    const m = await getUsdcMarket(networkKey, token)
    if (m.market && m.market.xrpPool > 0) {
      falconPerFusdc = m.market.tokenPool / m.market.xrpPool
    }
  } catch {
    /* no pool */
  }

  const now = rippleTimeNowSec()
  const chainLoans = await listChainLoans(networkKey)
  const rows: RiskLoanRow[] = []

  for (const summary of chainLoans) {
    let obj: Record<string, unknown> | null = null
    try {
      const r = await serverRpcCall<{ node?: Record<string, unknown> }>(
        networkKey,
        'ledger_entry',
        { loan: summary.id, ledger_index: 'validated' },
        { allowError: true },
      )
      obj = r?.node ?? null
    } catch {
      obj = null
    }

    const debt =
      obj != null
        ? loanOutstandingFusdc(obj)
        : summary.principalFusdc
    const collateral =
      obj != null ? collateralFromLoanObject(obj) : summary.collateralFalcon
    const { healthFactor: hf, status } = loanHealthSnapshot(
      collateral,
      debt,
      falconPerFusdc,
    )
    const flags = loanEntryFlags(obj ?? {})
    const payDefault = obj != null ? paymentDefaultEligible(obj, now) : false
    const action = recommendLoanManageAction(hf, flags, payDefault)

    rows.push({
      loanId: summary.id,
      borrower: summary.borrower,
      debtFusdc: debt,
      collateralFalcon: collateral,
      healthFactor: collateral > 0 ? hf : null,
      hfStatus: status,
      impaired: flags.impaired,
      defaulted: flags.defaulted,
      paymentDefaultEligible: payDefault,
      recommendedAction: action,
    })
  }

  const atRiskCount = rows.filter(
    (r) =>
      r.recommendedAction !== 'none' &&
      r.recommendedAction !== 'monitor' &&
      !r.defaulted,
  ).length

  return { falconPerFusdc, loans: rows.sort((a, b) => (a.healthFactor ?? 99) - (b.healthFactor ?? 99)), atRiskCount }
}

/** Filter stale paid loans from account_objects response. */
export function filterActiveUserLoans(
  objects: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return objects.filter((obj) => {
    if (obj.LedgerEntryType !== 'Loan' && obj.ledger_entry_type !== 'Loan') return false
    if (!isActiveChainLoan(obj)) return false
    return loanOutstandingFusdc(obj) > 0
  })
}