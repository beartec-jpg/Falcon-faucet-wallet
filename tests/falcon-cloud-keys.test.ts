// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptForReveal, encryptForReveal, hashApiKey, isCheckoutSessionId, mintApiKey, REVEAL_WINDOW_MS } from '@/lib/developers/api-keys'
import type { KeyRepo, NewKeyRow, TakeReveal } from '@/lib/developers/key-store'
import { issueKeyForCheckout, revealKeyOnce } from '@/lib/developers/key-service'

/** In-memory KeyRepo with the same semantics as pgKeyRepo. */
function memRepo() {
  const rows = new Map<string, NewKeyRow & { revealedAt: Date | null; revealCiphertext: string | null }>()
  const repo: KeyRepo = {
    async insertIfAbsent(r) {
      if (rows.has(r.checkoutSessionId)) return false
      rows.set(r.checkoutSessionId, { ...r, revealedAt: null })
      return true
    },
    async takeReveal(id, now = new Date()): Promise<TakeReveal> {
      const r = rows.get(id)
      if (!r) return { status: 'pending' }
      if (r.revealCiphertext && r.revealExpiresAt > now) {
        const ct = r.revealCiphertext; r.revealCiphertext = null; r.revealedAt = now
        return { status: 'ready', ciphertext: ct, tier: r.tier, keyId: r.keyId }
      }
      r.revealCiphertext = null
      return { status: r.revealedAt ? 'revealed' : 'expired' }
    },
  }
  return { repo, rows }
}

const SECRET = 'whsec_test_secret'
const SID = 'cs_test_a1B2c3D4e5F6g7H8'
const input = { checkoutSessionId: SID, tier: 'builder', stripeCustomer: 'cus_123', subscriptionId: 'sub_123', email: 'dev@example.com' }

describe('api key minting', () => {
  it('matches the gateway key shape and hashes with sha256', () => {
    const { key, sha256, id } = mintApiKey()
    expect(key).toMatch(/^fplk_[0-9a-f]{64}$/)
    expect(sha256).toBe(hashApiKey(key))
    expect(id).toBe(`k_${sha256.slice(0, 12)}`)
    expect(mintApiKey().key).not.toBe(key)
  })
  it('round-trips the reveal blob and rejects the wrong secret', () => {
    const blob = encryptForReveal('fplk_abc', SECRET)
    expect(blob).not.toContain('fplk_abc')
    expect(decryptForReveal(blob, SECRET)).toBe('fplk_abc')
    expect(() => decryptForReveal(blob, 'other')).toThrow()
  })
  it('validates checkout session ids', () => {
    expect(isCheckoutSessionId(SID)).toBe(true)
    expect(isCheckoutSessionId('cs_live_x')).toBe(false)
    expect(isCheckoutSessionId("cs_test_abc'; DROP")).toBe(false)
  })
})

describe('issue + one-time reveal', () => {
  it('stores only the hash plus an encrypted reveal copy', async () => {
    const { repo, rows } = memRepo()
    await issueKeyForCheckout(repo, input, SECRET)
    const row = rows.get(SID)!
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(row)).not.toMatch(/fplk_/)
    const r = await revealKeyOnce(repo, SID, SECRET)
    expect(r.status).toBe('ready')
    if (r.status === 'ready') expect(hashApiKey(r.key)).toBe(row.sha256)
    expect(row.revealCiphertext).toBeNull()
  })
  it('reveals once; refresh returns revealed', async () => {
    const { repo } = memRepo()
    await issueKeyForCheckout(repo, input, SECRET)
    expect((await revealKeyOnce(repo, SID, SECRET)).status).toBe('ready')
    expect(await revealKeyOnce(repo, SID, SECRET)).toEqual({ status: 'revealed' })
  })
  it('is pending before the webhook and expired after the window', async () => {
    const { repo, rows } = memRepo()
    expect(await revealKeyOnce(repo, SID, SECRET)).toEqual({ status: 'pending' })
    const t0 = new Date('2026-11-05T12:00:00Z')
    await issueKeyForCheckout(repo, input, SECRET, t0)
    expect(await revealKeyOnce(repo, SID, SECRET, new Date(t0.getTime() + REVEAL_WINDOW_MS + 1))).toEqual({ status: 'expired' })
    expect(rows.get(SID)!.revealCiphertext).toBeNull()
  })
  it('does not mint a second key for the same session', async () => {
    const { repo, rows } = memRepo()
    expect((await issueKeyForCheckout(repo, input, SECRET)).created).toBe(true)
    expect((await issueKeyForCheckout(repo, input, SECRET)).created).toBe(false)
    expect(rows.size).toBe(1)
  })
})

