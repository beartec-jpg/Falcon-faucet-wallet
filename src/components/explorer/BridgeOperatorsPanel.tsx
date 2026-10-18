'use client'

import { useEffect, useState } from 'react'
import type { OperatorsResponse } from '@/app/api/scan/btc-operators/route'

const fmtBtc = (sats: number) => (sats / 1e8).toFixed(8)
/** Heartbeats are hourly; older than 2h counts as offline. */
const STALE_S = 2 * 3600

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4 flex flex-col gap-1">
      <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
      <span className="text-xl font-bold font-mono text-slate-100">{value}</span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  )
}

/** Operators stats: fronting liquidity advertised by BTC bridge operators (feed via /api/scan/btc-operators). */
export default function BridgeOperatorsPanel({ lockedSats }: { lockedSats: number }) {
  const [data, setData] = useState<OperatorsResponse | null>(null)
  useEffect(() => {
    let alive = true
    const load = () =>
      fetch('/api/scan/btc-operators', { cache: 'no-store' })
        .then((r) => r.json())
        .then((j: OperatorsResponse) => alive && setData(j))
        .catch(() => {})
    load()
    const t = setInterval(load, 30000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])
  const ops = data?.operators ?? []
  const now = Date.now() / 1000
  const total = ops.reduce((s, o) => s + o.availableSats, 0)
  const largest = ops.reduce((m, o) => Math.max(m, o.availableSats), 0)

  return (
    <section>
      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Operators</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <Stat label="Operator BTC available" value={`${fmtBtc(total)} BTC`} sub="sum of advertised fronting capacity" />
        <Stat label="BTC locked in pool" value={`${fmtBtc(lockedSats)} BTC`} sub="locked deposits on hold" />
        <Stat label="Withdrawable now" value={`${fmtBtc(largest)} BTC`} sub={`largest single front · total ${fmtBtc(total)} BTC`} />
        <Stat label="Operators" value={String(ops.length)} sub="from operator feed" />
      </div>
      <div className="card overflow-x-auto mt-3">
        {ops.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No operators online yet (testnet / coming soon)</p>
        ) : (
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="text-slate-500">
              <tr><th className="p-2">Operator</th><th className="p-2">Available BTC</th><th className="p-2">Status</th><th className="p-2">Last heartbeat</th></tr>
            </thead>
            <tbody>
              {ops.map((o) => {
                const online = o.lastSeen > 0 && now - o.lastSeen < STALE_S
                return (
                  <tr key={o.xonly} className="border-t border-slate-800">
                    <td className="p-2 font-mono">{o.name || `${o.xonly.slice(0, 8)}…${o.xonly.slice(-6)}`}</td>
                    <td className="p-2 font-mono">{fmtBtc(o.availableSats)}</td>
                    <td className={`p-2 ${online ? 'text-emerald-400' : 'text-slate-500'}`}>{online ? 'online' : 'offline'}</td>
                    <td className="p-2 font-mono">{o.lastSeen ? new Date(o.lastSeen * 1000).toLocaleString() : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
