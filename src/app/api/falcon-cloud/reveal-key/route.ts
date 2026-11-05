// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// POST /api/falcon-cloud/reveal-key { sessionId } -> one-time reveal of the API key minted for a Checkout session.
// 200 { status: 'ready', key, tier, keyId } once; afterwards { status: 'revealed' }. 'pending' = webhook not processed yet.
import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { isCheckoutSessionId, revealSecret } from '@/lib/developers/api-keys'
import { pgKeyRepo } from '@/lib/developers/key-store'
import { revealKeyOnce } from '@/lib/developers/key-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  let body: { sessionId?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!isCheckoutSessionId(body.sessionId)) return NextResponse.json({ error: 'Invalid session' }, { status: 400 })
  const secret = revealSecret()
  if (!secret) return NextResponse.json({ error: 'Key delivery not configured' }, { status: 503 })
  try {
    const r = await revealKeyOnce(pgKeyRepo, body.sessionId, secret)
    return NextResponse.json(r, { headers: noStore })
  } catch (e) {
    console.error('falcon-cloud reveal failed:', (e as Error).message)
    return NextResponse.json({ error: 'Could not load your key. Please try again.' }, { status: 500, headers: noStore })
  }
}
