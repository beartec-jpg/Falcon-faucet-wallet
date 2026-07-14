import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { borrowBlockedReason } from '@/lib/lend-borrow-errors'
import { collateralBlockedReason } from '@/lib/lend-collateral'
import { collateralDropsFromFalcon } from '@/lib/lend-loan-onchain'
import { loadLendingManifestServer } from '@/lib/lending-config'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'
import { loadStableToken } from '@/lib/swap/token-config'
import { getUsdcMarket } from '@/lib/swap/quote'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  let body: { address?: string; principal?: string; collateralFalcon?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const address = body.address?.trim() ?? ''
  const principal = parseFloat(body.principal ?? '')
  const collateralFalcon = parseFloat(body.collateralFalcon ?? '')
  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'Valid Falcon address required' }, { status: 400 })
  }
  if (!Number.isFinite(principal) || principal <= 0) {
    return NextResponse.json({ error: 'Enter a positive borrow amount' }, { status: 400 })
  }
  if (!Number.isFinite(collateralFalcon) || collateralFalcon <= 0) {
    return NextResponse.json({ error: 'Enter FALCON collateral amount' }, { status: 400 })
  }

  const manifest = await loadLendingManifestServer()
  if (!manifest?.loan_broker_id) {
    return NextResponse.json({ error: 'Lend broker not configured' }, { status: 503 })
  }
  let lendingPermissionless = false
  let lendingCollateral = false
  try {
    const feat = await serverRpcCall<{
      features?: Record<string, { name?: string; enabled?: boolean }>
    }>(networkKey, 'feature', {})
    for (const f of Object.values(feat.features ?? {})) {
      if (f.name === 'LendingPermissionless') lendingPermissionless = !!f.enabled
      if (f.name === 'LendingCollateral') lendingCollateral = !!f.enabled
    }
  } catch {
    /* optional */
  }
  const permissionless = lendingPermissionless && lendingCollateral
  if (!permissionless && !process.env.TESTNET_LENDING_BROKER_SECRET?.trim()) {
    return NextResponse.json({ error: 'Broker co-sign not configured on server' }, { status: 503 })
  }

  const stable = await loadStableToken()
  let falconBalance: number | null = null
  let fusdcBalance: number | null = null
  let hasFusdcTrustLine = false
  try {
    const acct = await serverRpcCall<{ account_data: { Balance: string } }>(
      networkKey,
      'account_info',
      { account: address, ledger_index: 'validated' },
    )
    falconBalance = parseInt(acct.account_data.Balance, 10) / 1_000_000
    const lines = await serverRpcCall<{
      lines?: Array<{ currency: string; account: string; balance: string }>
    }>(networkKey, 'account_lines', { account: address, ledger_index: 'validated' })
    const line = (lines.lines ?? []).find(
      (l) => l.currency === stable.currency && l.account === stable.issuer,
    )
    if (line) {
      hasFusdcTrustLine = true
      fusdcBalance = parseFloat(line.balance)
    }
  } catch {
    return NextResponse.json({ error: 'Account not found on ledger' }, { status: 400 })
  }

  let falconPerFusdc: number | null = null
  try {
    const m = await getUsdcMarket(networkKey, stable)
    if (m.market && m.market.xrpPool > 0) {
      falconPerFusdc = m.market.tokenPool / m.market.xrpPool
    }
  } catch {
    /* optional */
  }

  const collateralBlock = collateralBlockedReason(
    principal,
    collateralFalcon,
    falconBalance,
    falconPerFusdc,
  )
  if (collateralBlock) {
    return NextResponse.json({ error: collateralBlock }, { status: 400 })
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
      TransactionType: 'LoanSet',
      Account: address,
      LoanBrokerID: manifest.loan_broker_id.toUpperCase(),
      PrincipalRequested: String(principal),
      Collateral: collateralDropsFromFalcon(collateralFalcon),
      InterestRate: manifest.interest_rate_tenth_bps ?? 500,
      PaymentInterval: manifest.payment_interval ?? 86400,
      PaymentTotal: manifest.payment_total ?? 1,
      GracePeriod: manifest.grace_period ?? 3600,
      Flags: 0x00010000,
      Sequence: sequence,
      Fee: '24',
      LastLedgerSequence: ledgerIndex + 20,
    },
  })

  const ok = sim.engine_result === 'tesSUCCESS'
  if (!ok) {
    return NextResponse.json(
      {
        error: `Borrow would fail on-chain (${sim.engine_result ?? 'simulate error'}). Check vault liquidity${permissionless ? ' and FALCON collateral' : ' and broker cover'}.`,
        simulateResult: sim.engine_result,
        simulateMessage: sim.engine_result_message,
        principal,
        collateralFalcon,
        falconBalance,
        fusdcBalance,
        hasFusdcTrustLine,
      },
      { status: 400 },
    )
  }

  return NextResponse.json({
    ok: true,
    principal,
    collateralFalcon,
    collateralDrops: collateralDropsFromFalcon(collateralFalcon),
    falconBalance,
    fusdcBalance,
    hasFusdcTrustLine,
    falconPerFusdc,
    simulateResult: sim.engine_result,
  })
}