'use client'

/**
 * Falcon PL 2300 watcher, signed by the user's own wallet in the browser.
 *
 * - Start: one passkey unlock, then a `watcher_heartbeat` per hour slot while
 *   the tab stays open (the decrypted key lives only in this tab's memory and
 *   is dropped on Stop / unmount).
 * - Submit rail work: `rail_header` for the next real Bitcoin testnet3 header
 *   after the rail tip (/api/watcher/btc-next). Usually none: the header daemon
 *   keeps the rail at the tip.
 * - Claim: `claim` moves settled FPL into the balance.
 *
 * No server signing, no ctl, no walletd: works on Vercel.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNetwork } from '@/components/NetworkProvider'
import { authenticatePasskey } from '@/lib/passkey'
import { decryptSeed } from '@/lib/wallet-crypto'
import { loadPrimaryWallet, type StoredWallet } from '@/lib/wallet-store'
import { plAccountId } from '@/lib/pl-names'
import { signPlClaim, signPlWatcherHeartbeat, signRailHeader } from '@/lib/pl-wallet-sign'
import { fetchSequenceInfo } from '@/lib/wallet-submit'

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
  firstClaimEpoch?: number
  epochEndsInMs?: number
  firstPaydayInMs?: number
  canClaim?: boolean
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

function fmtDuration(ms?: number): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
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

const FEE = 2

type BtcNext = {
  ok: boolean
  railTip?: number
  chainTip?: number | null
  next?: { height: number; raw: string; hash: string; parentHash: string; merkleRoot: string } | null
  reason?: string
  error?: string
}

async function submitSigned(tx: { rawJson?: string }, networkKey: string) {
  const res = await fetch('/api/wallet/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tx.rawJson ? { tx_json: tx.rawJson, network: networkKey } : { tx, network: networkKey }),
  })
  const out = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
  if (!res.ok || out.error) throw new Error(out.error || out.message || 'Submit failed')
  return out
}

function nowIso() {
  return new Date().toISOString()
}

export default function WatcherPanel({ initial = null }: { initial?: WatcherSnap | null }) {
  const { network } = useNetwork()
  const [wallet, setWallet] = useState<StoredWallet | null>(null)
  const [walletLoaded, setWalletLoaded] = useState(false)
  const [snap, setSnap] = useState<WatcherSnap | null>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [events, setEvents] = useState<WatcherEvent[]>([])
  const [btc, setBtc] = useState<BtcNext | null>(null)
  const secretRef = useRef<string | null>(null)
  const lastBeatSlot = useRef<number | null>(null)
  const beating = useRef(false)

  const account = wallet ? plAccountId(wallet) : null
  const is2300 = network.networkId === 2300

  const log = useCallback((ev: Omit<WatcherEvent, 'at'>) => {
    setEvents((xs) => [{ at: nowIso(), ...ev }, ...xs].slice(0, 60))
  }, [])

  useEffect(() => {
    void loadPrimaryWallet()
      .then(setWallet)
      .finally(() => setWalletLoaded(true))
    return () => {
      secretRef.current = null
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const q = account ? `?account=${encodeURIComponent(account)}` : ''
      const r = await fetch(`/api/watcher${q}`, { cache: 'no-store' })
      const data = (await r.json()) as WatcherSnap
      setSnap(data)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }, [account])

  useEffect(() => {
    if (!walletLoaded) return
    void refresh()
    const id = setInterval(refresh, 10_000)
    return () => clearInterval(id)
  }, [refresh, walletLoaded])

  const unlock = useCallback(async (): Promise<string> => {
    if (secretRef.current) return secretRef.current
    if (!wallet) throw new Error('Create or open your wallet first (Wallet page).')
    const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
    return decryptSeed(wallet.encrypted, keyBytes)
  }, [wallet])

  const needFee = useCallback(() => {
    if (snap && snap.account === account && snap.balance < FEE) {
      throw new Error(`This account needs at least ${FEE} FPL for the fee. Use the faucet above first.`)
    }
  }, [snap, account])

  const beat = useCallback(
    async (falconSecret: string) => {
      if (!account) throw new Error('No wallet account')
      const seq = await fetchSequenceInfo(account, network.key)
      const tx = await signPlWatcherHeartbeat({
        account,
        sequence: seq.sequence,
        fee: FEE,
        networkId: network.networkId,
        falconSecret,
      })
      await submitSigned(tx, network.key)
      log({ kind: 'heartbeat', detail: `slot ${snap?.currentSlot ?? '?'} heartbeat submitted`, slot: snap?.currentSlot, txId: tx.tx_id })
      lastBeatSlot.current = snap?.currentSlot ?? null
    },
    [account, network.key, network.networkId, log, snap?.currentSlot],
  )

  const start = async () => {
    setBusy('start')
    setError(null)
    setInfo(null)
    try {
      needFee()
      const secret = await unlock()
      secretRef.current = secret
      setRunning(true)
      log({ kind: 'entered', detail: `watching as ${account}`, slot: snap?.currentSlot })
      await beat(secret)
      setInfo('Watcher on. One heartbeat per hour slot while this tab stays open.')
      void refresh()
    } catch (e) {
      secretRef.current = null
      setRunning(false)
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(null)
    }
  }

  const stop = () => {
    secretRef.current = null
    lastBeatSlot.current = null
    setRunning(false)
    log({ kind: 'exited', detail: 'watcher stopped (key dropped from memory)', slot: snap?.currentSlot })
  }

  // One heartbeat per new hour slot while running.
  useEffect(() => {
    const secret = secretRef.current
    if (!running || !secret || snap?.currentSlot == null || snap.account !== account) return
    if (lastBeatSlot.current === snap.currentSlot || beating.current) return
    beating.current = true
    beat(secret)
      .catch((e) => {
        const msg = String(e instanceof Error ? e.message : e)
        setError(msg)
        log({ kind: 'error', detail: msg })
      })
      .finally(() => {
        beating.current = false
      })
  }, [running, snap?.currentSlot, snap?.account, account, beat, log])

  const work = async () => {
    setBusy('work')
    setError(null)
    setInfo(null)
    try {
      const r = await fetch('/api/watcher/btc-next', { cache: 'no-store' })
      const data = (await r.json()) as BtcNext
      setBtc(data)
      if (!r.ok || !data.ok) throw new Error(data.error || 'Could not read the Bitcoin tip')
      if (!data.next) {
        setInfo(
          `Nothing to submit: ${data.reason ?? 'rail is current'} (rail ${data.railTip ?? '—'}, Bitcoin testnet ${data.chainTip ?? '—'}). ` +
            'New testnet blocks arrive about every 10 minutes and the header daemon is usually first.',
        )
        return
      }
      needFee()
      if (!account) throw new Error('Create or open your wallet first (Wallet page).')
      const secret = await unlock()
      const seq = await fetchSequenceInfo(account, network.key)
      const n = data.next
      const tx = await signRailHeader({
        account,
        sequence: seq.sequence,
        asset: 'BTC',
        height: n.height,
        hash: n.hash,
        parentHash: n.parentHash,
        merkleRoot: n.merkleRoot,
        raw: n.raw,
        fee: FEE,
        networkId: network.networkId,
        falconSecret: secret,
      })
      await submitSigned(tx, network.key)
      log({ kind: 'work', detail: `BTC header ${n.height} submitted`, txId: tx.tx_id })
      setInfo(`Submitted Bitcoin header ${n.height}. It counts as 1 work if it lands before the daemon's copy.`)
      void refresh()
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(null)
    }
  }

  const claim = async () => {
    setBusy('claim')
    setError(null)
    setInfo(null)
    try {
      if (!account) throw new Error('Create or open your wallet first (Wallet page).')
      needFee()
      const secret = await unlock()
      const seq = await fetchSequenceInfo(account, network.key)
      const tx = await signPlClaim({
        account,
        sequence: seq.sequence,
        fee: FEE,
        networkId: network.networkId,
        falconSecret: secret,
      })
      await submitSigned(tx, network.key)
      log({ kind: 'claimed', detail: `claim of ${snap?.claimable ?? 0} FPL submitted`, txId: tx.tx_id })
      setInfo('Claim submitted. Your balance updates when the next ledger closes.')
      void refresh()
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(null)
    }
  }

  const mine = Boolean(account && snap?.account === account)
  const present = running && Boolean(snap?.inSlot || lastBeatSlot.current === snap?.currentSlot)

  return (
    <div className="card p-6 space-y-4 border-brand-500/20 bg-slate-900/70 backdrop-blur-md shadow-[0_0_40px_rgba(192,120,56,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-brand-400/90">
            Pre-public beta · PL 2300
          </p>
          <h2 className="text-lg font-semibold text-white mt-1">Watcher &amp; claims</h2>
          <p className="text-slate-400 text-xs mt-1">
            Your wallet signs everything in this tab. Heartbeats mark the hour slot; real Bitcoin
            headers are the work. Pay = 5% watcher bucket by work × slots / 168, capped at 0.05% of
            the epoch emission per account. Heartbeats alone earn nothing.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`w-2 h-2 rounded-full ${
              present ? 'bg-emerald-400 animate-pulse' : running ? 'bg-amber-400' : 'bg-slate-600'
            }`}
          />
          <span className={`text-xs font-medium ${present ? 'text-emerald-400' : running ? 'text-amber-400' : 'text-slate-500'}`}>
            {present ? 'IN' : running ? 'on' : 'OUT'}
          </span>
        </div>
      </div>

      {!is2300 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Watchers run on Falcon PL 2300. Switch network to use them.
        </div>
      )}
      {walletLoaded && !wallet && (
        <div className="rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
          No wallet on this device. Create one on the Wallet page, fund it from the faucet, then
          come back to watch. Showing the demo watcher below.
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-400">
        Epoch <span className="text-slate-200 font-mono">{snap?.epoch ?? '—'}</span>
        {' · '}settles in <span className="text-slate-200 font-mono">{fmtDuration(snap?.epochEndsInMs)}</span>
        {' · '}claimable <span className="text-slate-200 font-mono">{(snap?.claimable ?? 0).toLocaleString()} FPL</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={Boolean(busy) || !wallet || !is2300}
          onClick={() => (running ? stop() : void start())}
        >
          {busy === 'start' ? 'Unlocking…' : running ? 'Stop watcher' : 'Start watcher'}
        </button>
        <button
          type="button"
          disabled={Boolean(busy) || !is2300}
          onClick={() => void work()}
          className="w-full py-3.5 px-6 rounded-xl font-semibold text-brand-200
                     bg-slate-800 hover:bg-slate-700 border border-brand-500/40
                     disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {busy === 'work' ? 'Checking Bitcoin…' : 'Submit rail work'}
        </button>
        <button
          type="button"
          disabled={Boolean(busy) || !wallet || !mine || !snap?.canClaim || !is2300}
          onClick={() => void claim()}
          className="col-span-2 w-full py-3.5 px-6 rounded-xl font-semibold text-emerald-200
                     bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40
                     disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {busy === 'claim' ? 'Claiming…' : `Claim ${(mine ? snap?.claimable ?? 0 : 0).toLocaleString()} FPL`}
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        Start asks for your passkey once; the key stays in this tab only until you press Stop or
        close it. Each heartbeat, header or claim costs a {FEE} FPL fee.
      </p>

      {info && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-300">{info}</div>
      )}
      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Account', value: snap?.account || account || '—' },
          { label: 'Balance', value: snap ? `${snap.balance.toLocaleString()} FPL` : '—' },
          { label: 'Slot', value: snap ? `${snap.currentSlot}${snap.inSlot ? ' · marked' : ''}` : '—' },
          { label: 'Slots this epoch', value: String(snap?.slots ?? 0) },
          { label: 'Work this epoch', value: String(snap?.work ?? 0) },
          { label: 'Weight', value: String(snap?.weight ?? 0) },
          { label: 'Epoch', value: snap ? `${snap.epoch} / settled ${snap.lastSettledEpoch ?? '—'}` : '—' },
          {
            label: 'BTC rail / testnet',
            value: `${snap?.railTip ?? btc?.railTip ?? '—'} / ${btc?.chainTip ?? '—'}`,
          },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl bg-slate-800/60 border border-slate-800 px-3 py-2">
            <div className="text-[11px] text-slate-500">{label}</div>
            <div className="font-mono text-xs text-slate-200 break-all">{value}</div>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <div className="text-[11px] uppercase tracking-wider text-slate-500">This tab</div>
        <ol className="max-h-48 overflow-y-auto space-y-1.5 text-xs">
          {events.length === 0 && <li className="text-slate-600">Nothing yet. Press Start watcher.</li>}
          {events.map((ev, i) => (
            <li key={`${ev.at}-${i}`} className="flex gap-2">
              <span className="text-slate-600 font-mono shrink-0">{ev.at.slice(11, 19)}</span>
              <span className={`${KIND_COLOR[ev.kind]} font-medium w-16 shrink-0`}>{ev.kind}</span>
              <span className="text-slate-400 break-all">
                {ev.detail}
                {ev.txId ? ` · ${ev.txId.slice(0, 12)}…` : ''}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
