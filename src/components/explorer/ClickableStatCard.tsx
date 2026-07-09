'use client'

import type { MetricKey } from '@/lib/metric-history'

interface ClickableStatCardProps {
  label: string
  value: string | number
  sub?: string
  accent?: string
  chartKey?: MetricKey
  onChart?: (key: MetricKey) => void
}

export default function ClickableStatCard({
  label,
  value,
  sub,
  accent,
  chartKey,
  onChart,
}: ClickableStatCardProps) {
  const clickable = chartKey && onChart

  const body = (
    <>
      <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
      <span className={`text-2xl font-bold font-mono ${accent ?? 'text-slate-100'}`}>{value}</span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
      {clickable && (
        <span className="text-[10px] text-brand-400/80 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          Click for 24h chart
        </span>
      )}
    </>
  )

  if (!clickable) {
    return (
      <div className="card p-4 flex flex-col gap-1">
        {body}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onChart(chartKey)}
      className="card p-4 flex flex-col gap-1 text-left group hover:border-brand-500/40 hover:bg-slate-900/80 transition-colors cursor-pointer"
      title={`View 24h ${label} chart`}
    >
      {body}
    </button>
  )
}