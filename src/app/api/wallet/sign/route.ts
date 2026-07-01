// POST /api/wallet/sign — DEPRECATED and DISABLED BY DEFAULT.
//
// New wallets sign locally in the browser via WASM; falcon_secret must NEVER be
// sent to the server. This legacy endpoint forwards a full falcon_secret to the
// signing proxy and therefore contradicts the wallet's security model.
//
// It is disabled unless an operator explicitly sets ENABLE_LEGACY_SIGN=true for
// a specific legacy integration, in which case a strict origin allow-list is
// still enforced.

import { NextRequest, NextResponse } from 'next/server'
import { proxySign } from '@/lib/signer-proxy'
import { isOriginAllowed } from '@/lib/origin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LEGACY_SIGN_ENABLED = process.env.ENABLE_LEGACY_SIGN === 'true'

export async function POST(req: NextRequest) {
  if (!LEGACY_SIGN_ENABLED) {
    return NextResponse.json(
      { error: 'This endpoint is disabled. Wallets sign locally in the browser.' },
      { status: 410 },
    )
  }

  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  let body: { tx_json?: unknown; falcon_secret?: unknown; secret?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const tx_json = body.tx_json
  const falcon_secret = body.falcon_secret ?? body.secret

  if (!tx_json || typeof tx_json !== 'object' || Array.isArray(tx_json)) {
    return NextResponse.json({ error: 'tx_json object required' }, { status: 400 })
  }
  if (!falcon_secret || typeof falcon_secret !== 'string' || falcon_secret.length < 100) {
    return NextResponse.json({ error: 'falcon_secret required' }, { status: 400 })
  }

  try {
    const signed = await proxySign(tx_json as Record<string, unknown>, falcon_secret)
    return NextResponse.json({ tx_blob: signed.tx_blob, hash: signed.hash })
  } catch {
    return NextResponse.json({ error: 'Signing request failed' }, { status: 502 })
  }
}
