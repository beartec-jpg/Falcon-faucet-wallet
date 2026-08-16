'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type WatcherEvent = {
  at: string
  kind: 'entered' | 'heartbeat' | 'exited' | 'funded' | 'error' | 'work' | 'paid' | 'claimed'
  detail: string
  slot?: number
  txId?: string
}

export type WatcherSnap = {
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
  lastSettledEpoch?: number
  claimable?: number
  weight?: number
  treasury?: number
  railTip?: number
  lastHeartbeatAt: string | null
  lastTxId: string | null
  lastError: string | null
  events: WatcherEvent[]
  running: boolean
  error?: string
  lastPay?: {
    at: string
    epoch: number
    work: number
    slots: number
    weight: number
    paid: number
    claimed: boolean
    railTip: number
    balance: number
  } | null
}

const KIND_COLOR: Record<WatcherEvent['kind'], string> = {
  entered: 'text-emerald-400',
  exited: 'text-amber-400',
  heartbeat: 'text-slate-300',
  funded: 'text-brand-400',
  work: 'text-sky-300',
  paid: 'text-emerald-300',
  claimed: 'text-brand-300',
  error: 'text-red-400',
}

export default function WatcherPanel({ initial = null }: { initial?: WatcherSnap | null }) {
  const params = useSearchParams()
  const flash = params?.get('watcher')
  const flashMsg = params?.get('msg')
  const [snap, setSnap] = useState<WatcherSnap | null>(initial)
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

  const realTest = async () => {
    setBusy(true)
    setError(null)
    try {
      runningRef.current = true
      const r = await fetch('/api/watcher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'real-test' }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? 'real test failed')
      setSnap(data)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  const present = Boolean(snap?.present)
  const running = Boolean(snap?.running) || runningRef.current

  return (
    <div className="card p-6 space-y-4 border-brand-500/20 bg-slate-900/70 backdrop-blur-md shadow-[0_0_40px_rgba(192,120,56,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-brand-400/90">
            Pre-public beta · PL 2300
          </p>
          <h2 className="text-lg font-semibold text-white mt-1">Start watcher</h2>
          <p className="text-slate-400 text-xs mt-1">
            Heartbeats only fill presence. <span className="text-slate-300">Run real test</span> submits
            signed BTC rail headers (countable work). On 2300 payday waits until epoch 8 (7-day epochs).
            A tab with no rail work still pays zero.
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <form
          action="/api/watcher"
          method="post"
          onSubmit={(e) => {
            e.preventDefault()
            if (running) void stop()
            else void start()
          }}
        >
          <input type="hidden" name="action" value={running ? 'stop' : 'start'} />
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Working…' : running ? 'Stop watcher' : 'Start watcher'}
          </button>
        </form>
        <form
          action="/api/watcher"
          method="post"
          onSubmit={(e) => {
            e.preventDefault()
            void realTest()
          }}
        >
          <input type="hidden" name="action" value="real-test" />
          <button
            type="submit"
            disabled={busy}
            className="w-full py-3.5 px-6 rounded-xl font-semibold text-brand-200
                       bg-slate-800 hover:bg-slate-700 border border-brand-500/40
                       disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {busy ? 'Running real test…' : 'Run real test'}
          </button>
        </form>
      </div>
      <p className="text-[11px] text-slate-500">
        Real test takes 30–60s. The page will reload with the result. Heartbeats need the tab
        left open after Start.
      </p>

      {flash && (
        <div
          className={`rounded-xl px-4 py-3 text-sm border ${
            flash === 'error'
              ? 'bg-red-500/10 border-red-500/20 text-red-400'
              : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
          }`}
        >
          {flash === 'started' && 'Watcher started — presence is on-chain.'}
          {flash === 'stopped' && 'Watcher stopped.'}
          {flash === 'paid' &&
            `Real test paid ${params?.get('claimable') ?? '0'} FPL · work ${params?.get('work') ?? '0'} · slots ${params?.get('slots') ?? '0'} · BTC rail ${params?.get('rail') ?? '—'}`}
          {flash === 'error' && (flashMsg || 'Watcher request failed')}
          {!['started', 'stopped', 'paid', 'error'].includes(flash) && `Watcher: ${flash}`}
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {(() => {
        const pay = snap?.lastPay
        const q = (k: string) => {
          const v = params?.get(k)
          return v != null && v !== '' ? v : null
        }
        const work = snap?.work || pay?.work || Number(q('work') ?? 0)
        const slots = snap?.slots || pay?.slots || Number(q('slots') ?? 0)
        const weight = snap?.weight || pay?.weight || Number(q('weight') ?? 0)
        const rail = snap?.railTip || pay?.railTip || Number(q('rail') ?? 0)
        const paid = pay?.paid ?? Number(q('claimable') ?? snap?.claimable ?? 0)
        return (
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Account', value: snap?.account || 'watcher-browser' },
          { label: 'Tip', value: snap?.tip != null ? snap.tip.toLocaleString() : '—' },
          { label: 'Slot', value: snap ? `${snap.currentSlot}${snap.inSlot ? ' · marked' : ''}` : '—' },
          { label: 'Slots this epoch', value: String(snap?.slots ?? 0) },
          { label: 'Work this epoch', value: String(snap?.work ?? 0) },
          { label: 'Last test work', value: String(work) },
          { label: 'Last test slots', value: String(slots) },
          { label: 'Last test weight', value: String(weight) },
          { label: 'Last payday', value: `${paid} FPL${pay?.claimed ? ' · claimed' : ''}` },
          { label: 'Balance', value: snap ? `${snap.balance.toLocaleString()} FPL` : q('balance') ? `${q('balance')} FPL` : '—' },
          { label: 'Epoch', value: snap ? `${snap.epoch} / settled ${snap.lastSettledEpoch ?? '—'}` : q('epoch') ?? '—' },
          { label: 'BTC rail', value: String(rail) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl bg-slate-800/60 border border-slate-800 px-3 py-2">
            <div className="text-[11px] text-slate-500">{label}</div>
            <div className="font-mono text-xs text-slate-200 break-all">{value}</div>
          </div>
        ))}
      </div>
        )
      })()}

      {snap?.lastTxId && (
        <p className="text-[11px] font-mono text-slate-500 break-all">last tx {snap.lastTxId}</p>
      )}

      <div className="space-y-1.5">
        <div className="text-[11px] uppercase tracking-wider text-slate-500">Live enter / exit</div>
        <ol className="max-h-48 overflow-y-auto space-y-1.5 text-xs">
          {(snap?.events ?? []).length === 0 && !snap?.lastPay && !params?.get('work') && (
            <li className="text-slate-600">No beats yet. Press Start watcher.</li>
          )}
          {(snap?.events ?? []).length === 0 && (snap?.lastPay || params?.get('work')) && (
            <li className="text-emerald-400">
              Last payday {snap?.lastPay?.paid ?? params?.get('claimable')} FPL · work{' '}
              {snap?.lastPay?.work ?? params?.get('work')} · slots{' '}
              {snap?.lastPay?.slots ?? params?.get('slots')} · rail{' '}
              {snap?.lastPay?.railTip ?? params?.get('rail')}
            </li>
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
