'use client'

import { useCallback, useEffect, useState } from 'react'
import { useNetwork } from '@/components/NetworkProvider'
import { withNetworkQuery } from '@/lib/network-query'

interface PoolStats {
  live: boolean
  pool?: {
    account: string
    falcon: number
    usdc: number
    price: number
    tradingFeeBps: number
    tradingFeePct: number
    lpTokenSupply: number
    tvlFalcon: number
    falconSharePct: number
    usdcSharePct: number
    contributorCount: number
    voteSlots: number
    auctionHolder: string | null
    auctionExpires: string | null
  }
  contributors?: Array<{ address: string; lpBalance: number; sharePct: number }>
  viewer?: {
    address: string
    hasPosition: boolean
    lpBalance: number
    sharePct: number | null
    estFalconOut: number
    estUsdcOut: number
  } | null
  updatedAt?: string
}

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin-slow ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function fmt(n: number, d = 2): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: d })
}

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a
}

interface Props {
  viewerAddress?: string
  pollMs?: number
}

export default function PoolStatsPanel({ viewerAddress, pollMs = 12000 }: Props) {
  const { networkKey } = useNetwork()
  const [data, setData] = useState<PoolStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const q = viewerAddress
        ? `/api/market/pool-stats?address=${encodeURIComponent(viewerAddress)}`
        : '/api/market/pool-stats'
      const r = await fetch(withNetworkQuery(q, networkKey))
      const d = (await r.json()) as PoolStats
      if ('error' in d && typeof (d as { error?: string }).error === 'string') {
        throw new Error((d as { error: string }).error)
      }
      setData(d)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Pool stats unavailable')
    } finally {
      setLoading(false)
    }
  }, [networkKey, viewerAddress])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, pollMs)
    return () => clearInterval(t)
  }, [refresh, pollMs])

  if (loading && !data) {
    return (
      <div className="card p-8 flex items-center justify-center gap-2 text-slate-500 text-sm">
        <Spinner /> Loading pool stats…
      </div>
    )
  }

  if (!data?.live || !data.pool) {
    return (
      <div className="card p-6 border border-amber-500/20 bg-amber-500/5">
        <div className="text-sm font-semibold text-amber-200">No AMM pool yet</div>
        <p className="text-xs text-slate-400 mt-2">
          Bridge Sepolia USDC in for F-USDC, then create the pool below. Stats will appear once the pool is live on-ledger.
        </p>
      </div>
    )
  }

  const p = data.pool

  return (
    <div className="space-y-4">
      <div className="card p-6 space-y-5 border-purple-500/20 bg-gradient-to-br from-purple-950/40 to-slate-900/60">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-xs font-mono bg-purple-500/15 text-purple-300">AMM</span>
              <span className="text-xs text-slate-500">FALCON / F-USDC</span>
            </div>
            <h2 className="text-lg font-bold text-white mt-2">Pool overview</h2>
          </div>
          <button
            type="button"
            onClick={() => refresh()}
            className="text-xs text-brand-400 hover:text-brand-300"
          >
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1 rounded-xl bg-slate-800/70 p-4">
            <div className="text-xs text-slate-500 mb-1">Total value (FALCON terms)</div>
            <div className="text-3xl font-bold text-white">{fmt(p.tvlFalcon, 0)}</div>
            <div className="text-[10px] text-slate-500 mt-1">FALCON + F-USDC at pool price</div>
          </div>
          <div className="col-span-2 sm:col-span-1 rounded-xl bg-slate-800/70 p-4">
            <div className="text-xs text-slate-500 mb-1">Pool price</div>
            <div className="text-3xl font-bold text-white">{fmt(p.price, 4)}</div>
            <div className="text-[10px] text-slate-500 mt-1">FALCON per F-USDC</div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <div className="rounded-xl bg-slate-800/50 px-3 py-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">FALCON</div>
            <div className="text-lg font-bold text-white mt-1">{fmt(p.falcon, 0)}</div>
          </div>
          <div className="rounded-xl bg-slate-800/50 px-3 py-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">F-USDC</div>
            <div className="text-lg font-bold text-white mt-1">{fmt(p.usdc, 2)}</div>
          </div>
          <div className="rounded-xl bg-slate-800/50 px-3 py-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">LP providers</div>
            <div className="text-lg font-bold text-purple-300 mt-1">{p.contributorCount}</div>
          </div>
          <div className="rounded-xl bg-slate-800/50 px-3 py-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Swap fee</div>
            <div className="text-lg font-bold text-white mt-1">{p.tradingFeePct.toFixed(2)}%</div>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-slate-500">
            <span>Asset mix (by value)</span>
            <span>{fmt(p.falconSharePct, 1)}% FALCON · {fmt(p.usdcSharePct, 1)}% F-USDC</span>
          </div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden flex">
            <div className="bg-brand-500/80 h-full" style={{ width: `${p.falconSharePct}%` }} />
            <div className="bg-emerald-500/70 h-full flex-1" />
          </div>
          <p className="text-[10px] text-slate-600">
            Sides drift after swaps — deposit at the current ratio on the form below.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
          <div>LP tokens outstanding: <span className="font-mono text-slate-300">{fmt(p.lpTokenSupply, 0)}</span></div>
          <div>Fee voters: <span className="font-mono text-slate-300">{p.voteSlots}</span></div>
        </div>
      </div>

      {data.viewer?.hasPosition && (
        <div className="card p-4 border border-purple-500/25 bg-purple-500/5 space-y-2">
          <div className="text-sm font-semibold text-purple-200">Your pool position</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-slate-500">Share</div>
              <div className="font-mono text-white text-lg">{fmt(data.viewer.sharePct ?? 0, 4)}%</div>
            </div>
            <div>
              <div className="text-slate-500">LP tokens</div>
              <div className="font-mono text-slate-200">{fmt(data.viewer.lpBalance, 0)}</div>
            </div>
            <div>
              <div className="text-slate-500">Withdrawable FALCON</div>
              <div className="font-mono text-slate-200">{fmt(data.viewer.estFalconOut, 4)}</div>
            </div>
            <div>
              <div className="text-slate-500">Withdrawable F-USDC</div>
              <div className="font-mono text-slate-200">{fmt(data.viewer.estUsdcOut, 4)}</div>
            </div>
          </div>
        </div>
      )}

      {(data.contributors?.length ?? 0) > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 text-sm font-semibold text-white">
            Liquidity providers ({data.contributors!.length})
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800/50">
                <th className="text-left px-3 py-2">Address</th>
                <th className="text-right px-3 py-2">Share</th>
                <th className="text-right px-3 py-2 hidden sm:table-cell">LP tokens</th>
              </tr>
            </thead>
            <tbody>
              {data.contributors!.map((c) => (
                <tr key={c.address} className="border-b border-slate-800/30">
                  <td className="px-3 py-2 font-mono text-slate-300">
                    {viewerAddress === c.address ? (
                      <span className="text-purple-300">{shortAddr(c.address)} (you)</span>
                    ) : (
                      shortAddr(c.address)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-200">{fmt(c.sharePct, 2)}%</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-400 hidden sm:table-cell">
                    {fmt(c.lpBalance, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <div className="text-xs text-amber-400">{error}</div>}
    </div>
  )
}