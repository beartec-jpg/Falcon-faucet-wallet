// POST /api/wallet/sign
// Body: { tx_json: object, secret: string }
// Returns: { tx_blob, hash } | { error }
//
// Routes through the signing proxy so Falcon fields (FalconPublicKey +
// FalconSignature) are added — required by qXRP featureProofOfParticipation.
// The proxy is the only path that produces valid signed transactions.

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PROXY_URL   = process.env.SIGNER_PROXY_URL
const PROXY_TOKEN = process.env.SIGNER_PROXY_TOKEN

export async function POST(req: NextRequest) {
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sign request failed' },
      { status: 502 }
    )
  }
}
