// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// POST /api/falcon-cloud/stripe-webhook — verifies Stripe-Signature (STRIPE_WEBHOOK_SECRET_FALCON or STRIPE_WEBHOOK_SECRET)
// records Falcon Cloud subscription status in Postgres, and mints one API key per completed Checkout session. Ignores events for other apps on the shared account.
import { NextRequest, NextResponse } from 'next/server'
import { verifyStripeSignature, stripeRequest } from '@/lib/developers/stripe'
import { tierFromSubscription } from '@/lib/developers/stripe-tiers'
import { markEvent, upsertSubscription } from '@/lib/developers/subscription-store'
import { pgKeyRepo } from '@/lib/developers/key-store'
import { issueKeyForCheckout } from '@/lib/developers/key-service'
import { revealSecret } from '@/lib/developers/api-keys'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function record(sub: any, email: string | null) {
  const tier = tierFromSubscription(sub)
  if (!tier && sub?.metadata?.app !== 'falcon-cloud') return // another BEARTEC product
  const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end
  await upsertSubscription({
    subscriptionId: sub.id,
    customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
    email,
    tier,
    status: sub.status,
    currentPeriodEnd: end ? new Date(end * 1000) : null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
  })
}

export async function POST(req: NextRequest) {
  const secret = (process.env.STRIPE_WEBHOOK_SECRET_FALCON || process.env.STRIPE_WEBHOOK_SECRET)?.trim()
  if (!secret) return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  const payload = await req.text()
  if (!verifyStripeSignature(payload, req.headers.get('stripe-signature'), secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }
  const event = JSON.parse(payload)
  try {
    const obj = event.data?.object
    switch (event.type) {
      case 'checkout.session.completed': {
        if (obj?.mode !== 'subscription' || obj?.metadata?.app !== 'falcon-cloud' || !obj.subscription) break
        const sub = await stripeRequest('GET', `/subscriptions/${obj.subscription}`)
        const email = obj.customer_details?.email ?? null
        await record(sub, email)
        // Self-serve key: one per checkout session (idempotent on duplicate deliveries).
        const secret = revealSecret()
        if (!secret) throw new Error('reveal secret not configured')
        await issueKeyForCheckout(pgKeyRepo, {
          checkoutSessionId: obj.id,
          tier: tierFromSubscription(sub),
          stripeCustomer: typeof obj.customer === 'string' ? obj.customer : obj.customer?.id ?? null,
          subscriptionId: typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id ?? null,
          email,
        }, secret)
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await record(obj, null)
        break
      default:
        break
    }
    await markEvent(event.id, event.type)
  } catch (e) {
    console.error('falcon-cloud webhook failed:', (e as Error).message)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
  return NextResponse.json({ received: true })
}
