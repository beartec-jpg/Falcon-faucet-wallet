// 24h metric history: shared types plus the client-side fallback ring buffer.
//
// Sources, in order of preference (merged by the chart):
//   1. Server: GET /api/scan/history, filled every 5 min by /api/cron/sample-metrics
//      into the existing Neon/Redis store (shared by all visitors).
//   2. Client: this ring buffer in localStorage, one point per ~60s per series
//      while any explorer tab is open, kept for 24h.

import { seriesValues, type NetSample } from '@/lib/net-metrics'

/** Series key: a network key (`tps`, `mempool`, …) or a seat key (`seat.v1.lag`). */
export type MetricKey = string

export interface MetricPoint {
  t: number
  v: number
}

export type SeriesMap = Record<MetricKey, MetricPoint[]>

export const HOURS_24_MS = 24 * 60 * 60 * 1000
const STORAGE_KEY = 'falcon-explorer-history-v2'
/** One committed point per series per bucket. */
export const CLIENT_BUCKET_MS = 60_000
/** Do not compute a rate across a gap longer than this (tab closed, laptop asleep). */
const MAX_RATE_GAP_MS = 10 * 60_000
const MAX_POINTS = Math.ceil(HOURS_24_MS / CLIENT_BUCKET_MS) + 4

interface Stored {
  v: 2
  last: NetSample | null
  /** key → flat [t0, v0, t1, v1, …] to keep localStorage small. */
  s: Record<string, number[]>
}

function empty(): Stored {
  return { v: 2, last: null, s: {} }
}

function read(): Stored {
  if (typeof window === 'undefined') return empty()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty()
    const j = JSON.parse(raw) as Stored
    return j && j.v === 2 && j.s ? j : empty()
  } catch {
    return empty()
  }
}

function write(st: Stored) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(st))
  } catch {
    // Quota: drop the oldest half of every series and try once more.
    for (const k of Object.keys(st.s)) {
      const a = st.s[k]
      st.s[k] = a.slice(Math.floor(a.length / 4) * 2)
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(st))
    } catch {
      /* give up silently; live view still works */
    }
  }
}

function trimFlat(a: number[], cutoff: number): number[] {
  let i = 0
  while (i < a.length && a[i] < cutoff) i += 2
  const out = i ? a.slice(i) : a
  return out.length > MAX_POINTS * 2 ? out.slice(out.length - MAX_POINTS * 2) : out
}

/**
 * Feed every live poll in. Commits one point per series once a bucket has
 * elapsed since the previous commit, using that interval for rates.
 * Returns true when a point was committed.
 */
export function recordSample(sample: NetSample): boolean {
  const st = read()
  const last = st.last
  if (last && sample.t - last.t < CLIENT_BUCKET_MS) return false
  const base = last && sample.t - last.t <= MAX_RATE_GAP_MS ? last : null
  const vals = seriesValues(base, sample)
  const cutoff = sample.t - HOURS_24_MS
  for (const [k, v] of Object.entries(vals)) {
    if (!Number.isFinite(v)) continue
    const a = st.s[k] ?? []
    a.push(sample.t, v)
    st.s[k] = trimFlat(a, cutoff)
  }
  for (const k of Object.keys(st.s)) {
    st.s[k] = trimFlat(st.s[k], cutoff)
    if (!st.s[k].length) delete st.s[k]
  }
  st.last = sample
  write(st)
  return true
}

export function getClientSeries(key: MetricKey, now = Date.now()): MetricPoint[] {
  const a = read().s[key] ?? []
  const cutoff = now - HOURS_24_MS
  const out: MetricPoint[] = []
  for (let i = 0; i + 1 < a.length; i += 2) if (a[i] >= cutoff) out.push({ t: a[i], v: a[i + 1] })
  return out
}

/** Merge server and client points for one series, newest-wins on near-duplicate timestamps. */
export function mergeSeries(...lists: (MetricPoint[] | undefined)[]): MetricPoint[] {
  const cutoff = Date.now() - HOURS_24_MS
  const all = lists
    .flatMap((l) => l ?? [])
    .filter((p) => p.t >= cutoff && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t)
  const out: MetricPoint[] = []
  for (const p of all) {
    const prev = out[out.length - 1]
    if (prev && p.t - prev.t < 5_000) out[out.length - 1] = p
    else out.push(p)
  }
  return out
}

export function clearClientHistory() {
  if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY)
}
