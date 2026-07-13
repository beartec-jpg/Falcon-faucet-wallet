import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { loadLendingManifestServer } from '@/lib/lending-config'
import { iouAmount, mptScaled } from '@/lib/lend-pool-stats'
import { normalizeVaultDepositAmount } from '@/lib/lend-vault-deposit'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'
import { loadStableToken } from '@/lib/swap/token-config'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/

async function fetchVaultState(networkKey: ReturnType<typeof resolveNetworkKey>, vaultId: string) {
  const v = await serverRpcCall<{
    vault?: Record<string, unknown>
    result?: { vault?: Record<string, unknown> }
  }>(networkKey, 'vault_info', { vault_id: vaultId, ledger_index: 'validated' })
  const vault = v.vault ?? v.result?.vault
  if (!vault) return null
  const shares = (vault.shares ?? {}) as Record<string, unknown>
  const shareScale = Number(shares.AssetScale ?? vault.Scale ?? 6)
  const sharesOutstanding = mptScaled(
    String(shares.OutstandingAmount ?? shares.outstanding_amount ?? '0'),
    shareScale,
  )
  const assetsTotal = iouAmount(vault.AssetsTotal) ?? 0
  return { assetsTotal, sharesOutstanding, shareScale }
}

async function fetchFusdcBalance(
  networkKey: ReturnType<typeof resolveNetworkKey>,
  address: string,
  currency: string,
  issuer: string,
): Promise<{ balance: number | null; hasTrustLine: boolean }> {
  try {
    const linesR = await serverRpcCall<{
      lines?: Array<{ currency: string; account: string; balance: string }>
    }>(networkKey, 'account_lines', { account: address, ledger_index: 'validated' })
    const line = (linesR.lines ?? []).find((l) => l.currency === currency && l.account === issuer)
    if (!line) return { balance: null, hasTrustLine: false }
    const balance = parseFloat(line.balance)
    return {
      balance: Number.isFinite(balance) ? balance : null,
      hasTrustLine: true,
    }
  } catch {
    return { balance: null, hasTrustLine: false }
  }
}

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  let body: { address?: string; offered?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const address = body.address?.trim() ?? ''
  const offeredStr = body.offered?.trim() ?? ''
  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'Valid Falcon address required' }, { status: 400 })
  }

  const offered = parseFloat(offeredStr)
  if (!Number.isFinite(offered) || offered <= 0) {
    return NextResponse.json({ error: 'Enter a positive supply amount' }, { status: 400 })
  }

  const manifest = await loadLendingManifestServer()
  if (!manifest?.vault_id) {
    return NextResponse.json({ error: 'Lend vault not configured' }, { status: 503 })
  }

  const stable = await loadStableToken()
  const vault = await fetchVaultState(networkKey, manifest.vault_id)
  if (!vault) {
    return NextResponse.json({ error: 'Could not load vault state from ledger' }, { status: 503 })
  }

  const { balance: fusdcBalance, hasTrustLine } = await fetchFusdcBalance(
    networkKey,
    address,
    stable.currency,
    stable.issuer,
  )
  if (!hasTrustLine) {
    return NextResponse.json(
      { error: 'No F-USDC trust line — add via Bridge or Swap first' },
      { status: 400 },
    )
  }
  if (fusdcBalance != null && offered > fusdcBalance + 1e-9) {
    return NextResponse.json(
      {
        error: `Insufficient F-USDC (${fusdcBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })} available)`,
        fusdcBalance,
      },
      { status: 400 },
    )
  }

  const chainAmount = normalizeVaultDepositAmount(offered, vault)
  if (!chainAmount) {
    return NextResponse.json({ error: 'Amount too small for vault shares' }, { status: 400 })
  }
  const chainNum = parseFloat(chainAmount)
  if (fusdcBalance != null && chainNum > fusdcBalance + 1e-9) {
    return NextResponse.json(
      {
        error: `After share rounding, ${chainAmount} F-USDC is needed but you hold ${fusdcBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })}`,
        fusdcBalance,
        chainAmount,
      },
      { status: 400 },
    )
  }

  let sequence = 0
  let ledgerIndex = 0
  try {
    const info = await serverRpcCall<{ account_data: { Sequence: number } }>(
      networkKey,
      'account_info',
      { account: address, ledger_index: 'validated' },
    )
    sequence = info.account_data.Sequence
    const ledger = await serverRpcCall<{ ledger_index: number }>(networkKey, 'ledger', {
      ledger_index: 'validated',
    })
    ledgerIndex = ledger.ledger_index
  } catch {
    return NextResponse.json({ error: 'Account not found on ledger' }, { status: 400 })
  }

  const sim = await serverRpcCall<{
    engine_result?: string
    engine_result_message?: string
  }>(networkKey, 'simulate', {
    tx_json: {
      TransactionType: 'VaultDeposit',
      Account: address,
      VaultID: manifest.vault_id.toUpperCase(),
      Amount: { currency: stable.currency, issuer: stable.issuer, value: chainAmount },
      Sequence: sequence,
      Fee: '12',
      LastLedgerSequence: ledgerIndex + 20,
    },
  })

  const simulateOk = sim.engine_result === 'tesSUCCESS'
  if (!simulateOk) {
    return NextResponse.json(
      {
        error: `Deposit would fail on-chain (${sim.engine_result ?? 'simulate error'}). Try a slightly lower amount.`,
        chainAmount,
        offered,
        simulateResult: sim.engine_result,
        simulateMessage: sim.engine_result_message,
        fusdcBalance,
      },
      { status: 400 },
    )
  }

  return NextResponse.json({
    chainAmount,
    offered,
    adjusted: Math.abs(chainNum - offered) > 1e-9,
    fusdcBalance,
    simulateResult: sim.engine_result,
  })
}