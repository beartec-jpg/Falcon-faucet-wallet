import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/

async function tokenRef() {
  try {
    const raw = await readFile(
      path.join(process.cwd(), 'public', 'config', 'testnet-stables.json'),
      'utf8',
    )
    const m = JSON.parse(raw) as { tokens?: Array<{ currency: string; issuer: string }> }
    const t = m.tokens?.[0]
    if (t?.issuer) return t
  } catch {
    /* ignore */
  }
  return null
}

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

  const token = await tokenRef()
  if (!token) {
    return NextResponse.json({ error: 'Stablecoin issuer not configured' }, { status: 503 })
  }

  const info = await serverRpcCall<{ account_data: { Sequence: number } }>(
    networkKey,
    'account_info',
    { account: address, ledger_index: 'validated' },
  )
  const ledger = await serverRpcCall<{ ledger_index: number }>(networkKey, 'ledger', {
    ledger_index: 'validated',
  })

  const sim = await serverRpcCall<{
    engine_result?: string
    engine_result_message?: string
  }>(networkKey, 'simulate', {
    tx_json: {
      TransactionType: 'ClaimAmmLpReward',
      Account: address,
      Asset: { currency: 'XRP' },
      Asset2: { currency: token.currency, issuer: token.issuer },
      Sequence: info.account_data.Sequence,
      Fee: '12',
      LastLedgerSequence: ledger.ledger_index + 20,
    },
  })

  const ok = sim.engine_result === 'tesSUCCESS'
  // Soft-pass non-funds / not-yet-live-protocol results so the UI can still try after upgrade.
  const softOk =
    ok ||
    ['tecNO_PERMISSION', 'tecNO_ENTRY', 'temDISABLED', 'temMALFORMED'].includes(
      sim.engine_result ?? '',
    )

  if (!ok && !softOk) {
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
    canClaim: ok,
    softPass: !ok,
    simulateResult: sim.engine_result,
    simulateMessage: sim.engine_result_message,
    currency: token.currency,
    issuer: token.issuer,
  })
}
