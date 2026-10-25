'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/Header'
import Logo from '@/components/Logo'
import ProductShell from '@/components/ProductShell'
import WatcherPanel, { type WatcherSnap } from '@/components/WatcherPanel'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NetworkStatus {
  online: boolean
  state?: string
  ledger?: number
  product?: string
  networkId?: number
  tip?: number
  epoch?: number
  firstClaimEpoch?: number
  error?: string
}

interface DripResult {
  txHash: string
  amount: number
  amountBtc?: string
  amountSats?: number
  asset?: string
  account: string
  resolvedFrom?: string
  reset?: string
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function StatusDot({ online, state }: { online: boolean; state?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-400 animate-pulse-slow' : 'bg-slate-600'}`} />
      <span className={online ? 'text-emerald-400' : 'text-slate-500'}>
        {!online ? 'Offline' : state ?? 'Live'}
      </span>
    </div>
  )
}

function TxHashDisplay({ hash, explorerUrl }: { hash: string; explorerUrl: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(hash)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  const short = `${hash.slice(0, 8)}…${hash.slice(-8)}`
  const explorerHref = explorerUrl ? `${explorerUrl}/tx/${hash}` : null

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

const PL_DRIP = 2_000

function looksLikeTestnet4BtcAddr(s: string): boolean {
  const v = s.trim()
  if (/^tb1[ac-hj-np-z02-9]{25,87}$/i.test(v)) return true
  if (!v.includes('.') && /^[mn2][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(v)) return true
  return false
}

function FaucetPageInner({ initialWatcher }: { initialWatcher?: WatcherSnap | null }) {
  const searchParams = useSearchParams()
  const [address, setAddress] = useState(
    () => searchParams?.get('address') ?? searchParams?.get('account') ?? '',
  )
  const [faucetAsset, setFaucetAsset] = useState<'fpl' | 'tbtc'>(() => {
    const assetParam = (searchParams?.get('asset') ?? '').toLowerCase()
    if (assetParam === 'btc' || assetParam === 'tbtc' || assetParam === 'btc4') return 'tbtc'
    const addrParam = searchParams?.get('address') ?? searchParams?.get('account') ?? ''
    if (looksLikeTestnet4BtcAddr(addrParam)) return 'tbtc'
    return 'fpl'
  })

  useEffect(() => {
    const fromUrl = searchParams?.get('address') ?? searchParams?.get('account') ?? ''
    if (fromUrl) setAddress(fromUrl)
    const assetParam = (searchParams?.get('asset') ?? '').toLowerCase()
    if (assetParam === 'btc' || assetParam === 'tbtc' || assetParam === 'btc4') {
      setFaucetAsset('tbtc')
    } else if (fromUrl && looksLikeTestnet4BtcAddr(fromUrl)) {
      setFaucetAsset('tbtc')
    }
  }, [searchParams])

  const [status, setStatus]     = useState<NetworkStatus>({ online: false })
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState<DripResult | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [resetIso, setResetIso]     = useState<string | null>(null)
  const [cooldownDisplay, setCooldownDisplay] = useState<string | null>(null)

  // ── Poll network status every 10s ─────────────────────────────────────────
  const refreshStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/pl2300', { cache: 'no-store' })
      const data = await r.json()
      setStatus({
        online: Boolean(data.online),
        state: data.online ? `tip ${Number(data.tip ?? 0).toLocaleString()}` : 'Offline',
        ledger: data.tip,
        tip: data.tip,
        product: data.product,
        networkId: data.networkId,
        epoch: data.epoch,
        firstClaimEpoch: data.firstClaimEpoch,
        error: data.error,
      })
    } catch {
      setStatus({ online: false, state: 'Offline' })
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
        body: JSON.stringify({
          account: address.trim(),
          asset: faucetAsset,
          network: 'testnet',
        }),
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
    <ProductShell intensity={0.5} className="flex-1 min-h-0">
      <Header current="faucet" subtitle="Falcon PL · 2300">
        <StatusDot online={status.online} state={status.state} />
      </Header>
      <div className="bg-amber-950/50 border-b border-amber-800/40 px-4 py-2 text-center text-xs text-amber-200/90">
        <span className="font-medium">Falcon PL</span>
        {' · '}Network ID 2300
        {' · '}Pre-public beta — test tokens, no cash value
      </div>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg space-y-6">

          {/* Logo */}
          <Logo />

          {/* Hero */}
          <div className="text-center space-y-2">
            <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-brand-400/90">
              Falcon PL faucet
            </p>
            {faucetAsset === 'fpl' ? (
              <>
                <h1 className="text-3xl font-bold text-white tracking-tight">
                  Get testnet{' '}
                  <span className="bg-gradient-to-r from-brand-400 to-brand-500 bg-clip-text text-transparent">
                    FPL
                  </span>
                </h1>
                <p className="text-slate-400 text-sm">
                  {PL_DRIP.toLocaleString()} FPL per successful drip · failed attempts don&apos;t count
                </p>
              </>
            ) : (
              <>
                <h1 className="text-3xl font-bold text-white tracking-tight">
                  Get Testnet4{' '}
                  <span className="bg-gradient-to-r from-orange-400 to-amber-500 bg-clip-text text-transparent">
                    BTC
                  </span>
                </h1>
                <p className="text-slate-400 text-sm">
                  0.002 tBTC (200,000 sats) for BitVM2 BTC4 bridge testing
                </p>
              </>
            )}
          </div>

          {/* Faucet card */}
          <div className="card p-6 space-y-4 border-brand-500/20 bg-slate-900/70 backdrop-blur-md shadow-[0_0_40px_rgba(192,120,56,0.08)]">
            {/* Asset toggle */}
            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-950/70 p-1 border border-slate-800/80">
              <button
                type="button"
                onClick={() => {
                  setFaucetAsset('fpl')
                  setError(null)
                  setResult(null)
                }}
                className={`py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                  faucetAsset === 'fpl'
                    ? 'bg-brand-500/20 text-brand-300 border border-brand-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                FPL (2,000 FPL)
              </button>
              <button
                type="button"
                onClick={() => {
                  setFaucetAsset('tbtc')
                  setError(null)
                  setResult(null)
                }}
                className={`py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                  faucetAsset === 'tbtc'
                    ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Testnet4 BTC (0.002 tBTC)
              </button>
            </div>

            <form action="/api/faucet" method="post" onSubmit={handleSubmit} className="space-y-4">
              <input type="hidden" name="network" value="testnet" />
              <input type="hidden" name="asset" value={faucetAsset} />
              <input type="hidden" name="account" value={address.trim()} />
              <div className="space-y-1.5">
                <label htmlFor="address" className="block text-sm font-medium text-slate-300">
                  {faucetAsset === 'fpl'
                    ? 'Your Falcon PL account'
                    : 'Testnet4 BTC address or linked Falcon PL name'}
                </label>
                <input
                  id="address"
                  type="text"
                  value={address}
                  onChange={e => { setAddress(e.target.value); setError(null) }}
                  placeholder={
                    faucetAsset === 'fpl'
                      ? 'your.name or r… from wallet'
                      : 'tb1q… / m… / n… or your.name'
                  }
                  autoComplete="off"
                  spellCheck={false}
                  className="input-field font-mono text-sm"
                  disabled={loading}
                />
                <p className="text-[11px] text-slate-500">
                  {faucetAsset === 'fpl'
                    ? 'Use the account name you created (or the r… on an older wallet). Opening faucet from Wallet fills this in.'
                    : 'Enter your Testnet4 BTC address (tb1… / m… / n…) or your Falcon PL account name (resolves to your linked Multi-chain BTC address).'}
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || !address.trim()}
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
                ) : faucetAsset === 'tbtc' ? (
                  'Request 0.002 tBTC'
                ) : (
                  `Request ${PL_DRIP} FPL`
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
                  {result.asset === 'tBTC'
                    ? `${result.amountBtc ?? '0.002'} tBTC sent!`
                    : `${result.amount} FPL sent!`}
                </div>
                {result.resolvedFrom && (
                  <div className="text-xs text-emerald-300/90 font-mono">
                    Linked name: {result.resolvedFrom} → {result.account}
                  </div>
                )}
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                  <span className="text-slate-500">To</span>
                  <span className="font-mono text-slate-300 text-xs break-all">{result.account}</span>
                  <span className="text-slate-500">Tx</span>
                  <TxHashDisplay
                    hash={result.txHash}
                    explorerUrl={result.asset === 'tBTC' ? 'https://mempool.space/testnet4' : '/scan'}
                  />
                </div>
                {result.asset === 'tBTC' ? (
                  <Link
                    href="/bridge"
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 transition-colors"
                  >
                    Open BTC4 Bridge →
                  </Link>
                ) : (
                  <Link
                    href={`/wallet?address=${encodeURIComponent(result.account)}`}
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 transition-colors"
                  >
                    Open in Wallet →
                  </Link>
                )}
              </div>
            )}
          </div>

          <WatcherPanel initial={initialWatcher ?? null} />

          {/* Network info grid */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Tip', value: (status.tip ?? status.ledger)?.toLocaleString() ?? '—' },
              { label: 'Network', value: status.networkId != null ? String(status.networkId) : '2300' },
              { label: 'Epoch', value: status.epoch != null ? `${status.epoch} / claim ${status.firstClaimEpoch ?? 1}` : '—' },
              { label: 'Mesh', value: status.online ? 'live' : 'offline' },
            ].map(({ label, value }) => (
              <div key={label} className="card px-4 py-3 border-slate-800/80 bg-slate-900/60 backdrop-blur-sm">
                <div className="text-xs text-slate-500 mb-0.5">{label}</div>
                <div className="font-mono text-sm text-slate-200">{value}</div>
              </div>
            ))}
          </div>

          {/* Wallet shortcut */}
          <Link
            href="/wallet"
            className="card px-4 py-3 flex items-center justify-between text-sm border-slate-800/80 bg-slate-900/60 backdrop-blur-sm hover:border-brand-500/40 hover:bg-slate-900/80 transition-all"
          >
            <div className="flex items-center gap-2 text-slate-400">
              <svg className="w-4 h-4 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              Open Falcon PL wallet
            </div>
            <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          {/* Help text */}
          <p className="text-center text-xs text-slate-500">
            <Link href="/" className="text-brand-400/90 hover:text-brand-300 underline underline-offset-2">
              ← Falcon PL home
            </Link>
            {' · '}
            Tokens have no real value · For testing only
          </p>
        </div>
      </main>
    </ProductShell>
  )
}

export default function FaucetClient({
  initialWatcher,
}: {
  initialWatcher?: WatcherSnap | null
}) {
  return (
    <Suspense>
      <FaucetPageInner initialWatcher={initialWatcher} />
    </Suspense>
  )
}
