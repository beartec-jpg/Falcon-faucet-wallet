import { serverRpcCall, type resolveNetworkKey } from '@/lib/network-server'

type NetworkKey = ReturnType<typeof resolveNetworkKey>

export function mptScaled(raw: string | number | undefined | null, scale: number): number {
  if (raw == null || raw === '') return 0
  const n = typeof raw === 'string' ? parseFloat(raw) : raw
  if (!Number.isFinite(n)) return 0
  return n / 10 ** scale
}

/** Integer MPT amount from ledger (OutstandingAmount / MPTAmount). */
export function mptRawAmount(raw: string | number | undefined | null): bigint {
  const s = String(raw ?? '0').trim()
  if (!s || s === '0') return 0n
  try {
    return BigInt(s.includes('.') ? s.split('.')[0] : s)
  } catch {
    return 0n
  }
}

/** Ignore empty MPToken lines and dust left after VaultWithdraw (shows as 0% in UI). */
export const MIN_LP_SHARE_PCT = 0.001

export function isActiveVaultLp(
  rawBal: string | number | undefined | null,
  shareScale: number,
  sharesOutstanding: number,
): boolean {
  if (mptRawAmount(rawBal) <= 0n) return false
  const shareBalance = mptScaled(String(rawBal), shareScale)
  if (!Number.isFinite(shareBalance) || shareBalance <= 0) return false
  if (sharesOutstanding <= 0) return true
  const sharePct = (shareBalance / sharesOutstanding) * 100
  return sharePct >= MIN_LP_SHARE_PCT
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

/** Loan is active when it still has installments or outstanding balance on-chain. */
export function isActiveChainLoan(obj: Record<string, unknown>): boolean {
  const paymentRemaining = Number(obj.PaymentRemaining ?? 0)
  if (Number.isFinite(paymentRemaining) && paymentRemaining > 0) return true
  const principal = iouAmount(obj.PrincipalOutstanding) ?? 0
  if (principal > 0) return true
  const total = iouAmount(obj.TotalValueOutstanding) ?? 0
  return total > 0
}

/** Best-effort F-USDC still owed on an active loan object. */
export function loanOutstandingFusdc(obj: Record<string, unknown>): number {
  const total = iouAmount(obj.TotalValueOutstanding)
  if (total != null && total > 0) return total
  const principal = iouAmount(obj.PrincipalOutstanding)
  if (principal != null && principal > 0) return principal
  const paymentRemaining = Number(obj.PaymentRemaining ?? 0)
  if (Number.isFinite(paymentRemaining) && paymentRemaining > 0) {
    const installment = iouAmount(obj.PeriodicPayment) ?? 0
    if (installment > 0) return installment * paymentRemaining
  }
  return 0
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
      const rawBalStr = String(rawBal)
      if (!isActiveVaultLp(rawBalStr, shareScale, sharesOutstanding)) continue
      const shareBalance = mptScaled(rawBalStr, shareScale)
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
      if (!isActiveChainLoan(obj)) continue
      const outstanding = loanOutstandingFusdc(obj)
      if (outstanding <= 0) continue
      loans.push({
        id: String(obj.index ?? obj.LoanID ?? ''),
        borrower: String(obj.Borrower ?? ''),
        principalFusdc: outstanding,
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
  const loanDebt = chainLoans.reduce((s, l) => s + l.principalFusdc, 0)
  // Vault liquidity is source of truth for F-USDC drawn; loan sum can lag stale objects.
  const totalDebtFusdc = loanDebt > 0 ? loanDebt : borrowedFusdc

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
      borrowerCount: chainLoans.length,
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