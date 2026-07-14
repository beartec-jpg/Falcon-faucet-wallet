import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { loadLendingManifestServer } from '@/lib/lending-config'
import { isActiveVaultLp, mptScaled } from '@/lib/lend-pool-stats'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/
const BPS = 10_000
const DROPS = 1_000_000

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  let body: { address?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const address = body.address?.trim() ?? ''
  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'Valid Falcon address required' }, { status: 400 })
  }

  const manifest = await loadLendingManifestServer()
  if (!manifest?.vault_id) {
    return NextResponse.json({ error: 'Lend vault not configured' }, { status: 503 })
  }

  const v = await serverRpcCall<{
    vault?: Record<string, unknown>
    result?: { vault?: Record<string, unknown> }
  }>(networkKey, 'vault_info', { vault_id: manifest.vault_id, ledger_index: 'validated' })
  const vault = v.vault ?? v.result?.vault
  if (!vault) {
    return NextResponse.json({ error: 'Could not load vault state' }, { status: 503 })
  }

  const shares = (vault.shares ?? {}) as Record<string, unknown>
  const shareScale = Number(shares.AssetScale ?? vault.Scale ?? 6)
  const shareMptId = String(
    vault.ShareMPTID ?? shares.mpt_issuance_id ?? shares.MPTokenIssuanceID ?? '',
  ).toUpperCase()
  const sharesOutstanding = mptScaled(
    String(shares.OutstandingAmount ?? shares.outstanding_amount ?? '0'),
    shareScale,
  )

  const mptR = await serverRpcCall<{ account_objects?: Array<Record<string, unknown>> }>(
    networkKey,
    'account_objects',
    { account: address, type: 'mptoken', ledger_index: 'validated' },
    { allowError: true },
  )
  const mpt = (mptR.account_objects ?? []).find(
    (o) => String(o.MPTokenIssuanceID ?? '').toUpperCase() === shareMptId,
  )
  if (!mpt) {
    return NextResponse.json(
      { error: 'No vault shares on this account — supply F-USDC first', canClaim: false },
      { status: 400 },
    )
  }

  const rawBal = String(mpt.MPTAmount ?? mpt.Balance ?? '0')
  if (!isActiveVaultLp(rawBal, shareScale, sharesOutstanding)) {
    return NextResponse.json(
      { error: 'Vault share balance too small to claim', canClaim: false },
      { status: 400 },
    )
  }

  let epochNumber: number | null = null
  let lpAllocationBps: number | null = null
  let aggregateLpShares: number | null = null
  let emissionDrops = 0
  try {
    const epochR = await serverRpcCall<{ node?: Record<string, unknown> }>(
      networkKey,
      'ledger_entry',
      { reward_epoch: true, ledger_index: 'validated' },
      { allowError: true },
    )
    const epoch = epochR?.node
    if (epoch) {
      epochNumber = Number(epoch.EpochNumber ?? 0) || null
      lpAllocationBps = Number(epoch.LPAllocationBps ?? 0) || null
      aggregateLpShares = Number(epoch.AggregateLPShares ?? 0) || null
      const em = epoch.EmissionRate
      if (typeof em === 'string' || typeof em === 'number') {
        emissionDrops = parseInt(String(em), 10) || 0
      } else if (em && typeof em === 'object' && 'value' in em) {
        emissionDrops = parseInt(String((em as { value: unknown }).value), 10) || 0
      }
    }
  } catch {
    /* pre-epoch */
  }

  let lastClaimedEpoch: number | null = null
  try {
    const popR = await serverRpcCall<{ node?: Record<string, unknown> }>(
      networkKey,
      'ledger_entry',
      { pop_lp_state: { account: address, vault_id: manifest.vault_id }, ledger_index: 'validated' },
      { allowError: true },
    )
    const last = popR?.node?.LastClaimedEpoch
    if (last != null) lastClaimedEpoch = Number(last)
  } catch {
    /* no state */
  }

  let estEpochRewardFalcon: number | null = null
  let canClaim = false
  if (
    epochNumber != null &&
    aggregateLpShares != null &&
    aggregateLpShares > 0 &&
    emissionDrops > 0 &&
    lpAllocationBps != null
  ) {
    const rawUserShares = parseFloat(rawBal)
    const lpPoolDrops = Math.floor((emissionDrops * lpAllocationBps) / BPS)
    const shareDrops = Math.floor((lpPoolDrops * rawUserShares) / aggregateLpShares)
    estEpochRewardFalcon = shareDrops / DROPS
    canClaim = lastClaimedEpoch == null || lastClaimedEpoch < epochNumber
  }

  if (!canClaim) {
    return NextResponse.json(
      {
        error: estEpochRewardFalcon != null && estEpochRewardFalcon > 0
          ? 'Rewards already claimed for the current epoch'
          : 'No LP epoch rewards available yet',
        canClaim: false,
        estEpochRewardFalcon,
        claimableEpoch: epochNumber,
        lastClaimedEpoch,
      },
      { status: 400 },
    )
  }

  let sequence = 0
  let ledgerIndex = 0
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

  const sim = await serverRpcCall<{
    engine_result?: string
    engine_result_message?: string
  }>(networkKey, 'simulate', {
    tx_json: {
      TransactionType: 'ClaimLPReward',
      Account: address,
      VaultID: manifest.vault_id.toUpperCase(),
      Sequence: sequence,
      Fee: '12',
      LastLedgerSequence: ledgerIndex + 20,
    },
  })

  const ok = sim.engine_result === 'tesSUCCESS'
  if (!ok) {
    return NextResponse.json(
      {
        error: `Claim would fail on-chain (${sim.engine_result ?? 'simulate error'})`,
        canClaim: false,
        simulateResult: sim.engine_result,
        simulateMessage: sim.engine_result_message,
      },
      { status: 400 },
    )
  }

  return NextResponse.json({
    ok: true,
    canClaim: true,
    estEpochRewardFalcon,
    claimableEpoch: epochNumber,
    simulateResult: sim.engine_result,
  })
}