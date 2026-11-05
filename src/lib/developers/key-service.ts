// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// Mint-on-checkout and one-time reveal, independent of storage (see key-store.ts) for testing.
import { decryptForReveal, encryptForReveal, mintApiKey, REVEAL_WINDOW_MS } from './api-keys'
import type { KeyRepo } from './key-store'

export interface CheckoutKeyInput {
  checkoutSessionId: string
  tier: string | null
  stripeCustomer: string | null
  subscriptionId: string | null
  email: string | null
}

/** Mints one key per checkout session. Duplicate webhook deliveries do not create a second key. */
export async function issueKeyForCheckout(repo: KeyRepo, input: CheckoutKeyInput, secret: string, now = new Date()): Promise<{ created: boolean; keyId: string }> {
  const { key, sha256, id } = mintApiKey()
  const created = await repo.insertIfAbsent({
    keyId: id, sha256, ...input,
    revealCiphertext: encryptForReveal(key, secret),
    revealExpiresAt: new Date(now.getTime() + REVEAL_WINDOW_MS),
  })
  return { created, keyId: id }
}

export type RevealResult =
  | { status: 'ready'; key: string; tier: string | null; keyId: string }
  | { status: 'pending' | 'revealed' | 'expired' }

export async function revealKeyOnce(repo: KeyRepo, checkoutSessionId: string, secret: string, now = new Date()): Promise<RevealResult> {
  const r = await repo.takeReveal(checkoutSessionId, now)
  if (r.status !== 'ready') return r
  return { status: 'ready', key: decryptForReveal(r.ciphertext, secret), tier: r.tier, keyId: r.keyId }
}
