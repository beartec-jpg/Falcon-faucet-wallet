'use client'

import TrendChart from '@/components/explorer/TrendChart'
import { getClientSeries } from '@/lib/metric-history'
import { seatKey, seatLag, type NetSample, type SeatMetric } from '@/lib/net-metrics'

/** One box per bonded seat; each stat inside opens that seat metric's 24h chart. */
export default function SeatBoxes({
  sample,
  onOpen,
}: {
  sample: NetSample | null
  onOpen: (id: string, metric: SeatMetric) => void
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
          <div
            key={s.id}
            className={`card p-3 flex flex-col gap-1 ${s.online ? '' : 'opacity-60'}`}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm text-brand-400 truncate">{s.id}</span>
              <span className={`text-[10px] ${tone}`}>{state}</span>
            </div>
            <div className="flex justify-between text-[11px] font-mono text-slate-400">
              <Stat onClick={() => onOpen(s.id, 'tip')} title="24h advertised tip">tip {s.tip ? `#${s.tip.toLocaleString()}` : '—'}</Stat>
              <Stat onClick={() => onOpen(s.id, 'lag')} title="24h tip lag">lag {lag == null ? '—' : lag}</Stat>
            </div>
            <div className="flex justify-between text-[11px] font-mono text-slate-500">
              <Stat onClick={() => onOpen(s.id, 'packs_min')} title="24h packs / min">packs {s.packs.toLocaleString()}</Stat>
              <Stat onClick={() => onOpen(s.id, 'perf')} title="24h perf">perf {s.perf == null ? '—' : s.perf.toFixed(3)}</Stat>
            </div>
            <TrendChart series={spark} compact height={28} windowMs={60 * 60_000} gapMs={5 * 60_000} idSuffix={`-seat-${s.id}`} />
          </div>
        )
      })}
    </div>
  )
}

function Stat({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${title} (click)`}
      className="rounded px-1 -mx-1 hover:bg-brand-500/15 hover:text-brand-300 underline decoration-dotted decoration-slate-600 underline-offset-2 transition-colors"
    >
      {children}
    </button>
  )
}
