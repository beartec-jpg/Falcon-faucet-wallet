'use client'

import { useEffect, useMemo, useState } from 'react'
import TrendChart from '@/components/explorer/TrendChart'
import { getClientSeries, mergeSeries, type MetricPoint } from '@/lib/metric-history'
import { seatKey, seriesLabel, SERIES_LABELS } from '@/lib/net-metrics'

interface HistoryJson {
  series?: Record<string, MetricPoint[]>
  backend?: string
  points?: number
}

let cache: { at: number; data: HistoryJson } | null = null
let inflight: Promise<HistoryJson> | null = null

/** Server 24h history, shared across modals, refreshed at most once a minute. */
export async function loadServerHistory(): Promise<HistoryJson> {
  if (cache && Date.now() - cache.at < 60_000) return cache.data
  inflight ??= fetch('/api/scan/history', { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<HistoryJson>) : { series: {} }))
    .catch(() => ({ series: {} }) as HistoryJson)
    .then((data) => {
      cache = { at: Date.now(), data }
      inflight = null
      return data
    })
  return inflight
}

export interface MetricOption {
  key: string
  label: string
  current?: string
}

const fmt = (v: number) =>
  !Number.isFinite(v) ? '—' : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(Math.abs(v) >= 10 ? 1 : 2)

/**
 * One 24h chart for one metric. Server history (5-min cron) is primary; this
 * browser's localStorage buffer (60s) fills in. `options` adds a small picker
 * (used for a seat's metrics); `extra` renders under the stats (e.g. live windows).
 */
export default function MetricModal({
  metric,
  title,
  current,
  options,
  extra,
  onClose,
}: {
  metric: string
  title?: string
  current?: string
  options?: MetricOption[]
  extra?: React.ReactNode
  onClose: () => void
}) {
  const [key, setKey] = useState(metric)
  const [server, setServer] = useState<HistoryJson | null>(null)
  const [, tick] = useState(0)

  useEffect(() => setKey(metric), [metric])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    let alive = true
    void loadServerHistory().then((d) => alive && setServer(d))
    const iv = setInterval(() => tick((n) => n + 1), 15_000)
    return () => {
      alive = false
      clearInterval(iv)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const opt = options?.find((o) => o.key === key)
  const label = opt?.label ?? title ?? seriesLabel(key)
  const cur = opt ? opt.current : current
  const srv = server?.series?.[key] ?? []
  const cli = getClientSeries(key)
  const stats = useMemo(() => {
    const all = mergeSeries(srv, cli)
    if (!all.length) return null
    let min = Infinity
    let max = -Infinity
    let sum = 0
    for (const p of all) {
      min = Math.min(min, p.v)
      max = Math.max(max, p.v)
      sum += p.v
    }
    return { min, max, avg: sum / all.length, n: all.length, from: all[0].t }
  }, [srv, cli])

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-[#020617]/80 backdrop-blur-sm" onClick={onClose} role="presentation">
      <div
        className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-[#0F172A] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="metric-modal-title"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-800">
          <div>
            <h2 id="metric-modal-title" className="text-base font-semibold text-[#E0DBCA]">
              {label} · last 24 hours
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              now <span className="font-mono text-[#E0DBCA]">{cur ?? '—'}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {options && options.length > 1 && (
          <div className="flex flex-wrap gap-1.5 px-5 pt-3">
            {options.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setKey(o.key)}
                className={`text-xs px-2.5 py-1 rounded-lg border ${
                  o.key === key ? 'border-[#C07838] text-[#D4922A] bg-[#C07838]/10' : 'border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
        <div className="px-5 py-4">
          <TrendChart series={srv} overlay={cli} height={220} idSuffix="-mm" />
          <div className="grid grid-cols-3 gap-3 mt-3 text-center">
            {(['min', 'avg', 'max'] as const).map((k) => (
              <div key={k} className="rounded-lg border border-slate-800 py-2">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">24h {k}</div>
                <div className="font-mono text-sm text-[#E0DBCA]">{stats ? fmt(stats[k]) : '—'}</div>
              </div>
            ))}
          </div>
          {extra}
          <p className="text-[10px] text-slate-500 mt-3 font-mono">
            <span style={{ color: '#C07838' }}>━ server history</span> (5-min cron, {srv.length} pts{server?.backend ? ` · ${server.backend}` : ''}) ·{' '}
            <span style={{ color: '#D4922A' }}>┅ this browser</span> (60s, {cli.length} pts)
            {stats ? ` · covers since ${new Date(stats.from).toLocaleTimeString()}` : ' · no samples yet'}
          </p>
        </div>
      </div>
    </div>
  )
}

/** Picker options for one seat: advertised tip, lag, packs/min, perf. */
export function seatOptions(id: string, cur: { tip?: string; lag?: string; packs?: string; perf?: string }) {
  return [
    { key: seatKey(id, 'tip'), label: `${id} · ${SERIES_LABELS.tip}`, current: cur.tip },
    { key: seatKey(id, 'lag'), label: `${id} · ${SERIES_LABELS.lag}`, current: cur.lag },
    { key: seatKey(id, 'packs_min'), label: `${id} · ${SERIES_LABELS.packs_min}`, current: cur.packs },
    { key: seatKey(id, 'perf'), label: `${id} · ${SERIES_LABELS.perf}`, current: cur.perf },
  ]
}
