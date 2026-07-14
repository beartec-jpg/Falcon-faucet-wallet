import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { addCollateralBlockedReason } from '@/lib/lend-collateral-deposit'
import type { LendOverview } from '@/lib/lend-model'
import { collateralDropsFromFalcon } from '@/lib/lend-loan-onchain'
import { filterActiveUserLoans } from '@/lib/lend-risk-scan'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  let body: { address?: string; loanId?: string; collateralFalcon?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const address = body.address?.trim() ?? ''
  const loanId = body.loanId?.trim() ?? ''
  const collateralFalcon = parseFloat(body.collateralFalcon ?? '')
  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'Valid Falcon address required' }, { status: 400 })
  }
  if (!loanId) {
    return NextResponse.json({ error: 'loanId required' }, { status: 400 })
  }

  let lendingCollateral = false
  try {
    const feat = await serverRpcCall<{
      features?: Record<string, { name?: string; enabled?: boolean }>
    }>(networkKey, 'feature', {})
    for (const f of Object.values(feat.features ?? {})) {
      if (f.name === 'LendingCollateral') lendingCollateral = !!f.enabled
    }
  } catch {
    /* optional */
  }
  if (!lendingCollateral) {
    return NextResponse.json(
      { error: 'LendingCollateral amendment is not enabled on this network' },
      { status: 503 },
    )
  }

  const loanR = await serverRpcCall<{ account_objects?: Array<Record<string, unknown>> }>(
    networkKey,
    'account_objects',
    { account: address, type: 'loan', ledger_index: 'validated' },
    { allowError: true },
  )
  const active = filterActiveUserLoans(loanR.account_objects ?? [])
  const obj = active.find((o) => String(o.index ?? '') === loanId)
  if (!obj) {
    return NextResponse.json({ error: 'No active loan found for this account' }, { status: 400 })
  }

  let falconBalance: number | null = null
  try {
    const acct = await serverRpcCall<{ account_data: { Balance: string } }>(
      networkKey,
      'account_info',
      { account: address, ledger_index: 'validated' },
    )
    falconBalance = parseInt(acct.account_data.Balance, 10) / 1_000_000
  } catch {
    return NextResponse.json({ error: 'Account not found on ledger' }, { status: 400 })
  }

  const blocked = addCollateralBlockedReason(
    {
      protocol: {
        txSigningReady: true,
        lendingCollateral: true,
        lendingPermissionless: true,
        singleAssetVault: true,
        lendingProtocol: true,
        lendingReady: true,
        chainBuildPending: false,
        genesisRestartNeeded: false,
      },
      loans: [{
        id: loanId,
        vaultId: '',
        principalFusdc: parseFloat(String(obj.PrincipalOutstanding ?? '0')),
        paymentDueRaw: typeof obj.PeriodicPayment === 'string' ? obj.PeriodicPayment : null,
        paymentDueFusdc: null,
        totalOutstandingFusdc: parseFloat(String(obj.TotalValueOutstanding ?? '0')) || null,
        collateralFalcon: 0,
        healthFactor: null,
      }],
      wallet: { address, falconBalance, fusdcBalance: null, fusdcLimit: null, hasFusdcTrustLine: false },
    } as LendOverview,
    loanId,
    collateralFalcon,
  )
  if (blocked) {
    return NextResponse.json({ error: blocked }, { status: 400 })
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
    return NextResponse.json({ error: 'Could not load account sequence' }, { status: 400 })
  }

  const sim = await serverRpcCall<{
    engine_result?: string
    engine_result_message?: string
  }>(networkKey, 'simulate', {
    tx_json: {
      TransactionType: 'LoanCollateralDeposit',
      Account: address,
      LoanID: loanId.toUpperCase(),
      Collateral: collateralDropsFromFalcon(collateralFalcon),
      Sequence: sequence,
      Fee: '12',
      LastLedgerSequence: ledgerIndex + 20,
    },
  })

  const ok = sim.engine_result === 'tesSUCCESS'
  if (!ok) {
    return NextResponse.json(
      {
        error: `Add collateral would fail on-chain (${sim.engine_result ?? 'simulate error'}).`,
        simulateResult: sim.engine_result,
        simulateMessage: sim.engine_result_message,
        collateralFalcon,
        falconBalance,
      },
      { status: 400 },
    )
  }

  return NextResponse.json({
    ok: true,
    loanId,
    collateralFalcon,
    collateralDrops: collateralDropsFromFalcon(collateralFalcon),
    falconBalance,
  })
}