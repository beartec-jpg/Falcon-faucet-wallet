import { serverRpcCall, type resolveNetworkKey } from '@/lib/network-server'

type NetworkKey = ReturnType<typeof resolveNetworkKey>

export function mptScaled(raw: string | number | undefined | null, scale: number): number {
  if (raw == null || raw === '') return 0
  const n = typeof raw === 'string' ? parseFloat(raw) : raw
  if (!Number.isFinite(n)) return 0
  return n / 10 ** scale
}

export function iouAmount(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number') {
    const n = parseFloat(String(v))
    return Number.isFinite(n) ? n : null
  }
  if (typeof v === 'object' && v !== null && 'value' in v) {
    return iouAmount((v as { value: unknown }).value)
  }
  return null
}

/** Tenth-bips → percent (1000 = 1.00%). */
export function tenthBipsToPct(v: unknown): number | null {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return n / 1000
}

export interface VaultShareHolder {
  address: string
  shareBalance: number
  sharePct: number
  depositedFusdc: number
}

export interface ChainLoan {
  id: string
  borrower: string
  principalFusdc: number
  vaultId: string
}

export interface LendPoolSnapshot {
  supply: {
    totalFusdc: number
    availableFusdc: number
    borrowedFusdc: number
    utilizationPct: number
    providerCount: number
    sharesOutstanding: number
  }
  borrow: {
    borrowerCount: number
    totalDebtFusdc: number
    brokerCoverFusdc: number
    debtMaximumFusdc: number | null
    coverRateMinPct: number | null
    coverRateLiqPct: number | null
    loansOutstanding: number
  }
  contributors: VaultShareHolder[]
  borrowers: Array<{ address: string; principalFusdc: number; loanId: string }>
}

export async function listVaultShareHolders(
  networkKey: NetworkKey,
  shareMptId: string,
  shareScale: number,
  sharesOutstanding: number,
  assetsTotal: number,
): Promise<VaultShareHolder[]> {
  const target = shareMptId.toUpperCase()
  const holders: VaultShareHolder[] = []
  let marker: unknown

  for (let page = 0; page < 24; page++) {
    const params: Record<string, unknown> = {
      type: 'mptoken',
      ledger_index: 'validated',
      limit: 200,
    }
    if (marker) params.marker = marker

    const r = await serverRpcCall<{
      state?: Array<Record<string, unknown>>
      marker?: unknown
    }>(networkKey, 'ledger_data', params)

    for (const obj of r.state ?? []) {
      const mptId = String(obj.MPTokenIssuanceID ?? obj.mpt_issuance_id ?? '').toUpperCase()
      if (mptId !== target) continue
      const rawBal = obj.MPTAmount ?? obj.Balance
      if (rawBal == null) continue
      const shareBalance = mptScaled(String(rawBal), shareScale)
      if (shareBalance <= 0) continue
      const sharePct = sharesOutstanding > 0 ? (shareBalance / sharesOutstanding) * 100 : 0
      const depositedFusdc =
        sharesOutstanding > 0 && assetsTotal > 0
          ? (shareBalance / sharesOutstanding) * assetsTotal
          : 0
      holders.push({
        address: String(obj.Account ?? ''),
        shareBalance,
        sharePct,
        depositedFusdc,
      })
    }

    if (!r.marker) break
    marker = r.marker
  }

  return holders.sort((a, b) => b.shareBalance - a.shareBalance)
}

export async function listChainLoans(networkKey: NetworkKey): Promise<ChainLoan[]> {
  const loans: ChainLoan[] = []
  let marker: unknown

  for (let page = 0; page < 24; page++) {
    const params: Record<string, unknown> = {
      type: 'loan',
      ledger_index: 'validated',
      limit: 200,
    }
    if (marker) params.marker = marker

    const r = await serverRpcCall<{
      state?: Array<Record<string, unknown>>
      marker?: unknown
    }>(networkKey, 'ledger_data', params, { allowError: true })

    for (const obj of r.state ?? []) {
      if (obj.LedgerEntryType !== 'Loan' && obj.ledger_entry_type !== 'Loan') continue
      const principal =
        iouAmount(obj.PrincipalOutstanding) ?? iouAmount(obj.TotalValueOutstanding) ?? 0
      if (principal <= 0) continue
      loans.push({
        id: String(obj.index ?? obj.LoanID ?? ''),
        borrower: String(obj.Borrower ?? ''),
        principalFusdc: principal,
        vaultId: String(obj.VaultID ?? ''),
      })
    }

    if (!r.marker) break
    marker = r.marker
  }

  return loans.sort((a, b) => b.principalFusdc - a.principalFusdc)
}

export async function fetchLoanBrokerNode(
  networkKey: NetworkKey,
  loanBrokerId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const r = await serverRpcCall<{ node?: Record<string, unknown> }>(
      networkKey,
      'ledger_entry',
      { loan_broker: loanBrokerId, ledger_index: 'validated' },
    )
    return r.node ?? null
  } catch {
    return null
  }
}

export function buildPoolSnapshot(
  assetsTotal: number,
  assetsAvailable: number,
  sharesOutstanding: number,
  contributors: VaultShareHolder[],
  chainLoans: ChainLoan[],
  broker: Record<string, unknown> | null,
): LendPoolSnapshot {
  const borrowedFusdc = Math.max(0, assetsTotal - assetsAvailable)
  const utilizationPct = assetsTotal > 0 ? (borrowedFusdc / assetsTotal) * 100 : 0
  const brokerDebt = iouAmount(broker?.DebtTotal) ?? null
  const loanDebt = chainLoans.reduce((s, l) => s + l.principalFusdc, 0)
  const totalDebtFusdc = brokerDebt != null && brokerDebt > 0 ? brokerDebt : loanDebt > 0 ? loanDebt : borrowedFusdc

  const loanSequence = Number(broker?.LoanSequence ?? 1)
  const loansFromBroker = loanSequence > 1 ? loanSequence - 1 : 0

  return {
    supply: {
      totalFusdc: assetsTotal,
      availableFusdc: assetsAvailable,
      borrowedFusdc,
      utilizationPct,
      providerCount: contributors.length,
      sharesOutstanding,
    },
    borrow: {
      borrowerCount: chainLoans.length > 0 ? chainLoans.length : loansFromBroker,
      totalDebtFusdc,
      brokerCoverFusdc: iouAmount(broker?.CoverAvailable) ?? 0,
      debtMaximumFusdc: iouAmount(broker?.DebtMaximum),
      coverRateMinPct: tenthBipsToPct(broker?.CoverRateMinimum),
      coverRateLiqPct: tenthBipsToPct(broker?.CoverRateLiquidation),
      loansOutstanding: chainLoans.length,
    },
    contributors,
    borrowers: chainLoans.map((l) => ({
      address: l.borrower,
      principalFusdc: l.principalFusdc,
      loanId: l.id,
    })),
  }
}