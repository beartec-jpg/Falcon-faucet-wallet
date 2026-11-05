// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { FREE_KEYS_PER_DAY_TOTAL, FREE_KEYS_PER_IP_PER_DAY, freeMintAllowed, hashIp, keyDisabledForStatus } from '@/lib/developers/key-policy'

describe('key lifecycle from Stripe status', () => {
  it('disables on cancel / unpaid / past_due, re-enables on active, ignores incomplete', () => {
    for (const s of ['canceled', 'unpaid', 'past_due', 'incomplete_expired', 'paused']) expect(keyDisabledForStatus(s)).toBe(true)
    for (const s of ['active', 'trialing']) expect(keyDisabledForStatus(s)).toBe(false)
    expect(keyDisabledForStatus('incomplete')).toBeNull()
    expect(keyDisabledForStatus(undefined)).toBeNull()
  })
  it('webhook wires deleted + payment_failed to key disable', () => {
    const w = readFileSync('src/app/api/falcon-cloud/stripe-webhook/route.ts', 'utf8')
    expect(w).toMatch(/customer\.subscription\.deleted[\s\S]*status: 'canceled'/)
    expect(w).toMatch(/invoice\.payment_failed[\s\S]*setKeysDisabledForSubscription\(subId, true\)/)
  })
})

describe('free self-serve limits', () => {
  it('caps per IP and in total', () => {
    expect(freeMintAllowed({ ip: 0, total: 0 })).toBe('ok')
    expect(freeMintAllowed({ ip: FREE_KEYS_PER_IP_PER_DAY, total: 0 })).toBe('ip')
    expect(freeMintAllowed({ ip: 0, total: FREE_KEYS_PER_DAY_TOTAL })).toBe('total')
  })
  it('hashes IPs with a salt, never raw', () => {
    const h = hashIp('1.2.3.4', 's')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toBe(hashIp('1.2.3.4', 't'))
  })
  it('free route stores only the hash and requires terms + browser origin', () => {
    const r = readFileSync('src/app/api/falcon-cloud/free-key/route.ts', 'utf8')
    expect(r).toMatch(/requireBrowserOrigin/)
    expect(r).toMatch(/acceptTerms !== true/)
    expect(r).toMatch(/insertFreeKey\(\{ keyId: id, sha256, ipHash \}\)/)
  })
})
