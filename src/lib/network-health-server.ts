// Cron step + page data for /network/health. Server only.

import {
  advanceState,
  buildHealth,
  detect,
  discordMessages,
  markSent,
  reconcile,
  seatRows,
  type HealthState,
  type NetworkHealth,
} from '@/lib/network-health'
import { healthStore, type HealthStore } from '@/lib/network-health-store'
import { getStoredMetricSeries } from '@/lib/metric-store'
import { statusExact } from '@/lib/rails-pools-server'
import { SITE_URL } from '@/lib/seo'

type Obj = Record<string, unknown>
type Fetch = typeof fetch

/** Post to the webhook; false on any failure (alert stays un-notified and is retried next run). */
export async function postDiscord(url: string, body: unknown, f: Fetch = fetch): Promise<boolean> {
  try {
    const r = await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...(body as Obj), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(5000),
    })
    return r.ok
  } catch {
    return false
  }
}

/**
 * One cron run: advance state, detect, dedupe, notify. Discord only when
 * DISCORD_HEALTH_WEBHOOK_URL is set; without it nothing is sent and alerts are
 * kept (page only), so turning the webhook on later does not replay old ones.
 */
export async function runHealthAlerts(
  st: Obj,
  at = Date.now(),
  opts: { store?: HealthStore; webhook?: string | null; fetch?: Fetch; siteUrl?: string } = {},
): Promise<{ active: number; sent: number; recoveries: number; webhook: boolean }> {
  const store = opts.store ?? healthStore()
  const webhook = opts.webhook === undefined ? process.env.DISCORD_HEALTH_WEBHOOK_URL?.trim() || null : opts.webhook
  let s: HealthState = advanceState(st, await store.load(), at)
  s = reconcile(s, detect(st, s, seatRows(st, s), at), at)
  let sent = 0
  let recoveries = 0
  if (webhook) {
    for (const m of discordMessages(s, at, opts.siteUrl ?? SITE_URL)) {
      if (!(await postDiscord(webhook, m.msg, opts.fetch))) break
      s = markSent(s, m.fire, m.recover)
      sent += m.fire.length
      recoveries += m.recover
    }
  } else {
    // Silent mode: treat current alerts as known, drop recoveries.
    s = markSent(s, Object.keys(s.alerts), s.pendingRecoveries.length)
  }
  await store.save(s)
  return { active: Object.keys(s.alerts).length, sent, recoveries, webhook: !!webhook }
}

export async function networkHealth(at = Date.now()): Promise<NetworkHealth> {
  const [st, state, bpm] = await Promise.all([
    statusExact(),
    healthStore().load(),
    getStoredMetricSeries('blocks_min').catch(() => []),
  ])
  return buildHealth(st, state, bpm, at)
}
