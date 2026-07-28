'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import NetworkBanner from '@/components/NetworkBanner'
import { useNetwork } from '@/components/NetworkProvider'
import { withNetworkQuery } from '@/lib/network-query'
import {
  isPasskeySupported,
  authenticatePasskey,
} from '@/lib/passkey'
import { decryptSeed } from '@/lib/wallet-crypto'
import { loadPrimaryWallet, type StoredWallet } from '@/lib/wallet-store'
import {
  signTrustSet,
  signPaymentSwap,
  type IouAmount,
} from '@/lib/wallet-sign-client'
import { submitWithSequenceRetry, fetchSequenceInfo, type SubmitResult } from '@/lib/wallet-submit'
import DexOrdersPanel from '@/components/DexOrdersPanel'
import OrderBookPanel from '@/components/OrderBookPanel'

const DROPS_PER_XRP = 1_000_000

/** Canonical pair tab order (must stay client-safe — no node:fs). */
const SWAP_PAIR_ORDER = ['F-USDC', 'FETH', 'FBNB', 'FBTC'] as const

interface PairToken {
  symbol: string
  displaySymbol: string
  currency: string
  issuer: string
}

interface SwapMarket {
  type: 'amm' | 'dex'
  price: number
  xrpPool: number
  tokenPool: number
  tradingFee: number
}

interface SwapData {
  token: { symbol: string; currency: string; issuer: string; configured: boolean }
  market: SwapMarket | null
  userBalance: { balance: number; limit: number } | null
}

interface SwapQuote {
  source: 'amm' | 'dex'
  price: number
  inputAmount: number
  outputAmount: number
  minOutputAmount?: number
  tradingFeeBps: number
}

type TradeMode = 'instant' | 'limit'

const TRADE_MODE_KEY = 'falcon-swap-trade-mode'

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin-slow ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function fmt(n: number, decimals = 4): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals })
}

function mapConfigToken(t: { symbol: string; currency: string; issuer: string }): PairToken {
  const sym = t.symbol
  const displaySymbol =
    sym.startsWith('F-') || /^F[A-Z]{2,}$/.test(sym) ? sym : `F-${sym}`
  return { symbol: t.symbol, displaySymbol, currency: t.currency, issuer: t.issuer }
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="text-xs px-2 py-1 rounded-md bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors shrink-0"
    >
      {copied ? 'Copied' : label ?? 'Copy'}
    </button>
  )
}

