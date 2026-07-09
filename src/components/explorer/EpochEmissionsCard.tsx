'use client'

import type { EpochOverview } from '@/lib/epoch-model'

function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function pct(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `${n.toFixed(digits)}%`
}

export default function EpochEmissionsCard({ epoch }: { epoch: EpochOverview | null | undefined }) {
  if (!epoch) return null

  return (
    <section>
      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
        Epoch &amp; Emissions
      </h2>
      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <div className="text-slate-500">Epoch</div>
            <div className="font-mono text-slate-200 text-lg">{epoch.number ?? '—'}</div>
          </div>
          <div>
            <div className="text-slate-500">Treasury pool</div>
            <div className="font-mono text-slate-200 text-lg">{fmt(epoch.poolBalanceFalcon, 0)} FALCON</div>
          </div>
          <div>
            <div className="text-slate-500">Emission rate</div>
            <div className="font-mono text-brand-400 text-lg">
              {epoch.emissionRateFalcon != null ? `${fmt(epoch.emissionRateFalcon, 2)} / epoch` : '—'}
            </div>
          </div>
          <div>
            <div className="text-slate-500">CID rate</div>
            <div className="font-mono text-brand-400 text-lg">{pct(epoch.cidEmissionPct, 3)} / epoch</div>
            <div className="text-slate-600 mt-0.5">{pct(epoch.cidYearlyAvgPct)} yearly avg</div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs pt-1 border-t border-slate-800">
          <div>
            <div className="text-slate-500">Validator share</div>
            <div className="font-mono text-slate-300">
              {epoch.lpAllocationPct != null ? `${pct(100 - epoch.lpAllocationPct)}` : '—'}
            </div>
          </div>
          <div>
            <div className="text-slate-500">LP / lend share</div>
            <div className="font-mono text-slate-300">{pct(epoch.lpAllocationPct)}</div>
          </div>
          <div className="sm:col-span-1 col-span-2">
            <p className="text-slate-600 leading-relaxed">
              CID emission declines linearly each epoch (~0.07 bps/week); year-1 averages 12% of
              treasury. LP share is participation-based: each active vault depositor adds 1% (cap 50
              providers). Validators receive the remainder. Epoch length is 172,800 ledgers (~7 days).
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}