// Central 24h metric time series — Neon Postgres (preferred), Upstash Redis, or memory.

import { Redis } from '@upstash/redis'
import type { MetricKey, MetricPoint } from '@/lib/metric-history'
import { getSql, isDbConfigured } from '@/lib/db'

export const METRIC_KEYS: MetricKey[] = [
  'tps',
  'avg_close',
  'base_fee',
  'median_fee',
  'tx_queue',
  'peers',
]

export type MetricStoreBackend = 'postgres' | 'redis' | 'memory'

export const METRIC_RETENTION_MS = 24 * 60 * 60 * 1000
const HOURS_24_MS = METRIC_RETENTION_MS
const DEDUPE_MS = 55_000
const REDIS_PREFIX = 'falcon:metrics:v1'

const memStore = new Map<MetricKey, MetricPoint[]>()
let pgReady = false

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

async function ensurePgTable(): Promise<void> {
  if (pgReady || !isDbConfigured()) return
  const sql = getSql()
  await sql`
    CREATE TABLE IF NOT EXISTS explorer_metric_samples (
      metric_key TEXT NOT NULL,
      sampled_at BIGINT NOT NULL,
      value DOUBLE PRECISION NOT NULL,
      PRIMARY KEY (metric_key, sampled_at)
    )
  `
  await sql`
    CREATE INDEX IF NOT EXISTS explorer_metric_samples_key_time
      ON explorer_metric_samples (metric_key, sampled_at DESC)
  `
  pgReady = true
}

export function metricStoreBackend(): MetricStoreBackend {
  if (isDbConfigured()) return 'postgres'
  if (redisClient()) return 'redis'
  return 'memory'
}

function retentionCutoff(at = Date.now()): number {
  return at - HOURS_24_MS
}

/** Drop samples older than 24h. Called after every batch write and on cron. */
export async function pruneMetricSamples(at = Date.now()): Promise<number> {
  const cutoff = retentionCutoff(at)
  const backend = metricStoreBackend()

  if (backend === 'postgres' && isDbConfigured()) {
    await ensurePgTable()
    const sql = getSql()
    const deleted = await sql`
      DELETE FROM explorer_metric_samples WHERE sampled_at < ${cutoff}
    `
    return deleted.length
  }

  if (backend === 'redis') {
    const redis = redisClient()
    if (redis) {
      for (const key of METRIC_KEYS) {
        await redis.zremrangebyscore(`${REDIS_PREFIX}:${key}`, 0, cutoff)
      }
    }
    return 0
  }

  for (const key of METRIC_KEYS) {
    memStore.set(key, trim(memStore.get(key) ?? [], at))
  }
  return 0
}

async function appendPg(key: MetricKey, value: number, at: number): Promise<void> {
  await ensurePgTable()
  const sql = getSql()
  const recent = await sql`
    SELECT sampled_at FROM explorer_metric_samples
    WHERE metric_key = ${key}
    ORDER BY sampled_at DESC
    LIMIT 1
  `
  const lastAt = recent[0]?.sampled_at != null ? Number(recent[0].sampled_at) : 0
  if (lastAt && at - lastAt < DEDUPE_MS) {
    await sql`
      DELETE FROM explorer_metric_samples
      WHERE metric_key = ${key} AND sampled_at = ${lastAt}
    `
  }
  await sql`
    INSERT INTO explorer_metric_samples (metric_key, sampled_at, value)
    VALUES (${key}, ${at}, ${value})
    ON CONFLICT (metric_key, sampled_at) DO UPDATE SET value = EXCLUDED.value
  `
}

async function getPgSeries(key: MetricKey, cutoff: number): Promise<MetricPoint[]> {
  await ensurePgTable()
  const sql = getSql()
  const rows = await sql`
    SELECT sampled_at, value FROM explorer_metric_samples
    WHERE metric_key = ${key} AND sampled_at >= ${cutoff}
    ORDER BY sampled_at ASC
  `
  return rows.map((r) => ({ t: Number(r.sampled_at), v: Number(r.value) }))
}

async function mergePg(key: MetricKey, points: MetricPoint[], cutoff: number): Promise<void> {
  await ensurePgTable()
  const sql = getSql()
  for (const p of points) {
    if (p.t < cutoff) continue
    await sql`
      INSERT INTO explorer_metric_samples (metric_key, sampled_at, value)
      VALUES (${key}, ${p.t}, ${p.v})
      ON CONFLICT (metric_key, sampled_at) DO UPDATE SET value = EXCLUDED.value
    `
  }
}

/** Append live samples (deduped ~1/min per metric). */
export async function appendMetricSamples(
  samples: Partial<Record<MetricKey, number>>,
  at = Date.now(),
): Promise<void> {
  const backend = metricStoreBackend()
  const redis = backend === 'redis' ? redisClient() : null

  for (const key of METRIC_KEYS) {
    const value = samples[key]
    if (value == null || !Number.isFinite(value)) continue

    if (backend === 'postgres') {
      await appendPg(key, value, at)
    } else if (redis) {
      const zkey = `${REDIS_PREFIX}:${key}`
      const rows = await redis.zrange(zkey, -1, -1, { withScores: true })
      const lastScore = rows.length >= 2 ? Number(rows[1]) : 0
      if (lastScore && at - lastScore < DEDUPE_MS) {
        await redis.zrem(zkey, rows[0] as string)
      }
      await redis.zadd(zkey, { score: at, member: `${at}:${value}` })
    } else {
      appendMem(key, value, at)
    }
  }

  await pruneMetricSamples(at)
}

export async function getStoredMetricSeries(key: MetricKey): Promise<MetricPoint[]> {
  const backend = metricStoreBackend()
  const cutoff = retentionCutoff()
  await pruneMetricSamples()

  if (backend === 'postgres') {
    return getPgSeries(key, cutoff)
  }

  const redis = backend === 'redis' ? redisClient() : null
  if (redis) {
    const zkey = `${REDIS_PREFIX}:${key}`
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
  const backend = metricStoreBackend()
  const now = Date.now()
  const cutoff = retentionCutoff(now)
  const redis = backend === 'redis' ? redisClient() : null

  for (const key of METRIC_KEYS) {
    const points = incoming[key]
    if (!points?.length) continue
    const fresh = points.filter((p) => p.t >= cutoff)
    if (!fresh.length) continue

    if (backend === 'postgres') {
      await mergePg(key, fresh, cutoff)
    } else if (redis) {
      const zkey = `${REDIS_PREFIX}:${key}`
      const pipe = redis.pipeline()
      for (const p of fresh) {
        pipe.zadd(zkey, { score: p.t, member: `${p.t}:${p.v}` })
      }
      await pipe.exec()
    } else {
      memStore.set(key, mergePoints(memStore.get(key) ?? [], fresh))
    }
  }

  await pruneMetricSamples(now)
}