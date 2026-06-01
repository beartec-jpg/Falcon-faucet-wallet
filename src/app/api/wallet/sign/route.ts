// POST /api/wallet/sign
// Body: { tx_json: object, secret: string }
// Returns: { tx_blob, hash } | { error }
//
// Routes through the signing proxy so Falcon fields (FalconPublicKey +
// FalconSignature) are added — required by qXRP featureProofOfParticipation.
// 
// SECURITY: The SIGNER_PROXY_URL must be https:// in production.
// Plaintext transmission of the seed to the proxy is a known limitation (see H-1).
// Never use this wallet with real funds.

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PROXY_URL   = process.env.SIGNER_PROXY_URL
const PROXY_TOKEN = process.env.SIGNER_PROXY_TOKEN

// Simple origin allow-list for CSRF protection (M-3)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)

function isOriginAllowed(req: NextRequest): boolean {
  if (ALLOWED_ORIGINS.length === 0) return true // allow all if not configured (dev)
  const origin = req.headers.get('origin') || req.headers.get('referer') || ''
  return ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed))
}

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  let body: { tx_json?: unknown; secret?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body?.tx_json || typeof body.tx_json !== 'object') {
    return NextResponse.json({ error: 'Missing tx_json' }, { status: 400 })
  }
  if (!body?.secret || typeof body.secret !== 'string') {
    return NextResponse.json({ error: 'Missing secret' }, { status: 400 })
  }

  if (!PROXY_URL) {
    return NextResponse.json({ error: 'Signing proxy not configured' }, { status: 503 })
  }

  try {
    const proxyRes = await fetch(`${PROXY_URL}/sign`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        ...(PROXY_TOKEN ? { 'Authorization': `Bearer ${PROXY_TOKEN}` } : {}),
      },
      body: JSON.stringify({ tx_json: body.tx_json, secret: body.secret }),
    })

    if (!proxyRes.ok) {
      const text = await proxyRes.text().catch(() => '')
      return NextResponse.json(
        { error: `Signing proxy error: ${proxyRes.status} ${text}` },
        { status: 502 }
      )
    }

    const data = await proxyRes.json() as { tx_blob?: string; hash?: string; error?: string }

    if (data.error || !data.tx_blob) {
      return NextResponse.json(
        { error: data.error ?? 'Proxy returned no tx_blob' },
        { status: 502 }
      )
    }

    return NextResponse.json({ tx_blob: data.tx_blob, hash: data.hash })
  } catch (err: unknown) {
    console.error('[wallet/sign] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Signing request failed' }, // do not leak internal details
      { status: 502 }
    )
  }
}
