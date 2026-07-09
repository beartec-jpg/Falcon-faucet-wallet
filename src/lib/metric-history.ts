export type MetricKey = 'tps' | 'avg_close' | 'base_fee' | 'median_fee' | 'tx_queue' | 'peers'

export interface MetricPoint {
  t: number
  v: number
}

const HOURS_24_MS = 24 * 60 * 60 * 1000
const STORAGE_KEY = 'falcon-explorer-metrics-v1'

type StoredSeries = Partial<Record<MetricKey, MetricPoint[]>>

function readStore(): StoredSeries {
  if (typeof window === 'undefined') return {}
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredSeries) : {}
  } catch {
    return {}
  }
}

function writeStore(data: StoredSeries) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch { /* quota */ }
}

function trimSeries(points: MetricPoint[], now = Date.now()): MetricPoint[] {
  const cutoff = now - HOURS_24_MS
  return points.filter((p) => p.t >= cutoff).sort((a, b) => a.t - b.t)
}

export function appendMetricPoint(key: MetricKey, value: number, at = Date.now()): MetricPoint[] {
  if (!Number.isFinite(value)) return getMetricSeries(key)
  const store = readStore()
  const prev = store[key] ?? []
  const last = prev[prev.length - 1]
  const next = trimSeries(
    last && Math.abs(last.t - at) < 2000
      ? [...prev.slice(0, -1), { t: at, v: value }]
      : [...prev, { t: at, v: value }],
    at,
  )
  store[key] = next
  writeStore(store)
  return next
}

export function mergeMetricSeries(key: MetricKey, incoming: MetricPoint[]): MetricPoint[] {
  const store = readStore()
  const merged = trimSeries([...(store[key] ?? []), ...incoming])
  store[key] = merged
  writeStore(store)
  return merged
}

export function getMetricSeries(key: MetricKey): MetricPoint[] {
  return trimSeries(readStore()[key] ?? [])
}

export const METRIC_LABELS: Record<MetricKey, string> = {
  tps: 'TPS (est.)',
  avg_close: 'Avg close (s)',
  base_fee: 'Base fee (drops)',
  median_fee: 'Median fee (drops)',
  tx_queue: 'TX queue',
  peers: 'Peers',
}