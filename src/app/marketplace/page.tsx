'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  isPasskeySupported,
  authenticatePasskey,
} from '@/lib/passkey'
import { decryptSeed } from '@/lib/wallet-crypto'
import { loadWallets, type StoredWallet } from '@/lib/wallet-store'
import {
  keysFromSeed,
  signTrustSet,
  signOfferCreate,
  TF_IMMEDIATE_OR_CANCEL,
  type IouAmount,
} from '@/lib/wallet-sign-client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AmmInfo {
  type:       'amm' | 'dex'
  xrpPool:    number
  tokenPool:  number
  price:      number    // qXRP per 1 token
  tradingFee: number
  accountId?: string
  offerCount?: number
}

interface TokenInfo {
  symbol:      string
  currency:    string
  issuer:      string
  configured:  boolean
  amm:         AmmInfo | null
  userBalance: { balance: number; limit: number } | null
}

interface MarketData {
  tokens: TokenInfo[]
}

const DROPS_PER_XRP = 1_000_000
const NETWORK_NAME  = process.env.NEXT_PUBLIC_NETWORK_NAME ?? 'qXRP Testnet'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin-slow ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function fmtPrice(price: number): string {
  if (price === 0) return '—'
  if (price < 0.001) return price.toExponential(4)
  return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}

