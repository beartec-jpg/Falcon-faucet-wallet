// POST /api/wallet/sign — Falcon signing via node1 proxy.

import { NextRequest, NextResponse } from 'next/server'
import { proxySign } from '@/lib/signer-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)

function isOriginAllowed(req: NextRequest): boolean {
  if (ALLOWED_ORIGINS.length === 0) return true
  const origin = req.headers.get('origin') || req.headers.get('referer') || ''
  return ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed))
}

export async function POST(req: NextRequest) {
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