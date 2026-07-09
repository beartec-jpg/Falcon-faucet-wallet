// Central 24h metric time series — Upstash Redis (shared across all users / instances).

import { Redis } from '@upstash/redis'
import type { MetricKey, MetricPoint } from '@/lib/metric-history'

export const METRIC_KEYS: MetricKey[] = [
  'tps',
  'avg_close',
  'base_fee',
  'median_fee',
  'tx_queue',
  'peers',
]

const HOURS_24_MS = 24 * 60 * 60 * 1000
const DEDUPE_MS = 55_000
const REDIS_PREFIX = 'falcon:metrics:v1'

const memStore = new Map<MetricKey, MetricPoint[]>()

function redisClient(): Redis | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token || !url.startsWith('https://')) return null
  return new Redis({ url, token })
}

function trim(points: MetricPoint[], now = Date.now()): MetricPoint[] {
  const cutoff = now - HOURS_24_MS
  return points.filter((p) => p.t >= cutoff).sort((a, b) => a.t - b.t)
}

function mergePoints(existing: MetricPoint[], incoming: MetricPoint[]): MetricPoint[] {
  const byT = new Map<number, number>()
  for (const p of [...existing, ...incoming]) byT.set(p.t, p.v)
  return trim(
    [...byT.entries()].map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t),
  )
}

function appendMem(key: MetricKey, value: number, at: number): void {
  const prev = memStore.get(key) ?? []
  const last = prev[prev.length - 1]
  const next =
    last && at - last.t < DEDUPE_MS
      ? [...prev.slice(0, -1), { t: at, v: value }]
      : [...prev, { t: at, v: value }]
  memStore.set(key, trim(next, at))
}

function parseZEntry(member: string, score: number): MetricPoint | null {
  const parts = member.split(':')
  const v = Number(parts[parts.length - 1])
  if (!Number.isFinite(v)) return null
  return { t: score, v }
}

export function metricStoreBackend(): 'redis' | 'memory' {
  return redisClient() ? 'redis' : 'memory'
}

/** Append live samples (deduped ~1/min per metric). */
export async function appendMetricSamples(
  samples: Partial<Record<MetricKey, number>>,
  at = Date.now(),
): Promise<void> {
  const redis = redisClient()
  const cutoff = at - HOURS_24_MS

  for (const key of METRIC_KEYS) {
    const value = samples[key]
    if (value == null || !Number.isFinite(value)) continue

    if (redis) {
      const zkey = `${REDIS_PREFIX}:${key}`
      const rows = await redis.zrange(zkey, -1, -1, { withScores: true })
      const lastScore = rows.length >= 2 ? Number(rows[1]) : 0
      if (lastScore && at - lastScore < DEDUPE_MS) {
        await redis.zrem(zkey, rows[0] as string)
      }
      await redis.zadd(zkey, { score: at, member: `${at}:${value}` })
      await redis.zremrangebyscore(zkey, 0, cutoff)
    } else {
      appendMem(key, value, at)
    }
  }
}

export async function getStoredMetricSeries(key: MetricKey): Promise<MetricPoint[]> {
  const redis = redisClient()
  const cutoff = Date.now() - HOURS_24_MS

  if (redis) {
    const zkey = `${REDIS_PREFIX}:${key}`
    await redis.zremrangebyscore(zkey, 0, cutoff)
    const rows = await redis.zrange(zkey, 0, -1, { withScores: true })
    const out: MetricPoint[] = []
    for (let i = 0; i < rows.length; i += 2) {
      const p = parseZEntry(String(rows[i]), Number(rows[i + 1]))
      if (p && p.t >= cutoff) out.push(p)
    }
    return out.sort((a, b) => a.t - b.t)
  }

  return trim(memStore.get(key) ?? [])
}

export async function getAllStoredSeries(): Promise<Partial<Record<MetricKey, MetricPoint[]>>> {
  const out: Partial<Record<MetricKey, MetricPoint[]>> = {}
  await Promise.all(
    METRIC_KEYS.map(async (key) => {
      const series = await getStoredMetricSeries(key)
      if (series.length) out[key] = series
    }),
  )
  return out
}

export async function mergeIntoStore(incoming: Partial<Record<MetricKey, MetricPoint[]>>): Promise<void> {
  const redis = redisClient()
  const now = Date.now()
  const cutoff = now - HOURS_24_MS

  for (const key of METRIC_KEYS) {
    const points = incoming[key]
    if (!points?.length) continue
    const fresh = points.filter((p) => p.t >= cutoff)
    if (!fresh.length) continue

    if (redis) {
      const zkey = `${REDIS_PREFIX}:${key}`
      const pipe = redis.pipeline()
      for (const p of fresh) {
        pipe.zadd(zkey, { score: p.t, member: `${p.t}:${p.v}` })
      }
      pipe.zremrangebyscore(zkey, 0, cutoff)
      await pipe.exec()
    } else {
      memStore.set(key, mergePoints(memStore.get(key) ?? [], fresh))
    }
  }
}