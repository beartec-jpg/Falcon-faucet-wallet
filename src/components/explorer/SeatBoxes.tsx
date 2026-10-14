'use client'

import TrendChart from '@/components/explorer/TrendChart'
import { getClientSeries } from '@/lib/metric-history'
import { seatKey, seatLag, type NetSample } from '@/lib/net-metrics'

/** One clickable box per bonded seat; click opens its 24h trends. */
export default function SeatBoxes({
  sample,
  onOpen,
}: {
  sample: NetSample | null
  onOpen: (id: string) => void
}) {
  if (!sample) return null
  const seats = [...sample.seats].sort((a, b) => Number(b.online) - Number(a.online) || a.id.localeCompare(b.id))
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {seats.map((s) => {
        const lag = seatLag(sample.height, s)
        const state = s.jailed ? 'jailed' : s.online ? 'online' : 'offline'
        const tone = s.jailed
          ? 'text-red-400'
          : s.online
            ? lag != null && lag > 3
              ? 'text-amber-400'
              : 'text-emerald-400'
            : 'text-slate-500'
        const spark = getClientSeries(seatKey(s.id, 'packs_min')).slice(-60)
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onOpen(s.id)}
            className={`card p-3 text-left flex flex-col gap-1 group hover:border-brand-500/40 transition-colors ${
              s.online ? '' : 'opacity-60'
            }`}
            title={`${s.id}: open 24h trends`}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm text-brand-400 truncate">{s.id}</span>
              <span className={`text-[10px] ${tone}`}>{state}</span>
            </div>
            <div className="flex justify-between text-[11px] font-mono text-slate-400">
              <span>tip {s.tip ? `#${s.tip.toLocaleString()}` : '—'}</span>
              <span>lag {lag == null ? '—' : lag}</span>
            </div>
            <div className="flex justify-between text-[11px] font-mono text-slate-500">
              <span>packs {s.packs.toLocaleString()}</span>
              <span>perf {s.perf == null ? '—' : s.perf.toFixed(3)}</span>
            </div>
            <TrendChart series={spark} compact height={28} windowMs={60 * 60_000} gapMs={5 * 60_000} idSuffix={`-seat-${s.id}`} />
            <span className="text-[10px] text-brand-400/80 opacity-0 group-hover:opacity-100 transition-opacity">
              Click for 24h trends
            </span>
          </button>
        )
      })}
    </div>
  )
}
