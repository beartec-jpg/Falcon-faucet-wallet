'use client'

import { useMemo } from 'react'
import TrendChart from '@/components/explorer/TrendChart'
import type { LiveSamples } from '@/hooks/useLiveSamples'
import { rateBetween } from '@/lib/net-metrics'
import type { MetricPoint } from '@/lib/metric-history'

const f1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(1))

/**
 * Current network speed. tx/s = Δ txs_sealed / Δt between /api/scan polls
 * (the node's cumulative sealed-tx counter), over 10s / 60s / 5 min windows.
 */
export default function TxRateTab({
  live,
  mempool,
  pollMs,
  onOpen24h,
}: {
  live: LiveSamples
  mempool: number
  pollMs: number
  onOpen24h: () => void
}) {
  const { samples, rate10s, rate60s, rate5m } = live

  const perInterval = useMemo(() => {
    const out: MetricPoint[] = []
    for (let i = 1; i < samples.length; i++) {
      const r = rateBetween(samples[i - 1], samples[i])
      if (r) out.push({ t: samples[i].t, v: r.tps })
    }
    return out
  }, [samples])

  const peak = perInterval.reduce((m, p) => Math.max(m, p.v), 0)

  return (
    <section className="space-y-6">
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card p-5 sm:col-span-1 flex flex-col gap-1 border-brand-500/30">
          <span className="text-xs text-slate-500 uppercase tracking-wider">tx/s · last 60s</span>
          <span className="text-5xl font-bold font-mono text-brand-400">{f1(rate60s?.tps)}</span>
          <span className="text-xs text-slate-500">
            {rate60s ? `over ${(rate60s.span_ms / 1000).toFixed(0)}s of sealed blocks` : 'needs two polls…'}
          </span>
        </div>
        <div className="card p-5 grid grid-cols-2 gap-3 sm:col-span-2 text-sm">
          <Stat label="tx/s · 10s" v={f1(rate10s?.tps)} />
          <Stat label="tx/s · 5 min" v={f1(rate5m?.tps)} />
          <Stat label="Blocks / min" v={f1(rate60s?.blocks_min)} />
          <Stat label="Txs / block" v={f1(rate60s?.txs_per_block)} />
          <Stat label="Peak (this session)" v={f1(peak || null)} />
          <Stat label="Mempool" v={String(mempool)} />
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
            Live tx/s · last 15 min (per poll)
          </h3>
          <button type="button" onClick={onOpen24h} className="text-xs text-brand-400 hover:text-brand-300">
            24h trends →
          </button>
        </div>
        <TrendChart series={perInterval} windowMs={15 * 60_000} gapMs={60_000} height={180} idSuffix="-live" />
      </div>

      <p className="text-[11px] text-slate-600 leading-relaxed">
        Estimate, not a benchmark. Each poll of <code className="font-mono">/api/scan</code> (every{' '}
        {pollMs / 1000}s) reads the node&apos;s cumulative <code className="font-mono">txs_sealed</code> and{' '}
        <code className="font-mono">ledgers_sealed</code> counters; the rate is the difference divided by the
        time between polls. Block timing is quantised, so the 10s figure is jumpy and the 60s figure is the
        headline. Counter resets (failover to another seat) are skipped.
      </p>
    </section>
  )
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="text-xl font-mono text-slate-100">{v}</div>
    </div>
  )
}
