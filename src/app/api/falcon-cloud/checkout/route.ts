// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// POST /api/falcon-cloud/checkout { tier: 'builder' | 'scale' } -> { url } (Stripe Checkout, subscription mode, GBP, no tax, no invoices).
import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { getPriceId, normalizePaidTier } from '@/lib/developers/stripe-tiers'
import { stripeConfigured, stripeRequest } from '@/lib/developers/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function siteOrigin(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  return (env || req.nextUrl.origin).replace(/\/$/, '')
}

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  let body: { tier?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const tier = normalizePaidTier(body.tier)
  if (!tier) return NextResponse.json({ error: 'Unknown plan' }, { status: 400 })
  if (!stripeConfigured()) return NextResponse.json({ error: 'Online payment is not available yet. Email falconledger@beartec.uk.' }, { status: 503 })
  const price = getPriceId(tier)!
  const origin = siteOrigin(req)
  try {
    const session = await stripeRequest('POST', '/checkout/sessions', {
      mode: 'subscription',
      line_items: { 0: { price, quantity: 1 } },
      success_url: `${origin}/developers/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/developers/pricing?checkout=cancelled`,
      billing_address_collection: 'auto',
      allow_promotion_codes: 'false',
      metadata: { app: 'falcon-cloud', tier },
      subscription_data: { metadata: { app: 'falcon-cloud', tier } },
    })
    return NextResponse.json({ url: session.url })
  } catch (e) {
    console.error('falcon-cloud checkout failed:', (e as Error).message)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }
}
