'use client'

/**
 * /network/health: public view of every Falcon PL validator (status, height, lag,
 * last proposal, version, epoch activity), network KPIs and active alerts.
 * Read-only; data from /api/network/health (no node ports are contacted by the browser).
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import ProductShell from '@/components/ProductShell'
import { ago, type NetworkHealth, type SeatRow } from '@/lib/network-health'

const STATUS: Record<SeatRow['status'], { dot: string; text: string }> = {
  active: { dot: 'bg-emerald-400', text: 'text-emerald-300' },
  syncing: { dot: 'bg-amber-400', text: 'text-amber-300' },
  offline: { dot: 'bg-slate-500', text: 'text-slate-400' },
  inactive: { dot: 'bg-orange-400', text: 'text-orange-300' },
  jailed: { dot: 'bg-red-400', text: 'text-red-400' },
}

const fmt = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('en-GB'))

const time = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

function Kpi({ label, value, sub, tone = 'text-white' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone}`}>{value}</div>
      {sub ? <div className="mt-1 truncate text-xs text-slate-500">{sub}</div> : null}
    </div>
  )
}

export default function NetworkHealthPage() {
  const [data, setData] = useState<NetworkHealth | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const r = await fetch('/api/network/health', { cache: 'no-store' })
        const j = await r.json()
        if (!live) return
        if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`)
        setData(j)
        setErr(null)
      } catch (e) {
        if (live) setErr(e instanceof Error ? e.message : 'unavailable')
      }
    }
    void load()
    const a = setInterval(load, 30_000)
    const b = setInterval(() => setNow(Date.now()), 5_000)
    return () => {
      live = false
      clearInterval(a)
      clearInterval(b)
    }
  }, [])

  const maxShare = Math.max(1, ...(data?.seats ?? []).map((s) => s.workShare ?? 0))

  return (
    <ProductShell intensity={0.4}>
      <Header current="community" subtitle="Network health" />
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            <Link href="/validator" className="hover:text-brand-400">Validators</Link>
            {' · '}Network health
          </p>
          <h1 className="text-2xl font-bold text-white">
            Network <span className="text-cyan-400">health</span>
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Public testnet 2300{data?.sampledAt ? ` · alerts checked ${ago(data.sampledAt, now)}` : ''}
          </p>
          {err ? <p className="mt-2 text-sm text-red-400">Network status unavailable: {err}</p> : null}
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Network tip" value={fmt(data?.tip)} sub={data?.networkId != null ? `network id ${data.networkId}` : undefined} tone="text-cyan-300" />
          <Kpi label="Epoch" value={fmt(data?.epoch)} sub={data?.epochProgressPct != null ? `${data.epochProgressPct}% complete` : undefined} />
          <Kpi
            label="Block rate"
            value={data?.blocksPerMin != null ? `${data.blocksPerMin.toFixed(1)}/min` : ''}
            sub={data?.blocksPerMin24h != null ? `24h avg ${data.blocksPerMin24h.toFixed(1)}` : undefined}
          />
          <Kpi label="Validators" value={data ? `${data.validators.active}/${data.validators.total}` : ''} sub={data ? 'active' : undefined} />
          <Kpi label="Behind" value={data ? String(data.behind.length) : ''} sub={data?.behind.join(', ') || undefined} tone={data?.behind.length ? 'text-amber-300' : 'text-white'} />
          <Kpi label="Jailed" value={data ? String(data.jailed.length) : ''} sub={data?.jailed.join(', ') || undefined} tone={data?.jailed.length ? 'text-red-400' : 'text-white'} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[2.1fr_1fr]">
          <section className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Validators</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                  <th className="py-2 pr-3 font-medium">Validator</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 text-right font-medium">Height</th>
                  <th className="py-2 pr-3 text-right font-medium">Lag</th>
                  <th className="py-2 pr-3 font-medium">Last proposal</th>
                  <th className="py-2 pr-3 font-medium">Version</th>
                  <th className="py-2 font-medium">Epoch activity</th>
                </tr>
              </thead>
              <tbody>
                {(data?.seats ?? []).map((s) => (
                  <tr key={s.id} className="border-b border-slate-900">
                    <td className="py-2 pr-3 font-mono text-slate-200">
                      <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${STATUS[s.status].dot}`} />
                      {s.id}
                    </td>
                    <td className={`py-2 pr-3 text-xs font-semibold uppercase ${STATUS[s.status].text}`}>{s.status}</td>
                    <td className="py-2 pr-3 text-right font-mono text-slate-300">{fmt(s.height)}</td>
                    <td className={`py-2 pr-3 text-right font-mono ${s.lag != null && s.lag > 20 ? 'text-red-400' : s.lag ? 'text-amber-300' : 'text-emerald-300'}`}>{fmt(s.lag)}</td>
                    <td className="py-2 pr-3 text-slate-400">{ago(s.lastProposalAt, now)}</td>
                    <td className="py-2 pr-3 font-mono text-slate-400">{s.version ? `v${s.version.replace(/^v/, '')}` : ''}</td>
                    <td className="py-2">
                      {s.workShare != null ? (
                        <span className="flex items-center gap-2">
                          <span className="inline-block h-1.5 w-20 rounded bg-slate-800">
                            <span
                              className={`block h-1.5 rounded ${s.status === 'syncing' ? 'bg-amber-400' : 'bg-emerald-400'}`}
                              style={{ width: `${Math.min(100, (100 * s.workShare) / maxShare)}%` }}
                            />
                          </span>
                          <span className="font-mono text-xs text-slate-300">{s.workShare.toFixed(1)}%</span>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Active alerts</h2>
            {data && !data.alerts.length ? <p className="text-sm text-emerald-300">No active alerts.</p> : null}
            <ul className="space-y-2">
              {(data?.alerts ?? []).map((a) => (
                <li key={a.key} className={`border-l-4 bg-slate-900/60 p-3 text-sm ${a.severity === 'critical' ? 'border-red-400' : 'border-amber-400'}`}>
                  <span className={`font-semibold uppercase ${a.severity === 'critical' ? 'text-red-400' : 'text-amber-300'}`}>{a.severity}</span>
                  <span className="text-slate-300"> · {a.detail}</span>
                  <div className="mt-1 text-xs text-slate-500">since {time(a.since)}</div>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-slate-500">
              Checked every 5 minutes. Stall: tip unchanged &gt; 3 min. Lagging: &gt; 20 blocks behind the tip.
            </p>
          </section>
        </div>
      </main>
    </ProductShell>
  )
}
