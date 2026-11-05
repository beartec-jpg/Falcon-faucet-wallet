// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// Falcon Cloud self-serve API keys (portal Postgres is the source of truth). Table created on first use.
// Long-term we store only sha256(key). The encrypted plaintext (reveal_ciphertext) lives only until the
// one-time reveal or reveal_expires_at, whichever comes first.
import { getSql } from '@/lib/db'

export interface NewKeyRow {
  keyId: string
  sha256: string
  tier: string | null
  stripeCustomer: string | null
  checkoutSessionId: string
  subscriptionId: string | null
  email: string | null
  revealCiphertext: string
  revealExpiresAt: Date
}

export type TakeReveal =
  | { status: 'ready'; ciphertext: string; tier: string | null; keyId: string }
  | { status: 'pending' | 'revealed' | 'expired' }

export interface KeyRepo {
  /** Insert unless a key already exists for this checkout session. Returns true if inserted. */
  insertIfAbsent(row: NewKeyRow): Promise<boolean>
  /** Atomically take (and clear) the reveal copy for a checkout session. */
  takeReveal(checkoutSessionId: string, now?: Date): Promise<TakeReveal>
}

let ready: Promise<void> | null = null
function ensure(): Promise<void> {
  if (!ready) {
    const sql = getSql()
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS falcon_cloud_keys (
        key_id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL UNIQUE,
        tier TEXT,
        stripe_customer TEXT,
        checkout_session_id TEXT UNIQUE,
        subscription_id TEXT,
        email TEXT,
        disabled BOOLEAN NOT NULL DEFAULT FALSE,
        reveal_ciphertext TEXT,
        reveal_expires_at TIMESTAMPTZ,
        revealed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
      await sql`CREATE INDEX IF NOT EXISTS falcon_cloud_keys_subscription_idx ON falcon_cloud_keys (subscription_id)`
      await sql`ALTER TABLE falcon_cloud_keys ADD COLUMN IF NOT EXISTS ip_hash TEXT`
      await sql`CREATE INDEX IF NOT EXISTS falcon_cloud_keys_free_ip_idx ON falcon_cloud_keys (ip_hash, created_at)`
    })().catch((e) => { ready = null; throw e })
  }
  return ready
}

export const pgKeyRepo: KeyRepo = {
  async insertIfAbsent(r) {
    await ensure()
    const rows = await getSql()`INSERT INTO falcon_cloud_keys
      (key_id, sha256, tier, stripe_customer, checkout_session_id, subscription_id, email, reveal_ciphertext, reveal_expires_at)
      VALUES (${r.keyId}, ${r.sha256}, ${r.tier}, ${r.stripeCustomer}, ${r.checkoutSessionId}, ${r.subscriptionId}, ${r.email}, ${r.revealCiphertext}, ${r.revealExpiresAt.toISOString()})
      ON CONFLICT (checkout_session_id) DO NOTHING RETURNING key_id`
    return rows.length > 0
  },
  async takeReveal(sessionId, now = new Date()) {
    await ensure()
    const sql = getSql()
    // Single statement: lock the row, clear the ciphertext, return the old value.
    const taken = await sql`WITH old AS (
        SELECT key_id, tier, reveal_ciphertext FROM falcon_cloud_keys
        WHERE checkout_session_id = ${sessionId} AND reveal_ciphertext IS NOT NULL AND reveal_expires_at > ${now.toISOString()}
        FOR UPDATE)
      UPDATE falcon_cloud_keys k SET reveal_ciphertext = NULL, revealed_at = ${now.toISOString()}, updated_at = now()
      FROM old WHERE k.key_id = old.key_id
      RETURNING old.key_id, old.tier, old.reveal_ciphertext`
    if (taken.length) return { status: 'ready', ciphertext: taken[0].reveal_ciphertext, tier: taken[0].tier, keyId: taken[0].key_id }
    // Not revealable: clear any expired ciphertext and report why.
    const rows = await sql`UPDATE falcon_cloud_keys SET reveal_ciphertext = NULL, updated_at = now()
      WHERE checkout_session_id = ${sessionId} AND reveal_ciphertext IS NOT NULL AND reveal_expires_at <= ${now.toISOString()}
      RETURNING key_id`
    if (rows.length) return { status: 'expired' }
    const ex = await sql`SELECT revealed_at FROM falcon_cloud_keys WHERE checkout_session_id = ${sessionId}`
    if (!ex.length) return { status: 'pending' }
    return { status: ex[0].revealed_at ? 'revealed' : 'expired' }
  },
}

export interface ExportKey {
  key_id: string
  sha256: string
  tier: string | null
  stripe_customer: string | null
  disabled: boolean
}

/** Hash-only export for the fpl-gateway pull (never plaintext, never reveal ciphertext, never email). */
export async function listExportKeys(): Promise<ExportKey[]> {
  await ensure()
  const rows = await getSql()`SELECT key_id, sha256, tier, stripe_customer, disabled FROM falcon_cloud_keys ORDER BY created_at`
  return (rows as ExportKey[]).map((r) => ({
    key_id: r.key_id, sha256: r.sha256, tier: r.tier, stripe_customer: r.stripe_customer, disabled: !!r.disabled,
  }))
}

/** Disable (or re-enable) every key minted for a Stripe subscription. Returns the number of keys changed. */
export async function setKeysDisabledForSubscription(subscriptionId: string, disabled: boolean): Promise<number> {
  await ensure()
  const rows = await getSql()`UPDATE falcon_cloud_keys SET disabled = ${disabled}, updated_at = now()
    WHERE subscription_id = ${subscriptionId} AND disabled <> ${disabled} RETURNING key_id`
  return rows.length
}

/** Self-serve Free key: hash only, no reveal copy (the plaintext is returned once in the HTTP response). */
export async function insertFreeKey(r: { keyId: string; sha256: string; ipHash: string }): Promise<void> {
  await ensure()
  await getSql()`INSERT INTO falcon_cloud_keys (key_id, sha256, tier, ip_hash) VALUES (${r.keyId}, ${r.sha256}, 'free', ${r.ipHash})`
}

/** Free keys minted since `since`, for one IP hash and in total. */
export async function countFreeKeysSince(ipHash: string, since: Date): Promise<{ ip: number; total: number }> {
  await ensure()
  const rows = await getSql()`SELECT
      count(*) FILTER (WHERE ip_hash = ${ipHash})::int AS ip, count(*)::int AS total
    FROM falcon_cloud_keys WHERE tier = 'free' AND checkout_session_id IS NULL AND created_at > ${since.toISOString()}`
  return { ip: Number(rows[0]?.ip ?? 0), total: Number(rows[0]?.total ?? 0) }
}
