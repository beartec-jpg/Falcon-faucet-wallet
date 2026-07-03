'use client'

import { useCallback, useEffect, useState } from 'react'
import { useNetwork } from '@/components/NetworkProvider'
import { withNetworkQuery } from '@/lib/network-query'

interface BookEntry {
  price: number
  amountToken: number
  amountXrp: number
  seq: number
  owner: string
}

interface OrderBookData {
  token: { symbol: string; currency: string; issuer: string }
  amm: { xrp: number; usdc: number; tradingFeeBps: unknown; account: unknown } | null
  ammEnabled: boolean
  asks: BookEntry[]
  bids: BookEntry[]
  updatedAt: string
}

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin-slow ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function fmt(n: number, d = 4): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: d })
}

function shortAddr(a: string) {
  return a.length > 12 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a
}

function BookTable({
  title,
  rows,
  accent,
  empty,
}: {
  title: string
  rows: BookEntry[]
  accent: string
  empty: string
}) {
  return (
    <div className="card overflow-hidden">
      <div className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider border-b border-slate-800 ${accent}`}>
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-slate-600">{empty}</div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800/50">
              <th className="text-left px-3 py-2 font-medium">Price</th>
              <th className="text-right px-3 py-2 font-medium">USDC</th>
              <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">FALCON</th>
              <th className="text-right px-3 py-2 font-medium hidden md:table-cell">Owner</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.seq} className="border-b border-slate-800/30 hover:bg-slate-800/30">
                <td className="px-3 py-2 font-mono text-slate-200">{fmt(r.price, 6)}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-300">{fmt(r.amountToken, 2)}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-400 hidden sm:table-cell">{fmt(r.amountXrp, 2)}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-500 hidden md:table-cell">{shortAddr(r.owner)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

interface Props {
  compact?: boolean
  pollMs?: number
}

export default function OrderBookPanel({ compact = false, pollMs = 8000 }: Props) {
  const { networkKey } = useNetwork()
  const [data, setData] = useState<OrderBookData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(withNetworkQuery('/api/market/orderbook', networkKey))
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      setData(d)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Order book unavailable')
    } finally {
      setLoading(false)
    }
  }, [networkKey])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, pollMs)
    return () => clearInterval(t)
  }, [refresh, pollMs])

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-slate-500 text-sm">
        <Spinner /> Loading order book…
      </div>
    )
  }

  if (error && !data) {
    return <div className="card p-4 text-sm text-amber-400">{error}</div>
  }

  if (!data) return null

  const bestAsk = data.asks[0]?.price
  const bestBid = data.bids[0]?.price
  const spread = bestAsk && bestBid ? bestAsk - bestBid : null

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className={`px-2 py-0.5 rounded font-mono ${
          data.ammEnabled ? 'bg-purple-500/10 text-purple-400' : 'bg-cyan-500/10 text-cyan-400'
        }`}>
          {data.ammEnabled ? 'AMM + DEX' : 'DEX only'}
        </span>
        {bestBid && <span className="text-slate-500">Best bid <span className="text-emerald-400 font-mono">{fmt(bestBid, 6)}</span></span>}
        {bestAsk && <span className="text-slate-500">Best ask <span className="text-red-400 font-mono">{fmt(bestAsk, 6)}</span></span>}
        {spread !== null && <span className="text-slate-500">Spread <span className="text-slate-300 font-mono">{fmt(spread, 6)}</span></span>}
        <button type="button" onClick={() => refresh()} className="text-brand-400 hover:text-brand-300 ml-auto">
          Refresh
        </button>
      </div>

      {data.ammEnabled && data.amm && (
        <div className="card p-3 grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-slate-500">AMM FALCON</div>
            <div className="font-mono text-slate-200">{fmt(data.amm.xrp, 0)}</div>
          </div>
          <div>
            <div className="text-slate-500">AMM USDC</div>
            <div className="font-mono text-slate-200">{fmt(data.amm.usdc, 0)}</div>
          </div>
        </div>
      )}

      {!data.ammEnabled && !compact && (
        <p className="text-xs text-slate-500">
          AMM not enabled on testnet yet. Post DEX limit orders to provide liquidity; trading fees accrue to makers when orders fill.
          Run <code className="text-slate-400">enable-amm-fleet.sh</code> on validators to enable AMM pools.
        </p>
      )}

      <div className={`grid gap-4 ${compact ? 'grid-cols-1' : 'lg:grid-cols-2'}`}>
        <BookTable title="Bids (buy USDC)" rows={data.bids} accent="text-emerald-400" empty="No bids" />
        <BookTable title="Asks (sell USDC)" rows={data.asks} accent="text-red-400" empty="No asks — add liquidity on Swap → Liquidity" />
      </div>
    </div>
  )
}