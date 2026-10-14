import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { proxySign } from '@/lib/signer-proxy'
import { loadLendingManifestServer } from '@/lib/lending-config'
import { resolveNetworkKey } from '@/lib/network-server'
import { getNetwork } from '@/lib/networks'
import { retiredOnPl } from '@/lib/pl-retired'
import { clientIp } from '@/lib/security'
import { consumeRateLimit, peekRateLimit } from '@/lib/rate-limit'
import { checkLoanSet, cosignLimitsFromEnv } from '@/lib/lend-cosign-policy'

/**
 * Testnet-only: broker owner co-signs LoanSet CounterpartySignature.
 *
 * Audit M-2: disabled unless LEND_COSIGN_ENABLED=true. When enabled, terms must match the
 * lending manifest, the principal is capped (LEND_COSIGN_MAX_PRINCIPAL), only the exact
 * LoanSet fields are accepted, and calls are rate-limited per IP and per borrower account.
 */
export async function POST(req: NextRequest) {
  const retired = retiredOnPl(req)
  if (retired) return retired
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

  if (process.env.LEND_COSIGN_ENABLED?.toLowerCase() !== 'true') {
    return NextResponse.json({ error: 'Broker co-sign is disabled' }, { status: 410 })
  }

  const brokerSecret = process.env.TESTNET_LENDING_BROKER_SECRET?.trim()
  if (!brokerSecret) {
    return NextResponse.json(
      { error: 'Lending broker secret not configured' },
      { status: 503 },
    )
  }

  let body: { tx_json?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const manifest = await loadLendingManifestServer()
  if (!manifest) {
    return NextResponse.json(
      { error: 'Lending manifest not configured' },
      { status: 503 },
    )
  }

  const network = getNetwork(networkKey)
  const verdict = checkLoanSet(body.tx_json, manifest, network.networkId, cosignLimitsFromEnv(process.env))
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.error }, { status: 400 })
  }
  const tx_json = verdict.tx

  const ipKey = `cosign:ip:${clientIp(req)}`
  const acctKey = `cosign:acct:${String(tx_json.Account)}`
  const [ipLimit, acctLimit] = await Promise.all([peekRateLimit(ipKey), peekRateLimit(acctKey)])
  if (!ipLimit.success || !acctLimit.success) {
    return NextResponse.json(
      { error: 'Too many co-sign requests', reset: ipLimit.success ? acctLimit.reset : ipLimit.reset },
      { status: 429 },
    )
  }
  await Promise.all([consumeRateLimit(ipKey), consumeRateLimit(acctKey)])

  try {
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
