import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { proxySign } from '@/lib/signer-proxy'
import { loadLendingManifestServer } from '@/lib/lending-config'
import { resolveNetworkKey } from '@/lib/network-server'
import { getNetwork } from '@/lib/networks'

/**
 * Testnet-only: broker owner co-signs LoanSet CounterpartySignature.
 * Only a fixed field allow-list is signed — client cannot inject extra keys.
 */
const LOANSET_ALLOW = new Set([
  'TransactionType',
  'Account',
  'Fee',
  'Sequence',
  'LastLedgerSequence',
  'NetworkID',
  'SigningPubKey',
  'LoanBrokerID',
  'LoanPrincipalAmount',
  'LoanOriginationFee',
  'LoanInterestRate',
  'LoanOverpaymentManagement',
  'LoanScaleManagement',
  'LoanLateInterestRate',
  'LoanCloseInterestRate',
  'LoanPeriodicPayment',
  'LoanPaymentInterval',
  'LoanTotalInstallments',
  'LoanCollateralType',
  'LoanCollateralAmount',
  'LoanCollateralAsset',
  'Flags',
])

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  if (networkKey !== 'testnet') {
    return NextResponse.json(
      { error: 'Co-sign only available on testnet' },
      { status: 400 },
    )
  }

  const brokerSecret = process.env.TESTNET_LENDING_BROKER_SECRET?.trim()
  if (!brokerSecret) {
    return NextResponse.json(
      { error: 'Lending broker secret not configured' },
      { status: 503 },
    )
  }

  let body: { tx_json?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const raw = body.tx_json
  if (!raw || typeof raw !== 'object') {
    return NextResponse.json({ error: 'tx_json required' }, { status: 400 })
  }
  if (raw.TransactionType !== 'LoanSet') {
    return NextResponse.json(
      { error: 'Only LoanSet co-sign supported' },
      { status: 400 },
    )
  }

  // Strip unknown fields before signing
  const tx_json: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (LOANSET_ALLOW.has(k)) tx_json[k] = v
  }
  tx_json.TransactionType = 'LoanSet'

  const manifest = await loadLendingManifestServer()
  if (!manifest) {
    return NextResponse.json(
      { error: 'Lending manifest not configured' },
      { status: 503 },
    )
  }

  const brokerId = String(tx_json.LoanBrokerID ?? '').toUpperCase()
  if (brokerId !== manifest.loan_broker_id.toUpperCase()) {
    return NextResponse.json(
      { error: 'LoanBrokerID does not match testnet manifest' },
      { status: 400 },
    )
  }

  try {
    const network = getNetwork(networkKey)
    const signed = await proxySign(tx_json, brokerSecret, {
      networkId: network.networkId,
      signatureTarget: 'CounterpartySignature',
    })
    return NextResponse.json({ tx_blob: signed.tx_blob, hash: signed.hash })
  } catch (e: unknown) {
    console.error('[cosign]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Co-sign failed' }, { status: 502 })
  }
}
