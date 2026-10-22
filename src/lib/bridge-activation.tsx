'use client'

import { useEffect, useRef, useState } from 'react'

/** Falcon PL ledger height at which the BTC (testnet4) bridge activates (node 2.9.79-beta.3). */
export const BTC_BRIDGE_FROM_HEIGHT = 692_000
const DEFAULT_BLOCKS_PER_MIN = 10

export type Activation = { height: number | null; live: boolean; etaMs: number | null }

/** Polls /api/status for the current ledger height; ETA from the measured block rate. */
export function useBridgeActivation(): Activation {
  const [height, setHeight] = useState<number | null>(null)
  const first = useRef<{ h: number; t: number } | null>(null)
  const [rate, setRate] = useState(DEFAULT_BLOCKS_PER_MIN)
  useEffect(() => {
    let stop = false
    const tick = async () => {
      try {
        const r = await fetch('/api/status', { cache: 'no-store' })
        const j = await r.json()
        const h = Number(j?.height)
        if (stop || !Number.isFinite(h) || h <= 0) return
        setHeight(h)
        const now = Date.now()
        if (!first.current) first.current = { h, t: now }
        const dt = (now - first.current.t) / 60_000
        if (dt >= 2 && h > first.current.h) setRate((h - first.current.h) / dt)
      } catch {
        /* keep last value */
      }
    }
    tick()
    const t = setInterval(tick, 30_000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [])
  const live = height !== null && height >= BTC_BRIDGE_FROM_HEIGHT
  const etaMs = height === null || live ? null : Date.now() + ((BTC_BRIDGE_FROM_HEIGHT - height) / rate) * 60_000
  return { height, live, etaMs }
}

export function ActivationNote() {
  const { height, live, etaMs } = useBridgeActivation()
  const eta = etaMs
    ? new Date(etaMs).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
    : null
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-2 text-sm text-slate-300">
      {live ? (
        <>BTC bridge (testnet4) active since block {BTC_BRIDGE_FROM_HEIGHT.toLocaleString('en-GB')}.</>
      ) : (
        <>BTC bridge (testnet4) activates at block {BTC_BRIDGE_FROM_HEIGHT.toLocaleString('en-GB')}.</>
      )}{' '}
      <span className="text-slate-400">
        Current block {height === null ? '…' : height.toLocaleString('en-GB')}
        {eta ? ` · ETA ~${eta}` : ''}
      </span>
    </div>
  )
}