// --- webhook route with mocked Stripe + stores ---
const mem = memRepo()
const subs: unknown[] = []
vi.mock('@/lib/developers/key-store', () => ({ pgKeyRepo: mem.repo }))
vi.mock('@/lib/developers/subscription-store', () => ({
  markEvent: vi.fn(async () => true),
  upsertSubscription: vi.fn(async (r: unknown) => { subs.push(r) }),
}))
vi.mock('@/lib/developers/stripe', async (orig) => ({
  ...(await orig<typeof import('@/lib/developers/stripe')>()),
  stripeRequest: vi.fn(async () => ({
    id: 'sub_123', customer: 'cus_123', status: 'active', metadata: { app: 'falcon-cloud', tier: 'builder' },
    items: { data: [{ price: { id: 'price_1UXyStFpNHlFwPZA59Apabgo', product: 'prod_VZ6gq52IeeR7iB' }, current_period_end: 1800000000 }] },
  })),
}))

function signed(body: string) {
  const t = Math.floor(Date.now() / 1000)
  const sig = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')
  return new Request('http://localhost/api/falcon-cloud/stripe-webhook', { method: 'POST', body, headers: { 'stripe-signature': `t=${t},v1=${sig}` } })
}

describe('stripe webhook mints a key', () => {
  beforeEach(() => { mem.rows.clear(); subs.length = 0; process.env.STRIPE_WEBHOOK_SECRET_FALCON = SECRET })
  const event = JSON.stringify({
    id: 'evt_1', type: 'checkout.session.completed',
    data: { object: { id: SID, mode: 'subscription', subscription: 'sub_123', customer: 'cus_123', metadata: { app: 'falcon-cloud', tier: 'builder' }, customer_details: { email: 'dev@example.com' } } },
  })
  it('records the subscription and mints exactly one key across duplicate deliveries', async () => {
    const { POST } = await import('@/app/api/falcon-cloud/stripe-webhook/route')
    const r1 = await POST(signed(event) as never)
    const r2 = await POST(signed(event) as never)
    expect(r1.status).toBe(200); expect(r2.status).toBe(200)
    expect(subs.length).toBe(2)
    expect(mem.rows.size).toBe(1)
    const row = mem.rows.get(SID)!
    expect(row).toMatchObject({ tier: 'builder', stripeCustomer: 'cus_123', subscriptionId: 'sub_123', email: 'dev@example.com' })
    const r = await revealKeyOnce(mem.repo, SID, SECRET)
    expect(r.status).toBe('ready')
  })
  it('ignores other apps and bad signatures', async () => {
    const { POST } = await import('@/app/api/falcon-cloud/stripe-webhook/route')
    const other = JSON.stringify({ id: 'evt_2', type: 'checkout.session.completed', data: { object: { id: SID, mode: 'subscription', subscription: 'sub_9', metadata: { app: 'other' } } } })
    expect((await POST(signed(other) as never)).status).toBe(200)
    expect(mem.rows.size).toBe(0)
    const bad = new Request('http://localhost/x', { method: 'POST', body: event, headers: { 'stripe-signature': 't=1,v1=00' } })
    expect((await POST(bad as never)).status).toBe(400)
    expect(mem.rows.size).toBe(0)
  })
})
