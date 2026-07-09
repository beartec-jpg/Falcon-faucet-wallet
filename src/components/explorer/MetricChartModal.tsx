'use client'

import { useEffect, useMemo } from 'react'
import type { MetricKey, MetricPoint } from '@/lib/metric-history'
import { METRIC_LABELS } from '@/lib/metric-history'

const HOURS_24_MS = 24 * 60 * 60 * 1000

interface MetricChartModalProps {
  metric: MetricKey
  series: MetricPoint[]
  currentValue: string | number
  onClose: () => void
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function fmtValue(key: MetricKey, v: number): string {
  if (key === 'tps') return v.toFixed(2)
  if (key === 'avg_close') return v.toFixed(2)
  if (key === 'base_fee' || key === 'median_fee') return Math.round(v).toLocaleString()
  return v.toLocaleString()
}

export default function MetricChartModal({ metric, series, currentValue, onClose }: MetricChartModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const chart = useMemo(() => {
    const W = 640
    const H = 220
    const pad = { l: 44, r: 16, t: 16, b: 32 }
    const innerW = W - pad.l - pad.r
    const innerH = H - pad.t - pad.b

    const now = Date.now()
    const minT = now - HOURS_24_MS
    const maxT = now

    if (series.length < 2) {
      return { W, H, path: '', area: '', min: 0, max: 0, yTicks: [] as number[], sparse: true, minT, maxT }
    }

    const inWindow = series.filter((p) => p.t >= minT && p.t <= maxT)
    if (inWindow.length < 2) {
      return { W, H, path: '', area: '', min: 0, max: 0, yTicks: [] as number[], sparse: true, minT, maxT }
    }
    const vals = inWindow.map((p) => p.v)
    let min = Math.min(...vals)
    let max = Math.max(...vals)
    if (min === max) {
      min -= Math.abs(min) * 0.1 || 1
      max += Math.abs(max) * 0.1 || 1
    }
    const range = max - min

    const coords = inWindow.map((p) => {
      const x = pad.l + ((p.t - minT) / Math.max(maxT - minT, 1)) * innerW
      const y = pad.t + innerH - ((p.v - min) / range) * innerH
      return { x, y }
    })

    const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
    const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${(pad.t + innerH).toFixed(1)} L${coords[0].x.toFixed(1)},${(pad.t + innerH).toFixed(1)} Z`

    const yTicks = [min, min + range * 0.5, max]

    return { W, H, path: line, area, min, max, yTicks, sparse: false, pad, innerW, innerH, minT, maxT }
  }, [series])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="metric-chart-title"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-800">
          <div>
            <h2 id="metric-chart-title" className="text-base font-semibold text-white">
              {METRIC_LABELS[metric]}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Last 24 hours · current <span className="font-mono text-slate-300">{currentValue}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Close chart"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4">
          {chart.sparse ? (
            <div className="h-48 flex flex-col items-center justify-center text-sm text-slate-500 gap-2">
              <p>Building 24h history — samples are stored centrally every 5 minutes.</p>
              <p className="text-xs text-slate-600">Check back shortly; all users share the same chart data.</p>
            </div>
          ) : (
            <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="w-full h-auto" aria-hidden>
              <defs>
                <linearGradient id="metric-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(59, 130, 246)" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="rgb(59, 130, 246)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {chart.yTicks.map((v, i) => {
                const y = chart.pad!.t + chart.innerH! - ((v - chart.min) / (chart.max - chart.min)) * chart.innerH!
                return (
                  <g key={i}>
                    <line x1={chart.pad!.l} y1={y} x2={chart.pad!.l + chart.innerW!} y2={y} stroke="rgb(51,65,85)" strokeWidth="1" />
                    <text x={chart.pad!.l - 6} y={y + 4} textAnchor="end" fill="rgb(100,116,139)" fontSize="10" fontFamily="monospace">
                      {fmtValue(metric, v)}
                    </text>
                  </g>
                )
              })}
              <path d={chart.area} fill="url(#metric-fill)" />
              <path d={chart.path} fill="none" stroke="rgb(96, 165, 250)" strokeWidth="2" strokeLinejoin="round" />
              <text x={chart.pad!.l} y={chart.H - 8} fill="rgb(100,116,139)" fontSize="10">{fmtTime(chart.minT!)}</text>
              <text x={chart.pad!.l + chart.innerW!} y={chart.H - 8} textAnchor="end" fill="rgb(100,116,139)" fontSize="10">{fmtTime(chart.maxT!)}</text>
            </svg>
          )}
        </div>
      </div>
    </div>
  )
}