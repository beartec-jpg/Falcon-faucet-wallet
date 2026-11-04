// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// Falcon Cloud subscription status, written by the Stripe webhook. Table created on first use.
import { getSql } from '@/lib/db'

let ready: Promise<void> | null = null

function ensure(): Promise<void> {
  if (!ready) {
    const sql = getSql()
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS falcon_cloud_subscriptions (
        subscription_id TEXT PRIMARY KEY,
        customer_id TEXT,
        email TEXT,
        tier TEXT,
        status TEXT NOT NULL,
        current_period_end TIMESTAMPTZ,
        cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
      await sql`CREATE TABLE IF NOT EXISTS falcon_cloud_stripe_events (
        event_id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    })().catch((e) => { ready = null; throw e })
  }
  return ready
}

/** Returns false if the event was already processed. */
export async function markEvent(id: string, type: string): Promise<boolean> {
  await ensure()
  const rows = await getSql()`INSERT INTO falcon_cloud_stripe_events (event_id, type) VALUES (${id}, ${type}) ON CONFLICT DO NOTHING RETURNING event_id`
  return rows.length > 0
}

export interface SubRow {
  subscriptionId: string
  customerId: string | null
  email: string | null
  tier: string | null
  status: string
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

export async function upsertSubscription(r: SubRow): Promise<void> {
  await ensure()
  await getSql()`INSERT INTO falcon_cloud_subscriptions
    (subscription_id, customer_id, email, tier, status, current_period_end, cancel_at_period_end)
    VALUES (${r.subscriptionId}, ${r.customerId}, ${r.email}, ${r.tier}, ${r.status}, ${r.currentPeriodEnd?.toISOString() ?? null}, ${r.cancelAtPeriodEnd})
    ON CONFLICT (subscription_id) DO UPDATE SET
      customer_id = COALESCE(EXCLUDED.customer_id, falcon_cloud_subscriptions.customer_id),
      email = COALESCE(EXCLUDED.email, falcon_cloud_subscriptions.email),
      tier = COALESCE(EXCLUDED.tier, falcon_cloud_subscriptions.tier),
      status = EXCLUDED.status,
      current_period_end = COALESCE(EXCLUDED.current_period_end, falcon_cloud_subscriptions.current_period_end),
      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      updated_at = now()`
}
