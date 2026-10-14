'use client'

import { useEffect, useState } from 'react'
import TrendChart from '@/components/explorer/TrendChart'
import { getClientSeries, type MetricPoint } from '@/lib/metric-history'
import { seatKey, SERIES_LABELS } from '@/lib/net-metrics'

export interface TrendPanel {
  /** Series key, or null for a metric the public status does not expose. */
  key: string | null
  label: string
  current?: string
  note?: string
  format?: (v: number) => string
}

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

/** Panels for one seat's box: tip/lag, its packs/min, perf, plus network tx/s and mempool. */
export function seatPanels(id: string, cur: { lag?: number | null; perf?: number | null; tps?: number | null; mempool?: number }): TrendPanel[] {
  return [
    { key: seatKey(id, 'lag'), label: SERIES_LABELS.lag, current: cur.lag == null ? 'not advertised' : String(cur.lag) },
    { key: seatKey(id, 'packs_min'), label: `${SERIES_LABELS.packs_min} (this seat)` },
    { key: 'tps', label: `${SERIES_LABELS.tps} (network)`, current: cur.tps == null ? undefined : cur.tps.toFixed(1) },
    { key: 'mempool', label: `${SERIES_LABELS.mempool} (serving node)`, current: cur.mempool == null ? undefined : String(cur.mempool) },
    {
      key: seatKey(id, 'perf'),
      label: SERIES_LABELS.perf,
      current: cur.perf == null ? undefined : cur.perf.toFixed(3),
      format: (v) => v.toFixed(3),
    },
    { key: null, label: SERIES_LABELS.cpu, note: 'Not in the public status endpoint. Needs a per-node CPU field in status_req.' },
  ]
}

export function networkPanels(cur: { tps?: number | null; bpm?: number | null; mempool?: number; peers?: number }): TrendPanel[] {
  return [
    { key: 'tps', label: SERIES_LABELS.tps, current: cur.tps == null ? undefined : cur.tps.toFixed(1) },
    { key: 'blocks_min', label: SERIES_LABELS.blocks_min, current: cur.bpm == null ? undefined : cur.bpm.toFixed(1) },
    { key: 'mempool', label: SERIES_LABELS.mempool, current: cur.mempool == null ? undefined : String(cur.mempool) },
    { key: 'txs_per_block', label: SERIES_LABELS.txs_per_block },
    { key: 'peers', label: SERIES_LABELS.peers, current: cur.peers == null ? undefined : String(cur.peers) },
    { key: 'online', label: SERIES_LABELS.online },
  ]
}

export default function TrendModal({
  title,
  subtitle,
  panels,
  onClose,
}: {
  title: string
  subtitle?: string
  panels: TrendPanel[]
  onClose: () => void
}) {
  const [server, setServer] = useState<HistoryJson | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    let alive = true
    void loadServerHistory().then((d) => alive && setServer(d))
    // Re-read the browser ring buffer as new minutes are committed.
    const iv = setInterval(() => tick((n) => n + 1), 15_000)
    return () => {
      alive = false
      clearInterval(iv)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const srvPts = server?.points ?? 0

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-[#020617]/80 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700 bg-[#0F172A] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trend-modal-title"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-800">
          <div>
            <h2 id="trend-modal-title" className="text-base font-semibold text-[#E0DBCA]">
              {title} · last 24 hours
            </h2>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
            <p className="text-[10px] text-slate-500 mt-1 font-mono">
              <span style={{ color: '#C07838' }}>━ shared server history</span> (5-min cron, {srvPts} pts
              {server?.backend ? ` · ${server.backend}` : ''}) ·{' '}
              <span style={{ color: '#D4922A' }}>┅ this browser</span> (60s, localStorage, while a tab is open)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 p-5">
          {panels.map((p, i) => {
            const srv = p.key ? (server?.series?.[p.key] ?? []) : []
            const cli = p.key ? getClientSeries(p.key) : []
            return (
              <div key={p.key ?? `na-${i}`} className="rounded-xl border border-slate-800 bg-[#020617]/60 p-3">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-xs text-slate-400">{p.label}</span>
                  {p.current != null && (
                    <span className="text-xs font-mono text-[#E0DBCA]">now {p.current}</span>
                  )}
                </div>
                {p.key ? (
                  <TrendChart series={srv} overlay={cli} height={130} format={p.format} idSuffix={`-${i}`} />
                ) : (
                  <div className="h-[130px] flex items-center justify-center text-center text-[11px] text-slate-600 px-6">
                    {p.note}
                  </div>
                )}
                {p.key && !srv.length && !cli.length && (
                  <p className="text-[10px] text-slate-600 mt-1">No samples yet for this series.</p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
