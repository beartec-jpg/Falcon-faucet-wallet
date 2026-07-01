'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/Header'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NetworkStatus {
  online: boolean
  state?: string
  ledger?: number
  peers?: number
  loadFactor?: number
}

interface DripResult {
  txHash: string
  amount: number
  account: string
  reset: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const NETWORK_NAME = process.env.NEXT_PUBLIC_NETWORK_NAME ?? 'Falcon Ledger Testnet'
const EXPLORER_URL = process.env.NEXT_PUBLIC_EXPLORER_URL ?? ''
const DRIP_AMOUNT  = parseInt(process.env.NEXT_PUBLIC_DRIP_AMOUNT_QXRP ?? '2000', 10)

// ─── Subcomponents ───────────────────────────────────────────────────────────

function StatusDot({ online, state }: { online: boolean; state?: string }) {
  const active = online && (state === 'proposing' || state === 'full')
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`w-2 h-2 rounded-full ${active ? 'bg-emerald-400 animate-pulse-slow' : online ? 'bg-amber-400 animate-pulse-slow' : 'bg-slate-600'}`} />
      <span className={active ? 'text-emerald-400' : online ? 'text-amber-400' : 'text-slate-500'}>
        {!online ? 'Offline' : state ?? 'Connecting…'}
      </span>
    </div>
  )
}

function TxHashDisplay({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(hash)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  const short = `${hash.slice(0, 8)}…${hash.slice(-8)}`
  const explorerHref = EXPLORER_URL ? `${EXPLORER_URL}/tx/${hash}` : null

  return (
    <div className="flex items-center gap-2 font-mono text-sm">
      {explorerHref ? (
        <a href={explorerHref} target="_blank" rel="noopener noreferrer"
           className="text-brand-400 hover:text-brand-300 underline underline-offset-2">
          {short}
        </a>
      ) : (
        <span className="text-slate-300">{short}</span>
      )}
      <button onClick={copy} className="text-slate-500 hover:text-slate-300 transition-colors" title="Copy full hash">
        {copied ? (
          <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

function FaucetPageInner() {
  const searchParams = useSearchParams()
  const [address, setAddress]   = useState(() => searchParams?.get('address') ?? '')
  const [status, setStatus]     = useState<NetworkStatus>({ online: false })
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState<DripResult | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [resetIso, setResetIso]     = useState<string | null>(null)
  const [cooldownDisplay, setCooldownDisplay] = useState<string | null>(null)

  // ── Poll network status every 10s ─────────────────────────────────────────
  const refreshStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/status')
      const data = await r.json()
      setStatus(data)
    } catch {
      setStatus({ online: false })
    }
  }, [])

  useEffect(() => {
    refreshStatus()
    const id = setInterval(refreshStatus, 10_000)
    return () => clearInterval(id)
  }, [refreshStatus])

  // ── Cooldown countdown ────────────────────────────────────────────────────
  useEffect(() => {
    if (!resetIso) {
      setCooldownDisplay(null)
      return
    }

    const update = () => {
      const secs = Math.max(0, Math.floor((new Date(resetIso).getTime() - Date.now()) / 1000))
      if (secs <= 0) {
        setResetIso(null)
        setCooldownDisplay(null)
        return
      }
      const h = Math.floor(secs / 3600)
      const m = Math.floor((secs % 3600) / 60)
      const s = secs % 60
      setCooldownDisplay(
        h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`
      )
    }

    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [resetIso])

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/faucet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: address.trim() }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Request failed')
        if (data.reset) setResetIso(data.reset)
      } else {
        setResult(data)
        setAddress('')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col">

      <Header current="faucet">
        <StatusDot online={status.online} state={status.state} />
      </Header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg space-y-6">

          {/* Logo */}
          <div className="flex justify-center pb-2">
            <div className="w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0 shadow-lg border border-brand-500/20">
              <Image src="/falcon-logo.png" alt="Falcon Ledger" width={96} height={96} className="w-full h-full object-cover" />
            </div>
          </div>

          {/* Hero */}
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold text-white">
              Get testnet{' '}
              <span className="text-brand-500">FALCON</span>
            </h1>
            <p className="text-slate-400 text-sm">
              {DRIP_AMOUNT.toLocaleString()} FALCON per successful drip · failed attempts don&apos;t count
            </p>
          </div>

          {/* Faucet card */}
          <div className="card p-6 space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="address" className="block text-sm font-medium text-slate-300">
                  Your Falcon address
                </label>
                <input
                  id="address"
                  type="text"
                  value={address}
                  onChange={e => { setAddress(e.target.value); setError(null) }}
                  placeholder="r…"
                  autoComplete="off"
                  spellCheck={false}
                  className="input-field"
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                disabled={loading || !address.trim() || !status.online}
                className="btn-primary"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin-slow" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Sending…
                  </span>
                ) : (
                  `Request ${DRIP_AMOUNT} FALCON`
                )}
              </button>
            </form>

            {/* Error */}
            {error && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400 space-y-1">
                <div className="font-medium">{error}</div>
                {cooldownDisplay && (
                  <div className="text-red-400/70">Try again in {cooldownDisplay}</div>
                )}
              </div>
            )}

            {/* Success */}
            {result && (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-4 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {result.amount} FALCON sent!
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                  <span className="text-slate-500">To</span>
                  <span className="font-mono text-slate-300 text-xs break-all">{result.account}</span>
                  <span className="text-slate-500">Tx</span>
                  <TxHashDisplay hash={result.txHash} />
                </div>
                <Link
                  href={`/wallet?address=${encodeURIComponent(result.account)}`}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 transition-colors"
                >
                  Open in Wallet →
                </Link>
              </div>
            )}
          </div>

          {/* Network info grid */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Ledger', value: status.ledger?.toLocaleString() ?? '—' },
              { label: 'Peers',  value: status.peers?.toString() ?? '—' },
              { label: 'State',  value: status.state ?? '—' },
              { label: 'Load factor', value: status.loadFactor?.toFixed(2) ?? '—' },
            ].map(({ label, value }) => (
              <div key={label} className="card px-4 py-3">
                <div className="text-xs text-slate-500 mb-0.5">{label}</div>
                <div className="font-mono text-sm text-slate-200">{value}</div>
              </div>
            ))}
          </div>

          {/* Wallet shortcut */}
          <Link
            href="/wallet"
            className="card px-4 py-3 flex items-center justify-between text-sm hover:border-brand-500/40 transition-all"
          >
            <div className="flex items-center gap-2 text-slate-400">
              <svg className="w-4 h-4 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              Open Falcon Wallet
            </div>
            <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          {/* Help text */}
          <p className="text-center text-xs text-slate-600">
            Tokens have no real value · For testing only ·{' '}
            <a href="https://github.com/beartec-jpg/qXRP" target="_blank" rel="noopener noreferrer"
               className="text-slate-500 hover:text-slate-400 underline underline-offset-2">
              Falcon Ledger on GitHub
            </a>
          </p>
        </div>
      </main>
    </div>
  )
}

export default function FaucetPage() {
  return (
    <Suspense>
      <FaucetPageInner />
    </Suspense>
  )
}
