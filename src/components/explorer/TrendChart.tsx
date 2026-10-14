'use client'

import { useMemo } from 'react'
import type { MetricPoint } from '@/lib/metric-history'

const COPPER = '#C07838'
const GOLD = '#D4922A'

export interface TrendChartProps {
  series: MetricPoint[]
  /** Window to draw, ms (default 24h). */
  windowMs?: number
  height?: number
  /** Points from the second source (e.g. this browser) drawn in a lighter tone. */
  overlay?: MetricPoint[]
  format?: (v: number) => string
  compact?: boolean
  /** Break the line across gaps longer than this (ms). */
  gapMs?: number
  idSuffix?: string
}

function fmtTime(ts: number, windowMs: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    ...(windowMs <= 30 * 60_000 ? { second: '2-digit' } : {}),
  })
}

const defaultFmt = (v: number) =>
  Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : v.toFixed(Math.abs(v) >= 10 ? 1 : 2)

/** Lightweight SVG line chart. No chart library; renders hundreds of points cheaply. */
export default function TrendChart({
  series,
  windowMs = 24 * 60 * 60 * 1000,
  height = 160,
  overlay,
  format = defaultFmt,
  compact = false,
  gapMs = 15 * 60_000,
  idSuffix = '',
}: TrendChartProps) {
  const W = 640
  const H = height
  const pad = compact ? { l: 4, r: 4, t: 4, b: 4 } : { l: 48, r: 12, t: 12, b: 24 }

  const c = useMemo(() => {
    const now = Date.now()
    const minT = now - windowMs
    const pts = series.filter((p) => p.t >= minT)
    const ov = (overlay ?? []).filter((p) => p.t >= minT)
    const vals = [...pts, ...ov].map((p) => p.v)
    if (vals.length < 2) return null
    let min = Math.min(0, ...vals)
    let max = Math.max(...vals)
    if (min === max) {
      max = min + 1
    }
    max += (max - min) * 0.08
    const iw = W - pad.l - pad.r
    const ih = H - pad.t - pad.b
    const x = (t: number) => pad.l + ((t - minT) / windowMs) * iw
    const y = (v: number) => pad.t + ih - ((v - min) / (max - min)) * ih
    const path = (arr: MetricPoint[]) => {
      let d = ''
      for (let i = 0; i < arr.length; i++) {
        const gap = i === 0 || arr[i].t - arr[i - 1].t > gapMs
        d += `${gap ? 'M' : 'L'}${x(arr[i].t).toFixed(1)},${y(arr[i].v).toFixed(1)}`
      }
      return d
    }
    const line = path(pts)
    const area =
      pts.length > 1
        ? `${line}L${x(pts[pts.length - 1].t).toFixed(1)},${pad.t + ih}L${x(pts[0].t).toFixed(1)},${pad.t + ih}Z`
        : ''
    return { min, max, x, y, iw, ih, line, area, ov: path(ov), minT, now, last: pts[pts.length - 1] ?? ov[ov.length - 1] }
  }, [series, overlay, windowMs, H, gapMs, pad.l, pad.r, pad.t, pad.b])

  if (!c) {
    return (
      <div
        className="flex items-center justify-center text-[11px] text-slate-600 font-mono"
        style={{ height: compact ? H : H }}
      >
        collecting…
      </div>
    )
  }
  const gid = `tc-fill${idSuffix}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H }} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={COPPER} stopOpacity="0.35" />
          <stop offset="100%" stopColor={COPPER} stopOpacity="0" />
        </linearGradient>
      </defs>
      {!compact &&
        [c.min, (c.min + c.max) / 2, c.max].map((v, i) => (
          <g key={i}>
            <line x1={pad.l} x2={pad.l + c.iw} y1={c.y(v)} y2={c.y(v)} stroke="#1E293B" strokeWidth="1" />
            <text x={pad.l - 6} y={c.y(v) + 3} textAnchor="end" fill="#64748B" fontSize="10" fontFamily="JetBrains Mono, monospace">
              {format(v)}
            </text>
          </g>
        ))}
      {c.area && <path d={c.area} fill={`url(#${gid})`} />}
      {c.ov && <path d={c.ov} fill="none" stroke={GOLD} strokeOpacity="0.55" strokeWidth="1.25" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />}
      <path d={c.line} fill="none" stroke={COPPER} strokeWidth="1.75" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {!compact && (
        <>
          <text x={pad.l} y={H - 6} fill="#64748B" fontSize="10">{fmtTime(c.minT, windowMs)}</text>
          <text x={pad.l + c.iw} y={H - 6} textAnchor="end" fill="#64748B" fontSize="10">{fmtTime(c.now, windowMs)}</text>
        </>
      )}
    </svg>
  )
}