export default function SwapPage() {
  const { networkKey, network } = useNetwork()
  const [tradeMode, setTradeMode] = useState<TradeMode>('instant')
  const [wallet, setWallet] = useState<StoredWallet | null>(null)
  const [xrpBalance, setXrpBalance] = useState<number | null>(null)
  const [pairs, setPairs] = useState<PairToken[]>([])
  const [selectedSymbol, setSelectedSymbol] = useState<string>('F-USDC')
  const [swapData, setSwapData] = useState<SwapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [txResult, setTxResult] = useState<{ ok: boolean; msg: string; hash?: string } | null>(null)

  const [swapDir, setSwapDir] = useState<'sell_falcon' | 'buy_falcon'>('buy_falcon')
  const [swapAmt, setSwapAmt] = useState('')
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [bookTick, setBookTick] = useState(0)
  const [openOrderCount, setOpenOrderCount] = useState(0)

  const selected =
    pairs.find(
      (p) =>
        p.symbol.toUpperCase() === selectedSymbol.toUpperCase() ||
        p.displaySymbol.toUpperCase() === selectedSymbol.toUpperCase(),
    ) ?? pairs[0] ?? null

  const tokenLabel = selected?.displaySymbol ?? swapData?.token.symbol ?? 'token'
  const pairQ = selected
    ? `symbol=${encodeURIComponent(selected.displaySymbol)}`
    : ''

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(TRADE_MODE_KEY)
      if (saved === 'instant' || saved === 'limit') setTradeMode(saved)
    } catch { /* ignore */ }
  }, [])

  // Load pair list from config (order matches SWAP_PAIR_ORDER)
  useEffect(() => {
    fetch('/config/testnet-stables.json')
      .then((r) => r.json())
      .then((m: { tokens?: Array<{ symbol: string; currency: string; issuer: string }> }) => {
        const list = (m.tokens ?? [])
          .filter((t) => t.issuer && t.currency)
          .map(mapConfigToken)
        const ordered: PairToken[] = []
        for (const sym of SWAP_PAIR_ORDER) {
          const hit = list.find(
            (t) =>
              t.symbol.toUpperCase() === sym ||
              t.displaySymbol.toUpperCase() === sym,
          )
          if (hit) ordered.push(hit)
        }
        for (const t of list) {
          if (!ordered.some((o) => o.currency === t.currency && o.issuer === t.issuer)) {
            ordered.push(t)
          }
        }
        setPairs(ordered)
        if (ordered[0] && !ordered.some((p) => p.displaySymbol === selectedSymbol || p.symbol === selectedSymbol)) {
          setSelectedSymbol(ordered[0].displaySymbol)
        }
      })
      .catch(() => setPairs([]))
  }, [selectedSymbol])

  const setTradeModePersisted = (mode: TradeMode) => {
    setTradeMode(mode)
    try {
      sessionStorage.setItem(TRADE_MODE_KEY, mode)
    } catch { /* ignore */ }
  }

  const refresh = useCallback(
    async (address: string, pair: PairToken | null) => {
      if (!pair?.issuer) {
        setSwapData(null)
        setOpenOrderCount(0)
        return
      }
      const pq = `symbol=${encodeURIComponent(pair.displaySymbol)}`
      const [accR, swapR] = await Promise.all([
        fetch(
          withNetworkQuery(`/api/wallet/account?address=${encodeURIComponent(address)}`, networkKey),
        ).then((r) => r.json()),
        fetch(
          withNetworkQuery(
            `/api/swap?address=${encodeURIComponent(address)}&${pq}`,
            networkKey,
          ),
        ).then((r) => r.json()),
      ])
      if (accR.exists) setXrpBalance(accR.balance)
      else setXrpBalance(accR.balance ?? 0)

      if (swapR.token) {
        setSwapData({
          ...swapR,
          token: {
            ...swapR.token,
            symbol: swapR.token.symbol || pair.displaySymbol,
          },
        })
      } else {
        setSwapData(null)
      }

      fetch(
        withNetworkQuery(
          `/api/market/offers?address=${encodeURIComponent(address)}&${pq}`,
          networkKey,
        ),
      )
        .then((r) => r.json())
        .then((d) => setOpenOrderCount(Array.isArray(d.offers) ? d.offers.length : 0))
        .catch(() => setOpenOrderCount(0))
    },
    [networkKey],
  )

  useEffect(() => {
    loadPrimaryWallet()
      .then(async (primary) => {
        if (primary) {
          setWallet(primary)
          if (selected) {
            await refresh(primary.address, selected)
          }
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [refresh, selected])

  // Re-fetch when pair tab changes
  useEffect(() => {
    if (wallet && selected) {
      setError(null)
      setQuote(null)
      setSwapAmt('')
      setBookTick((n) => n + 1)
      void refresh(wallet.address, selected)
    }
  }, [selected?.currency, selected?.issuer, wallet, refresh, selected])

  // Live quote (Falcon-paired only)
  useEffect(() => {
    const amt = parseFloat(swapAmt)
    if (!Number.isFinite(amt) || amt <= 0 || !swapData?.market || !pairQ) {
      setQuote(null)
      return
    }
    const t = setTimeout(() => {
      fetch(
        withNetworkQuery(
          `/api/swap?direction=${swapDir}&amount=${amt}&${pairQ}`,
          networkKey,
        ),
      )
        .then((r) => r.json())
        .then((d) => setQuote(d.quote ?? null))
        .catch(() => setQuote(null))
    }, 300)
    return () => clearTimeout(t)
  }, [swapAmt, swapDir, networkKey, swapData?.market, pairQ])

  const handleTrustLine = async () => {
    if (!wallet || !swapData?.token.issuer || !network.live) return
    setBusy(true)
    setError(null)
    setTxResult(null)
    try {
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)
      const data = await submitWithSequenceRetry({
        networkKey,
        fetchSequence: async () => {
          const a = await fetchSequenceInfo(wallet.address, networkKey)
          if (!a.exists) throw new Error('Failed to refresh account')
          return { sequence: a.sequence, currentLedger: a.currentLedger }
        },
        sign: ({ sequence, lastLedgerSequence }) =>
          signTrustSet(
            {
              account: wallet.address,
              currency: swapData.token.currency,
              issuer: swapData.token.issuer,
              limit: '10000000',
              sequence,
              lastLedgerSequence,
              networkId: network.networkId,
            },
            falcon_secret,
          ),
      }).catch((e: unknown): SubmitResult => ({
        success: false,
        message: e instanceof Error ? e.message : 'Failed',
      }))
      setTxResult({ ok: !!data.success, msg: [data.result, data.message].filter(Boolean).join(' — '), hash: data.hash })
      if (data.success) setTimeout(() => refresh(wallet.address, selected), 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const handleSwap = async () => {
    if (!wallet || !swapData?.token.issuer || !swapAmt || !network.live) return
    const amt = parseFloat(swapAmt)
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Invalid amount')
      return
    }
    if (!quote) {
      setError('Quote unavailable — pool may be empty')
      return
    }

    setBusy(true)
    setError(null)
    setTxResult(null)

    try {
      // Re-quote immediately before signing so slippage bounds reflect current
      // pool reserves rather than a stale on-screen quote.
      let freshQuote = quote
      try {
        const qRes = await fetch(
          withNetworkQuery(
            `/api/swap?direction=${swapDir}&amount=${amt}&${pairQ}`,
            networkKey,
          ),
        )
        const qData = await qRes.json().catch(() => ({}))
        if (qRes.ok && qData.quote) {
          freshQuote = qData.quote
          setQuote(qData.quote)
        } else if (qRes.status === 404) {
          setError('No liquidity available — pool may be empty')
          setBusy(false)
          return
        } else if (!qRes.ok) {
          setError(qData.error ?? 'Could not refresh quote — try again')
          setBusy(false)
          return
        }
      } catch {
        // Transient network blip: proceed with last quote, still bounded on-ledger.
      }

      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)

      const outAmt = freshQuote.outputAmount
      const minOut = freshQuote.minOutputAmount ?? outAmt * 0.995
      const token = swapData.token

      let amount: string | IouAmount
      let sendMax: string | IouAmount
      let deliverMin: string | IouAmount | undefined

      if (swapDir === 'sell_falcon') {
        // Sell FALCON → receive F-asset
        sendMax = String(Math.round(amt * DROPS_PER_XRP))
        amount = { currency: token.currency, issuer: token.issuer, value: fmt(outAmt, 8) }
        deliverMin = { currency: token.currency, issuer: token.issuer, value: fmt(minOut, 8) }
      } else {
        // Buy FALCON → pay F-asset
        if (swapData.userBalance && minOut > swapData.userBalance.balance + 1e-9) {
          setError(
            `Need ~${fmt(minOut, 4)} ${tokenLabel} for this buy (have ${fmt(swapData.userBalance.balance, 4)})`,
          )
          setBusy(false)
          return
        }
        sendMax = { currency: token.currency, issuer: token.issuer, value: fmt(minOut, 8) }
        amount = String(Math.round(amt * DROPS_PER_XRP))
        deliverMin = String(Math.round(amt * 0.995 * DROPS_PER_XRP))
      }

      const data = await submitWithSequenceRetry({
        networkKey,
        fetchSequence: async () => {
          const a = await fetchSequenceInfo(wallet.address, networkKey)
          return { sequence: a.sequence, currentLedger: a.currentLedger }
        },
        sign: ({ sequence, lastLedgerSequence }) =>
          signPaymentSwap(
            {
              account: wallet.address,
              destination: wallet.address,
              amount,
              sendMax,
              deliverMin,
              sequence,
              lastLedgerSequence,
              networkId: network.networkId,
            },
            falcon_secret,
          ),
      }).catch((e: unknown): SubmitResult => ({
        success: false,
        message: e instanceof Error ? e.message : 'Swap failed',
      }))
      setTxResult({ ok: !!data.success, msg: [data.result, data.message].filter(Boolean).join(' — '), hash: data.hash })
      setSwapAmt('')
      if (data.success) setTimeout(() => refresh(wallet.address, selected), 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Swap failed')
    } finally {
      setBusy(false)
    }
  }

  const swapAmtNum = parseFloat(swapAmt) || 0
  const limitToken = swapData?.token
    ? {
        symbol: swapData.token.symbol || tokenLabel,
        currency: swapData.token.currency,
        issuer: swapData.token.issuer,
        configured: swapData.token.configured,
      }
    : selected
      ? {
          symbol: selected.displaySymbol,
          currency: selected.currency,
          issuer: selected.issuer,
          configured: true,
        }
      : null

  return (
    <div className="min-h-screen flex flex-col">
      <Header current="swap" />
      <NetworkBanner />

      <main className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full space-y-5">
        {/* Pair tabs — Falcon-paired F-assets only */}
        {pairs.length > 0 && (
          <div className="flex rounded-xl overflow-hidden border border-slate-700 bg-slate-900/60">
            {pairs.map((p) => {
              const active =
                selected?.currency === p.currency && selected?.issuer === p.issuer
              return (
                <button
                  key={`${p.currency}:${p.issuer}`}
                  type="button"
                  onClick={() => {
                    setSelectedSymbol(p.displaySymbol)
                    setQuote(null)
                    setSwapAmt('')
                    setError(null)
                  }}
                  className={`flex-1 py-2.5 px-1 text-xs sm:text-sm font-semibold transition-colors ${
                    active
                      ? 'bg-brand-500/20 text-brand-300 border-b-2 border-brand-400'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {p.displaySymbol}
                </button>
              )
            })}
          </div>
        )}

        {selected && (
          <p className="text-center text-xs text-slate-500 -mt-2">
            Pair: <span className="text-slate-300 font-medium">FALCON / {selected.displaySymbol}</span>
          </p>
        )}

        {loading && (
          <div className="flex items-center justify-center py-24 text-slate-500 gap-3">
            <Spinner className="w-5 h-5" /><span>Loading…</span>
          </div>
        )}

        {!loading && !wallet && (
          <div className="card p-8 text-center space-y-3">
            <div className="text-slate-400">Create a Falcon wallet first</div>
            <Link href="/wallet" className="btn-primary inline-block px-6 py-2.5 rounded-xl text-sm font-semibold">
              Create Wallet →
            </Link>
          </div>
        )}

        {!loading && wallet && (
          <>
            <div className="card p-5">
              <div className="text-xs text-slate-500 mb-1">Your Falcon address</div>
              <div className="flex items-center gap-2 mb-4">
                <div className="font-mono text-sm text-slate-300 break-all flex-1">{wallet.address}</div>
                <CopyButton text={wallet.address} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-800/60 rounded-xl p-3 text-center">
                  <div className="text-xs text-slate-500 mb-1">FALCON</div>
                  <div className="text-lg font-bold text-white">
                    {xrpBalance !== null ? fmt(xrpBalance, 2) : '—'}
                  </div>
                </div>
                <div className="bg-slate-800/60 rounded-xl p-3 text-center">
                  <div className="text-xs text-slate-500 mb-1">{tokenLabel}</div>
                  {swapData?.userBalance ? (
                    <div className="text-lg font-bold text-white">{fmt(swapData.userBalance.balance, 2)}</div>
                  ) : (
                    <div className="text-sm text-slate-500 mt-1">No trust line</div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex rounded-xl overflow-hidden border border-slate-700 text-sm">
                <button
                  type="button"
                  onClick={() => setTradeModePersisted('instant')}
                  className={`flex-1 py-2 font-medium transition-colors ${
                    tradeMode === 'instant' ? 'bg-brand-500/10 text-brand-400' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Instant Swap
                </button>
                <button
                  type="button"
                  onClick={() => setTradeModePersisted('limit')}
                  className={`flex-1 py-2 font-medium transition-colors relative ${
                    tradeMode === 'limit' ? 'bg-cyan-500/10 text-cyan-400' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Limit Orders
                  {openOrderCount > 0 && tradeMode !== 'limit' && (
                    <span className="absolute top-1 right-2 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-cyan-500 text-[10px] font-bold text-slate-900 leading-none flex items-center justify-center">
                      {openOrderCount}
                    </span>
                  )}
                </button>
              </div>

              {tradeMode === 'instant' && openOrderCount > 0 && (
                <button
                  type="button"
                  onClick={() => setTradeModePersisted('limit')}
                  className="card p-3 w-full text-left text-xs text-cyan-400/90 hover:bg-slate-800/40 transition-colors"
                >
                  You have {openOrderCount} open limit order{openOrderCount === 1 ? '' : 's'} on the book — tap to view
                </button>
              )}

              {!swapData?.token.configured && selected && (
                <div className="card p-4 text-sm text-amber-400">
                  {tokenLabel} issuer not configured. Run issue-testnet-stables.py on the coordinator.
                </div>
              )}

              {swapData?.token.configured && !swapData.userBalance && (
                <div className="card p-4 flex items-center justify-between gap-3">
                  <div className="text-sm text-slate-400">Add a {tokenLabel} trust line to receive tokens</div>
                  <button
                    onClick={handleTrustLine}
                    disabled={busy || !isPasskeySupported()}
                    className="text-xs px-3 py-1.5 rounded-lg bg-brand-500/10 text-brand-400 border border-brand-500/20 disabled:opacity-40"
                  >
                    {busy ? <Spinner className="w-3 h-3" /> : 'Add Trust Line'}
                  </button>
                </div>
              )}

              {tradeMode === 'instant' && swapData?.market && (
                <div className="card p-4">
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                    <span className={`px-1.5 py-0.5 rounded font-mono ${
                      swapData.market.type === 'amm' ? 'bg-purple-500/10 text-purple-400' : 'bg-cyan-500/10 text-cyan-400'
                    }`}>
                      {swapData.market.type === 'amm' ? 'AMM' : 'DEX book'}
                    </span>
                    <span>
                      {fmt(swapData.market.price, 6)} FALCON per {tokenLabel}
                      {swapData.market.price > 0 && (
                        <> ({fmt(1 / swapData.market.price, 4)} {tokenLabel} per FALCON)</>
                      )}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-800/60 rounded-lg px-3 py-2">
                      <div className="text-slate-500">FALCON pool</div>
                      <div className="text-slate-200 font-mono">{fmt(swapData.market.xrpPool, 0)}</div>
                    </div>
                    <div className="bg-slate-800/60 rounded-lg px-3 py-2">
                      <div className="text-slate-500">{tokenLabel} pool</div>
                      <div className="text-slate-200 font-mono">{fmt(swapData.market.tokenPool, 0)}</div>
                    </div>
                  </div>
                </div>
              )}

              {tradeMode === 'instant' && swapData?.market ? (
                <div className="card p-5 space-y-4">
                  <h2 className="text-sm font-semibold text-white">FALCON ↔ {tokenLabel}</h2>
                  <p className="text-xs text-slate-500">
                    Market swap via on-ledger Payment — routes through AMM if a pool exists, otherwise the DEX book.
                    Only Falcon-paired markets are supported.
                  </p>

                  <div className="flex rounded-xl overflow-hidden border border-slate-700 text-sm">
                    <button
                      type="button"
                      onClick={() => { setSwapDir('buy_falcon'); setSwapAmt('') }}
                      className={`flex-1 py-2 font-medium transition-colors ${
                        swapDir === 'buy_falcon' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-500'
                      }`}
                    >
                      Buy FALCON
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSwapDir('sell_falcon'); setSwapAmt('') }}
                      className={`flex-1 py-2 font-medium transition-colors ${
                        swapDir === 'sell_falcon' ? 'bg-red-500/10 text-red-400' : 'text-slate-500'
                      }`}
                    >
                      Sell FALCON
                    </button>
                  </div>

                  <p className="text-[10px] text-slate-500">
                    {swapDir === 'buy_falcon'
                      ? `Enter how much FALCON you want to buy — we show the ${tokenLabel} it costs.`
                      : `Enter how much FALCON you want to sell — we show the ${tokenLabel} you receive.`}
                  </p>

                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400">Amount (FALCON)</label>
                    <input
                      type="number"
                      value={swapAmt}
                      onChange={(e) => { setSwapAmt(e.target.value); setError(null) }}
                      placeholder="0.00"
                      min="0.000001"
                      step="any"
                      className="input-field"
                      disabled={busy}
                    />
                    <div className="flex justify-between text-xs text-slate-600">
                      <span>
                        {swapDir === 'sell_falcon'
                          ? xrpBalance !== null ? `Available: ${fmt(xrpBalance, 4)} FALCON` : ''
                          : swapData.userBalance && swapData.market
                            ? `Can buy ~${fmt(swapData.userBalance.balance * swapData.market.price, 2)} FALCON with ${tokenLabel}`
                            : swapData.userBalance
                              ? `${tokenLabel}: ${fmt(swapData.userBalance.balance, 4)}`
                              : `No ${tokenLabel} trust line`}
                      </span>
                      {swapDir === 'sell_falcon' && xrpBalance != null && xrpBalance > 0.1 && (
                        <button
                          type="button"
                          onClick={() => setSwapAmt(String(Math.max(0, xrpBalance - 0.1).toFixed(6)))}
                          className="text-brand-500"
                        >Max</button>
                      )}
                      {swapDir === 'buy_falcon' && swapData.userBalance && swapData.market && swapData.market.price > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const max = swapData.userBalance!.balance * swapData.market!.price * 0.995
                            setSwapAmt(String(Math.floor(max * 1e6) / 1e6))
                          }}
                          className="text-brand-500"
                        >Max</button>
                      )}
                    </div>
                  </div>

                  {quote && swapAmtNum > 0 && (
                    <div className="bg-slate-800/60 rounded-xl px-4 py-3 text-sm space-y-1.5">
                      <div className="flex justify-between text-slate-400">
                        <span>{swapDir === 'sell_falcon' ? 'You receive ~' : 'You pay ~'}</span>
                        <span className="text-white font-semibold">
                          {fmt(quote.outputAmount, 4)}{' '}
                          <span className="text-brand-500">{tokenLabel}</span>
                        </span>
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>{swapDir === 'sell_falcon' ? 'Sell' : 'Buy'}</span>
                        <span className="font-mono">{fmt(swapAmtNum, 4)} FALCON</span>
                      </div>
                    </div>
                  )}

                  {swapDir === 'buy_falcon' && !swapData.userBalance && (
                    <div className="text-xs text-amber-400 bg-amber-500/10 rounded-xl px-3 py-2">
                      Add a {tokenLabel} trust line before buying FALCON.
                    </div>
                  )}

                  <button
                    onClick={handleSwap}
                    disabled={
                      busy ||
                      !swapAmt ||
                      swapAmtNum <= 0 ||
                      (swapDir === 'buy_falcon' && !swapData.userBalance) ||
                      (swapDir === 'sell_falcon' && xrpBalance != null && swapAmtNum > xrpBalance)
                    }
                    className="btn-primary flex items-center justify-center gap-2"
                  >
                    {busy ? (
                      <><Spinner /> Signing…</>
                    ) : swapDir === 'sell_falcon' ? (
                      'Sell FALCON'
                    ) : (
                      'Buy FALCON'
                    )}
                  </button>
                </div>
              ) : tradeMode === 'instant' && swapData?.token.configured ? (
                <div className="card p-4 text-sm text-slate-500 space-y-2">
                  <p>
                    No liquidity for FALCON/{tokenLabel} instant swaps yet. Bridge in from the Wallet tab,
                    post a limit order, or create the AMM pool.
                  </p>
                  <div className="flex flex-wrap gap-3 text-xs">
                    <Link href="/wallet?bridge=1" className="text-emerald-400">
                      Bridge → {tokenLabel} →
                    </Link>
                    <button type="button" onClick={() => setTradeModePersisted('limit')} className="text-cyan-400">
                      Post limit order →
                    </button>
                    <Link href="/pool" className="text-brand-400">
                      Create AMM pool →
                    </Link>
                  </div>
                </div>
              ) : null}

              {tradeMode === 'limit' && wallet && limitToken && (
                <>
                  {!swapData?.token && (
                    <div className="card p-3 text-xs text-amber-400">
                      Market data still loading — limit orders work; refresh if this persists.
                    </div>
                  )}
                  <DexOrdersPanel
                    key={`${limitToken.currency}:${limitToken.issuer}`}
                    wallet={wallet}
                    token={limitToken}
                    xrpBalance={xrpBalance}
                    usdcBalance={swapData?.userBalance?.balance ?? null}
                    marketPrice={swapData?.market?.price ?? null}
                    onRefresh={() => refresh(wallet.address, selected)}
                    onBookRefresh={() => setBookTick((n) => n + 1)}
                  />
                  <div className="card p-5">
                    <h2 className="text-sm font-semibold text-white mb-4">
                      Order Book — FALCON / {tokenLabel}
                    </h2>
                    <OrderBookPanel
                      compact
                      key={`${bookTick}:${limitToken.currency}:${limitToken.issuer}`}
                      symbol={limitToken.symbol}
                      currency={limitToken.currency}
                      issuer={limitToken.issuer}
                    />
                  </div>
                </>
              )}

              {tradeMode === 'limit' && wallet && !limitToken && (
                <div className="card p-4 text-sm text-amber-400">
                  Token config unavailable — check coordinator stables manifest.
                </div>
              )}
            </div>

            {txResult && (
              <div className={`card p-4 space-y-2 ${txResult.ok ? 'border border-emerald-500/20' : 'border border-red-500/20'}`}>
                <div className={`text-sm font-medium ${txResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {txResult.ok ? 'Submitted' : 'Failed'} — {txResult.msg}
                </div>
                {txResult.hash && <div className="font-mono text-xs text-slate-400 break-all">{txResult.hash}</div>}
                <button onClick={() => setTxResult(null)} className="text-xs text-brand-400">Dismiss</button>
              </div>
            )}

            {error && (
              <div className="card p-4 border border-red-500/20 text-sm text-red-400">
                {error}
                <button onClick={() => setError(null)} className="block text-xs text-slate-500 mt-2">Dismiss</button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
