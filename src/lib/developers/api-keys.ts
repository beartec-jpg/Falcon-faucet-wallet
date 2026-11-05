// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// Falcon Cloud API key minting + short-lived encryption for the one-time reveal.
// Key shape matches fpl-gateway (tools/fpl-gateway/src/auth.rs): "fplk_" + 32 random bytes hex; only sha256(key) is kept long-term.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

export const KEY_PREFIX = 'fplk_'
/** How long the encrypted plaintext stays available for the one-time reveal. */
export const REVEAL_WINDOW_MS = 24 * 60 * 60 * 1000

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex')
}

/** Public, non-secret id (same style as the gateway's "k_3f9a1c"). */
export function keyIdFromHash(sha256: string): string {
  return `k_${sha256.slice(0, 12)}`
}

export function mintApiKey(): { key: string; sha256: string; id: string } {
  const key = `${KEY_PREFIX}${randomBytes(32).toString('hex')}`
  const sha256 = hashApiKey(key)
  return { key, sha256, id: keyIdFromHash(sha256) }
}

type Env = Record<string, string | undefined>

/** Secret used to encrypt the reveal copy. Dedicated var, falling back to the Falcon webhook secret. */
export function revealSecret(env: Env = process.env): string | null {
  return (env.FALCON_CLOUD_REVEAL_SECRET || env.STRIPE_WEBHOOK_SECRET_FALCON || env.STRIPE_WEBHOOK_SECRET)?.trim() || null
}

function aesKey(secret: string): Buffer {
  return createHash('sha256').update(`falcon-cloud-key-reveal:v1:${secret}`).digest()
}

/** AES-256-GCM; output "v1.<iv>.<tag>.<ct>" (base64url). */
export function encryptForReveal(plaintext: string, secret: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', aesKey(secret), iv)
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()])
  return ['v1', iv, c.getAuthTag(), ct].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.')
}

export function decryptForReveal(blob: string, secret: string): string {
  const [v, iv, tag, ct] = blob.split('.')
  if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('bad reveal blob')
  const d = createDecipheriv('aes-256-gcm', aesKey(secret), Buffer.from(iv, 'base64url'))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8')
}

export function isCheckoutSessionId(s: unknown): s is string {
  return typeof s === 'string' && /^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(s)
}