function fmtAmount(n: number, decimals = 4): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals })
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function MarketplacePage() {
  const [wallet,     setWallet]     = useState<StoredWallet | null>(null)
  const [xrpBalance, setXrpBal]    = useState<number | null>(null)
  const [sequence,   setSequence]   = useState(0)
  const [ledger,     setLedger]     = useState(0)
  const [market,     setMarket]     = useState<MarketData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [busy,       setBusy]       = useState(false)
  const [txResult,   setTxResult]   = useState<{ ok: boolean; msg: string; hash?: string } | null>(null)

  // Swap form
  const [swapToken,  setSwapToken]  = useState<TokenInfo | null>(null)
  const [swapDir,    setSwapDir]    = useState<'buy' | 'sell'>('buy')   // buy = qXRP→token
  const [swapAmt,    setSwapAmt]    = useState('')

  // Load wallet + balances
  const refresh = useCallback(async (address: string) => {
    const [accR, mktR] = await Promise.all([
      fetch(`/api/wallet/account?address=${encodeURIComponent(address)}`).then(r => r.json()),
      fetch(`/api/marketplace?address=${encodeURIComponent(address)}`).then(r => r.json()),
    ])
    if (accR.exists) {
      setXrpBal(accR.balance)
      setSequence(accR.sequence)
      setLedger(accR.currentLedger)
    }
    if (mktR.tokens) {
      setMarket(mktR)
      // Default swap to first configured token
      if (!swapToken) {
        const first = mktR.tokens.find((t: TokenInfo) => t.configured)
        if (first) setSwapToken(first)
      }
    }
  }, [swapToken])

  useEffect(() => {
    loadWallets().then(wallets => {
      if (wallets.length > 0) {
        setWallet(wallets[0])
        refresh(wallets[0].address).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    }).catch(() => setLoading(false))
  }, [refresh])

  // ── Set trust line ─────────────────────────────────────────────────────────

  const handleTrustLine = async (tok: TokenInfo) => {
    if (!wallet) return
    setBusy(true)
    setError(null)
    setTxResult(null)
    try {
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const seed         = await decryptSeed(wallet.encrypted, keyBytes)

      const { tx_blob } = await signTrustSet(
        {
          account:            wallet.address,
          currency:           tok.currency,
          issuer:             tok.issuer,
          limit:              '10000000',
          sequence,
          lastLedgerSequence: ledger + 20,
        },
        seed,
      )

      const res  = await fetch('/api/wallet/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ tx_blob }),
      })
      const data = await res.json()
      setTxResult({ ok: !!data.success, msg: data.message ?? data.result ?? '', hash: data.hash })
      if (data.success) {
        setTimeout(() => refresh(wallet.address), 4000)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  // ── Swap (OfferCreate) ─────────────────────────────────────────────────────

  const handleSwap = async () => {
    if (!wallet || !swapToken || !swapAmt) return
    const amt = parseFloat(swapAmt)
    if (isNaN(amt) || amt <= 0) { setError('Invalid amount'); return }

    setBusy(true)
    setError(null)
    setTxResult(null)

    try {
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const seed         = await decryptSeed(wallet.encrypted, keyBytes)

      // Estimate the other side using AMM price with 1% slippage tolerance
      const price = swapToken.amm?.price ?? 1   // qXRP per token
      let takerGets: string | IouAmount
      let takerPays: string | IouAmount

      if (swapDir === 'buy') {
        // Spend qXRP, receive token
        const xrpDrops   = String(Math.round(amt * DROPS_PER_XRP))
        const tokenAmt   = price > 0 ? (amt / price) * 0.99 : amt  // min 99% fill
        takerGets = xrpDrops
        takerPays = { currency: swapToken.currency, issuer: swapToken.issuer, value: fmtAmount(tokenAmt, 8) }
      } else {
        // Spend token, receive qXRP
        const xrpAmt     = (amt * price) * 0.99  // min 99% fill
        const xrpDrops   = String(Math.round(xrpAmt * DROPS_PER_XRP))
        takerGets = { currency: swapToken.currency, issuer: swapToken.issuer, value: String(amt) }
        takerPays = xrpDrops
      }

      const { tx_blob } = await signOfferCreate(
        {
          account:            wallet.address,
          takerGets,
          takerPays,
          sequence,
          lastLedgerSequence: ledger + 20,
          flags:              TF_IMMEDIATE_OR_CANCEL,
        },
        seed,
      )

      const res  = await fetch('/api/wallet/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ tx_blob }),
      })
      const data = await res.json()
      setTxResult({ ok: !!data.success, msg: data.message ?? data.result ?? '', hash: data.hash })
      setSwapAmt('')
      if (data.success) {
        setTimeout(() => refresh(wallet.address), 4000)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Swap failed')
    } finally {
      setBusy(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  // Estimated output for swap preview
  const swapAmtNum   = parseFloat(swapAmt) || 0
  const activePrice  = swapToken?.amm?.price ?? 0
  const swapEstimate = activePrice > 0
    ? swapDir === 'buy'
      ? swapAmtNum / activePrice
      : swapAmtNum * activePrice
    : null

  return (
    <div className="min-h-screen flex flex-col">

      {/* ── Header ── */}
      <header className="border-b border-slate-800/60 px-4 py-3 flex items-center justify-between sticky top-0 bg-slate-950/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center font-bold text-slate-950 text-sm">Q</div>
          <div>
            <div className="font-semibold text-white leading-tight">{NETWORK_NAME}</div>
            <div className="text-xs text-slate-500">Marketplace · AMM DEX</div>
          </div>
        </div>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/"          className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors">Faucet</Link>
          <Link href="/scan"      className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors">Explorer</Link>
          <Link href="/wallet"    className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors">Wallet</Link>
          <span                   className="px-3 py-1.5 rounded-lg bg-brand-500/10 text-brand-500 font-medium">Market</span>
        </nav>
      </header>

      <main className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full space-y-5">

        {loading && (
          <div className="flex items-center justify-center py-24 text-slate-500 gap-3">
            <Spinner className="w-5 h-5" /><span>Loading…</span>
          </div>
        )}

        {!loading && !wallet && (
          <div className="card p-8 text-center space-y-3">
            <div className="text-slate-400">No wallet found</div>
            <Link href="/wallet" className="btn-primary inline-block px-6 py-2.5 rounded-xl text-sm font-semibold">
              Create Wallet →
            </Link>
          </div>
        )}

        {!loading && wallet && (
          <>
            {/* ── Wallet summary ── */}
            <div className="card p-5">
              <div className="text-xs text-slate-500 mb-1">Your wallet</div>
              <div className="font-mono text-sm text-slate-300 mb-3">{wallet.address}</div>
              <div className="grid grid-cols-3 gap-3">
                {/* qXRP */}
                <div className="bg-slate-800/60 rounded-xl p-3 text-center">
                  <div className="text-xs text-slate-500 mb-1">qXRP</div>
                  <div className="text-lg font-bold text-white">
                    {xrpBalance !== null ? fmtAmount(xrpBalance, 2) : '—'}
                  </div>
                </div>
                {/* Token balances */}
                {market?.tokens.map(tok => (
                  <div key={tok.symbol} className="bg-slate-800/60 rounded-xl p-3 text-center">
                    <div className="text-xs text-slate-500 mb-1">{tok.symbol}</div>
                    {tok.userBalance !== null ? (
                      <div className="text-lg font-bold text-white">{fmtAmount(tok.userBalance.balance, 2)}</div>
                    ) : (
                      <div className="text-sm text-slate-600 mt-1">No trust line</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ── Token info + trust lines ── */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-300 px-1">Available Tokens</h2>
              {market?.tokens.map(tok => (
                <div key={tok.symbol} className="card p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="font-semibold text-white flex items-center gap-2">
                        {tok.symbol}
                        <span className="text-xs text-slate-500 font-normal font-mono">{tok.currency}</span>
                      </div>
                      {tok.configured ? (
                        <div className="text-xs text-slate-500 font-mono mt-0.5">{tok.issuer}</div>
                      ) : (
                        <div className="text-xs text-amber-500 mt-0.5">Not configured — run 07_issue_stables.py first</div>
                      )}
                    </div>
                    {tok.configured && tok.userBalance === null && (
                      <button
                        onClick={() => handleTrustLine(tok)}
                        disabled={busy || !isPasskeySupported()}
                        className="text-xs px-3 py-1.5 rounded-lg bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 border border-brand-500/20 disabled:opacity-40 transition-colors"
                      >
                        {busy ? <Spinner className="w-3 h-3" /> : 'Add Trust Line'}
                      </button>
                    )}
                    {tok.userBalance !== null && (
                      <span className="text-xs text-emerald-400 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Trust line set
                      </span>
                    )}
                  </div>

                  {/* Pool / book info */}
                  {tok.amm ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-mono ${tok.amm.type === 'amm' ? 'bg-purple-500/10 text-purple-400' : 'bg-cyan-500/10 text-cyan-400'}`}>
                          {tok.amm.type === 'amm' ? 'AMM' : 'DEX'}
                        </span>
                        {tok.amm.type === 'dex' && tok.amm.offerCount && (
                          <span>{tok.amm.offerCount} offer{tok.amm.offerCount !== 1 ? 's' : ''} in book</span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="bg-slate-800/60 rounded-lg px-3 py-2">
                          <div className="text-slate-500">qXRP depth</div>
                          <div className="text-slate-200 font-mono">{fmtAmount(tok.amm.xrpPool, 0)}</div>
                        </div>
                        <div className="bg-slate-800/60 rounded-lg px-3 py-2">
                          <div className="text-slate-500">{tok.symbol} depth</div>
                          <div className="text-slate-200 font-mono">{fmtAmount(tok.amm.tokenPool, 0)}</div>
                        </div>
                        <div className="bg-slate-800/60 rounded-lg px-3 py-2">
                          <div className="text-slate-500">Best price</div>
                          <div className="text-slate-200 font-mono">{fmtPrice(tok.amm.price)} qXRP</div>
                        </div>
                      </div>
                    </div>
                  ) : tok.configured ? (
                    <div className="text-xs text-slate-600 bg-slate-800/40 rounded-lg px-3 py-2">
                      No liquidity yet — run 07_issue_stables.py to seed the order book
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            {/* ── Swap panel ── */}
            {market?.tokens.some(t => t.configured && t.amm) && (
              <div className="card p-5 space-y-4">
                <h2 className="text-sm font-semibold text-white">Swap</h2>

                {/* Token selector */}
                <div className="flex gap-2">
                  {market.tokens.filter(t => t.configured && t.amm).map(tok => (
                    <button
                      key={tok.symbol}
                      onClick={() => { setSwapToken(tok); setSwapAmt('') }}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        swapToken?.symbol === tok.symbol
                          ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      qXRP / {tok.symbol}
                    </button>
                  ))}
                </div>

                {swapToken && (
                  <>
                    {/* Direction toggle */}
                    <div className="flex rounded-xl overflow-hidden border border-slate-700 text-sm">
                      <button
                        onClick={() => { setSwapDir('buy'); setSwapAmt('') }}
                        className={`flex-1 py-2 font-medium transition-colors ${
                          swapDir === 'buy'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        Buy {swapToken.symbol}
                      </button>
                      <button
                        onClick={() => { setSwapDir('sell'); setSwapAmt('') }}
                        className={`flex-1 py-2 font-medium transition-colors ${
                          swapDir === 'sell'
                            ? 'bg-red-500/10 text-red-400'
                            : 'text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        Sell {swapToken.symbol}
                      </button>
                    </div>

                    {/* Amount input */}
                    <div className="space-y-1.5">
                      <label className="text-xs text-slate-400">
                        {swapDir === 'buy' ? 'Spend (qXRP)' : `Sell (${swapToken.symbol})`}
                      </label>
                      <input
                        type="number"
                        value={swapAmt}
                        onChange={e => { setSwapAmt(e.target.value); setError(null) }}
                        placeholder="0.000000"
                        min="0.000001"
                        step="any"
                        className="input-field"
                        disabled={busy}
                      />
                      {/* Max button */}
                      <div className="flex justify-between text-xs text-slate-600">
                        <span>
                          {swapDir === 'buy'
                            ? xrpBalance !== null ? `Available: ${fmtAmount(xrpBalance, 4)} qXRP` : ''
                            : swapToken.userBalance !== null ? `Available: ${fmtAmount(swapToken.userBalance.balance, 4)} ${swapToken.symbol}` : 'No trust line'}
                        </span>
                        {swapDir === 'buy' && xrpBalance && (
                          <button
                            type="button"
                            onClick={() => setSwapAmt(String(Math.max(0, xrpBalance - 0.1).toFixed(6)))}
                            className="text-brand-500 hover:text-brand-400 transition-colors"
                          >Max</button>
                        )}
                        {swapDir === 'sell' && swapToken.userBalance && (
                          <button
                            type="button"
                            onClick={() => setSwapAmt(String(swapToken.userBalance!.balance))}
                            className="text-brand-500 hover:text-brand-400 transition-colors"
                          >Max</button>
                        )}
                      </div>
                    </div>

                    {/* Estimate */}
                    {swapEstimate !== null && swapAmtNum > 0 && (
                      <div className="bg-slate-800/60 rounded-xl px-4 py-3 text-sm">
                        <div className="flex justify-between text-slate-400">
                          <span>You receive ~</span>
                          <span className="text-white font-semibold">
                            {fmtAmount(swapEstimate, 4)}{' '}
                            <span className="text-brand-500">
                              {swapDir === 'buy' ? swapToken.symbol : 'qXRP'}
                            </span>
                          </span>
                        </div>
                        <div className="flex justify-between text-xs text-slate-600 mt-1">
                          <span>Rate</span>
                          <span>{fmtPrice(swapToken.amm!.price)} qXRP per {swapToken.symbol}</span>
                        </div>
                        {swapToken.amm!.tradingFee > 0 && (
                          <div className="flex justify-between text-xs text-slate-600">
                            <span>AMM fee</span>
                            <span>{(swapToken.amm!.tradingFee / 1000).toFixed(2)}%</span>
                          </div>
                        )}
                        {swapToken.amm!.type === 'dex' && (
                          <div className="flex justify-between text-xs text-slate-600">
                            <span>Liquidity type</span>
                            <span className="text-cyan-400">DEX order book</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* No trust line warning */}
                    {swapDir === 'buy' && swapToken.userBalance === null && (
                      <div className="text-xs text-amber-400 bg-amber-500/10 rounded-xl px-3 py-2.5">
                        You need to add a {swapToken.symbol} trust line before you can receive it.
                      </div>
                    )}

                    <button
                      onClick={handleSwap}
                      disabled={busy || !swapAmt || swapAmtNum <= 0 || (swapDir === 'buy' && swapToken.userBalance === null)}
                      className="btn-primary flex items-center justify-center gap-2"
                    >
                      {busy ? (
                        <><Spinner /> Waiting for passkey…</>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                          </svg>
                          {swapDir === 'buy' ? `Buy ${swapToken.symbol}` : `Sell ${swapToken.symbol}`} with Passkey
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* ── TX result ── */}
            {txResult && (
              <div className={`card p-4 space-y-2 ${txResult.ok ? 'border border-emerald-500/20' : 'border border-red-500/20'}`}>
                <div className={`flex items-center gap-2 font-medium text-sm ${txResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {txResult.ok ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                  {txResult.ok ? 'Transaction submitted' : 'Transaction failed'}
                </div>
                {txResult.hash && <div className="font-mono text-xs text-slate-400 break-all">{txResult.hash}</div>}
                <div className="text-xs text-slate-500">{txResult.msg}</div>
                <button onClick={() => setTxResult(null)} className="text-xs text-brand-400 hover:text-brand-300 transition-colors">Dismiss</button>
              </div>
            )}

            {/* ── Error ── */}
            {error && (
              <div className="card p-4 border border-red-500/20">
                <div className="text-sm text-red-400">{error}</div>
                <button onClick={() => setError(null)} className="text-xs text-slate-500 hover:text-slate-300 mt-2 transition-colors">Dismiss</button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
