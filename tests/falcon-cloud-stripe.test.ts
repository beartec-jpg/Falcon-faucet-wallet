import { describe, expect, it } from 'vitest'
import { createHmac } from 'crypto'
import { verifyStripeSignature } from '@/lib/developers/stripe'
import { getPriceId, tierFromSubscription, PAID_TIER_CONFIG } from '@/lib/developers/stripe-tiers'

describe('falcon cloud stripe', () => {
  it('verifies v1 signatures and rejects tampering/stale', () => {
    const now = 1_800_000_000_000, t = now / 1000, body = '{"id":"evt_1"}'
    const sig = createHmac('sha256', 'whsec_x').update(`${t}.${body}`).digest('hex')
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_x', 300, now)).toBe(true)
    expect(verifyStripeSignature(body + ' ', `t=${t},v1=${sig}`, 'whsec_x', 300, now)).toBe(false)
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_x', 300, now + 600_000)).toBe(false)
  })
  it('prices match pricing page and env overrides pinned ids', () => {
    expect(PAID_TIER_CONFIG.builder.amountPence).toBe(2900)
    expect(PAID_TIER_CONFIG.scale.amountPence).toBe(19900)
    expect(getPriceId('builder', {})).toBe('price_1UXyStFpNHlFwPZA59Apabgo')
    expect(getPriceId('scale', { STRIPE_PRICE_FALCON_SCALE: 'price_abc' })).toBe('price_abc')
    expect(getPriceId('free', {})).toBeNull()
    expect(tierFromSubscription({ items: { data: [{ price: { id: 'price_1UXySvFpNHlFwPZA2c5aGWN5' } }] } }, {})).toBe('scale')
  })
})
