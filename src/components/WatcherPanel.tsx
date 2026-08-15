'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type WatcherEvent = {
  at: string
  kind: 'entered' | 'heartbeat' | 'exited' | 'funded' | 'error'
  detail: string
  slot?: number
  txId?: string
}

type WatcherSnap = {
  online: boolean
  product?: string
  tip?: number
  networkId: number
  account: string
  exists: boolean
  balance: number
  present: boolean
  work: number
  slots: number
  currentSlot: number
  inSlot: boolean
  slotMs: number
  epoch: number
  lastHeartbeatAt: string | null
  lastTxId: string | null
  lastError: string | null
  events: WatcherEvent[]
  running: boolean
  error?: string
}

const KIND_COLOR: Record<WatcherEvent['kind'], string> = {
  entered: 'text-emerald-400',
  exited: 'text-amber-400',
  heartbeat: 'text-slate-300',
  funded: 'text-brand-400',
  error: 'text-red-400',
}

export default function WatcherPanel() {
  const [snap, setSnap] = useState<WatcherSnap | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const runningRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/watcher', { cache: 'no-store' })
      const data = (await r.json()) as WatcherSnap
      setSnap(data)
      if (!r.ok && data.lastError) setError(data.lastError)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 2_000)
    return () => clearInterval(id)
  }, [refresh])

  const stopLoop = () => {
    runningRef.current = false
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const beat = useCallback(async () => {
    const r = await fetch('/api/watcher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'heartbeat' }),
    })
    const data = await r.json()
    if (!r.ok) throw new Error(data.error ?? 'heartbeat failed')
    setSnap(data)
    setError(null)
  }, [])

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/api/watcher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? 'start failed')
      setSnap(data)
      runningRef.current = true
      await beat()
      stopLoop()
      const every = Math.max(1_000, Math.min(Number(data.slotMs) || 2_000, 3_000))
      timerRef.current = setInterval(() => {
        if (!runningRef.current) return
        beat().catch((e) => setError(String(e instanceof Error ? e.message : e)))
      }, every)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    setBusy(true)
    stopLoop()
    try {
      const r = await fetch('/api/watcher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? 'stop failed')
      setSnap(data)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => () => stopLoop(), [])

  const present = Boolean(snap?.present)
  const running = Boolean(snap?.running) || runningRef.current

  return (
    <div className="card p-6 space-y-4 border-brand-500/20 bg-slate-900/70 backdrop-blur-md shadow-[0_0_40px_rgba(192,120,56,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-brand-400/90">
            Browser watcher · PL 2200
          </p>
          <h2 className="text-lg font-semibold text-white mt-1">Start watcher</h2>
          <p className="text-slate-400 text-xs mt-1">
            Sends a signed <span className="font-mono text-slate-300">WatcherHeartbeat</span> while
            this tab is open. Presence enters the current slot; closing or Stop exits. Work stays 0
            until a rail header/deposit — that is the product rule.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`w-2 h-2 rounded-full ${
              present ? 'bg-emerald-400 animate-pulse' : running ? 'bg-amber-400' : 'bg-slate-600'
            }`}
          />
          <span
            className={`text-xs font-medium ${
              present ? 'text-emerald-400' : running ? 'text-amber-400' : 'text-slate-500'
            }`}
          >
            {present ? 'IN' : running ? 'starting…' : 'OUT'}
          </span>
        </div>
      </div>

      <button
        type="button"
        disabled={busy || (snap !== null && !snap.online && !running)}
        onClick={running ? stop : start}
        className="btn-primary"
      >
        {busy ? 'Working…' : running ? 'Stop watcher' : 'Start watcher'}
      </button>

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Account', value: snap?.account ?? '—' },
          { label: 'Tip', value: snap?.tip?.toLocaleString() ?? '—' },
          { label: 'Slot', value: snap ? `${snap.currentSlot}${snap.inSlot ? ' · marked' : ''}` : '—' },
          { label: 'Slots filled', value: snap ? String(snap.slots) : '—' },
          { label: 'Work', value: snap ? String(snap.work) : '—' },
          { label: 'Balance', value: snap ? `${snap.balance.toLocaleString()} FPL` : '—' },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl bg-slate-800/60 border border-slate-800 px-3 py-2">
            <div className="text-[11px] text-slate-500">{label}</div>
            <div className="font-mono text-xs text-slate-200 break-all">{value}</div>
          </div>
        ))}
      </div>

      {snap?.lastTxId && (
        <p className="text-[11px] font-mono text-slate-500 break-all">last tx {snap.lastTxId}</p>
      )}

      <div className="space-y-1.5">
        <div className="text-[11px] uppercase tracking-wider text-slate-500">Live enter / exit</div>
        <ol className="max-h-48 overflow-y-auto space-y-1.5 text-xs">
          {(snap?.events ?? []).length === 0 && (
            <li className="text-slate-600">No beats yet. Press Start watcher.</li>
          )}
          {(snap?.events ?? []).map((ev, i) => (
            <li key={`${ev.at}-${i}`} className="flex gap-2">
              <span className="text-slate-600 font-mono shrink-0">
                {ev.at.slice(11, 19)}
              </span>
              <span className={`${KIND_COLOR[ev.kind]} font-medium w-16 shrink-0`}>
                {ev.kind}
              </span>
              <span className="text-slate-400 break-all">{ev.detail}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
