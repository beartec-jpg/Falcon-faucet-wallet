import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { loadLendingManifestServer } from '@/lib/lending-config'
import { iouAmount, mptScaled } from '@/lib/lend-pool-stats'
import { normalizeVaultWithdrawAmount, fusdcFromShareBalance } from '@/lib/lend-vault-withdraw'
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
  const assetsAvailable = iouAmount(vault.AssetsAvailable) ?? 0
  const lossUnrealized = iouAmount(vault.LossUnrealized) ?? 0
  const shareMptId = String(
    vault.ShareMPTID ?? shares.mpt_issuance_id ?? shares.MPTokenIssuanceID ?? '',
  ).toUpperCase()
  return {
    assetsTotal,
    assetsAvailable,
    sharesOutstanding,
    shareScale,
    lossUnrealized,
    shareMptId,
  }
}

async function fetchShareBalance(
  networkKey: ReturnType<typeof resolveNetworkKey>,
  address: string,
  shareMptId: string,
  shareScale: number,
): Promise<number> {
  try {
    const r = await serverRpcCall<{
      account_objects?: Array<Record<string, unknown>>
    }>(networkKey, 'account_objects', {
      account: address,
      type: 'mptoken',
      ledger_index: 'validated',
    })
    const obj = (r.account_objects ?? []).find(
      (o) => String(o.MPTokenIssuanceID ?? '').toUpperCase() === shareMptId,
    )
    if (!obj) return 0
    return mptScaled(String(obj.MPTAmount ?? obj.Balance ?? '0'), shareScale)
  } catch {
    return 0
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
    return NextResponse.json({ error: 'Enter a positive withdraw amount' }, { status: 400 })
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

  const shareBalance = await fetchShareBalance(
    networkKey,
    address,
    vault.shareMptId,
    vault.shareScale,
  )
  if (shareBalance <= 0) {
    return NextResponse.json(
      { error: 'No vault shares on this account — supply F-USDC first' },
      { status: 400 },
    )
  }

  const maxFromShares = fusdcFromShareBalance(shareBalance, vault)
  if (maxFromShares != null && offered > maxFromShares + 1e-9) {
    return NextResponse.json(
      {
        error: `You only hold ~${maxFromShares.toLocaleString(undefined, { maximumFractionDigits: 6 })} F-USDC in vault shares`,
        shareBalance,
        maxFromShares,
      },
      { status: 400 },
    )
  }

  if (vault.assetsAvailable <= 0) {
    return NextResponse.json(
      {
        error: 'Vault has no liquid F-USDC — funds may be borrowed until loans are repaid',
        assetsAvailable: vault.assetsAvailable,
        shareBalance,
      },
      { status: 400 },
    )
  }

  if (offered > vault.assetsAvailable + 1e-9) {
    return NextResponse.json(
      {
        error: `Only ${vault.assetsAvailable.toLocaleString(undefined, { maximumFractionDigits: 6 })} F-USDC is liquid in the vault right now`,
        assetsAvailable: vault.assetsAvailable,
        shareBalance,
      },
      { status: 400 },
    )
  }

  const chainAmount = normalizeVaultWithdrawAmount(offered, vault, shareBalance)
  if (!chainAmount) {
    return NextResponse.json({ error: 'Amount too small for vault share redemption' }, { status: 400 })
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
      TransactionType: 'VaultWithdraw',
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
        error: `Withdraw would fail on-chain (${sim.engine_result ?? 'simulate error'}). Try a lower amount.`,
        chainAmount,
        offered,
        simulateResult: sim.engine_result,
        simulateMessage: sim.engine_result_message,
        shareBalance,
        assetsAvailable: vault.assetsAvailable,
      },
      { status: 400 },
    )
  }

  return NextResponse.json({
    chainAmount,
    offered,
    adjusted: Math.abs(parseFloat(chainAmount) - offered) > 1e-9,
    shareBalance,
    assetsAvailable: vault.assetsAvailable,
    simulateResult: sim.engine_result,
  })
}