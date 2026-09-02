'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import ProductShell from '@/components/ProductShell'
import NetworkBanner from '@/components/NetworkBanner'
import { useNetwork } from '@/components/NetworkProvider'
import { withNetworkQuery } from '@/lib/network-query'
import {
  isPasskeySupported,
  authenticatePasskey,
} from '@/lib/passkey'
import { decryptSeed } from '@/lib/wallet-crypto'
import { loadPrimaryWallet, type StoredWallet } from '@/lib/wallet-store'
import { signTrustSet } from '@/lib/wallet-sign-client'
import { submitWithSequenceRetry, fetchSequenceInfo } from '@/lib/wallet-submit'
import MarketLiquidityPanel from '@/components/MarketLiquidityPanel'
import PoolStatsPanel from '@/components/PoolStatsPanel'

/** Canonical pool tab order (must stay client-safe — no node:fs). */
const POOL_PAIR_ORDER = ['F-USDC', 'FETH', 'FBNB', 'FBTC'] as const

interface PairToken {
  symbol: string
  displaySymbol: string
  currency: string
  issuer: string
  kind?: 'iou' | 'mpt'
  mptIssuanceId?: string
  decimals?: number
}

interface SwapData {
  token: {
    symbol: string
    currency: string
    issuer: string
    configured: boolean
    kind?: 'iou' | 'mpt'
    mptIssuanceId?: string
    decimals?: number
  }
  market: {
    type: 'amm' | 'dex'
    price: number
    xrpPool: number
    tokenPool: number
    tradingFee: number
  } | null
  userBalance: { balance: number; limit: number } | null
  poolHint?: string
}

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

/** IOU balances (esp. FBTC) need more than 2dp — 0.002 must not round to 0. */
function fmtTokenBal(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const decimals = abs === 0 ? 2 : abs < 0.01 ? 8 : abs < 1 ? 6 : 4
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals })
}

function mapConfigToken(t: {
  symbol: string
  currency: string
  issuer: string
  kind?: 'iou' | 'mpt'
  mptIssuanceId?: string
  decimals?: number
}): PairToken {
  const sym = t.symbol
  const displaySymbol =
    sym.startsWith('F-') || /^F[A-Z]{2,}$/.test(sym) ? sym : `F-${sym}`
  return {
    symbol: t.symbol,
    displaySymbol,
    currency: t.currency,
    issuer: t.issuer,
    kind: t.kind,
    mptIssuanceId: t.mptIssuanceId,
    decimals: t.decimals,
  }
}

export default function PoolPage() {
  const { networkKey, network } = useNetwork()
  const [wallet, setWallet] = useState<StoredWallet | null>(null)
  const [xrpBalance, setXrpBalance] = useState<number | null>(null)
  const [pairs, setPairs] = useState<PairToken[]>([])
  const [selectedSymbol, setSelectedSymbol] = useState<string>('F-USDC')
  const [swapData, setSwapData] = useState<SwapData | null>(null)
  const [poolLive, setPoolLive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected =
    pairs.find(
      (p) =>
        p.symbol.toUpperCase() === selectedSymbol.toUpperCase() ||
        p.displaySymbol.toUpperCase() === selectedSymbol.toUpperCase(),
    ) ?? pairs[0] ?? null

  // Load pair list: stables + live SPV FBTC MPT (preferred over legacy IOU FBTC)
  useEffect(() => {
    Promise.all([
      fetch('/config/testnet-stables.json').then((r) => r.json()),
      fetch(withNetworkQuery('/api/swap?symbol=FBTC', networkKey)).then((r) => r.json()),
    ])
      .then(
        ([m, fbtc]: [
          { tokens?: Array<{ symbol: string; currency: string; issuer: string }> },
          {
            token?: {
              symbol?: string
              currency?: string
              issuer?: string
              kind?: 'iou' | 'mpt'
              mptIssuanceId?: string
              decimals?: number
              configured?: boolean
            }
          },
        ]) => {
          const list = (m.tokens ?? [])
            .filter((t) => t.issuer && t.currency)
            .map(mapConfigToken)
          // Prefer live SPV MPT for FBTC tab
          if (fbtc?.token?.mptIssuanceId || fbtc?.token?.configured) {
            const spv: PairToken = {
              symbol: 'FBTC',
              displaySymbol: 'FBTC',
              currency: fbtc.token.currency || 'BTC',
              issuer: fbtc.token.issuer || '',
              kind: fbtc.token.kind || (fbtc.token.mptIssuanceId ? 'mpt' : 'iou'),
              mptIssuanceId: fbtc.token.mptIssuanceId,
              decimals: fbtc.token.decimals ?? 8,
            }
            const withoutLegacy = list.filter(
              (t) => !(t.symbol === 'FBTC' || t.currency === 'BTC'),
            )
            withoutLegacy.push(spv)
            const ordered: PairToken[] = []
            for (const sym of POOL_PAIR_ORDER) {
              const hit = withoutLegacy.find(
                (t) =>
                  t.symbol.toUpperCase() === sym || t.displaySymbol.toUpperCase() === sym,
              )
              if (hit) ordered.push(hit)
            }
            for (const t of withoutLegacy) {
              if (
                !ordered.some(
                  (o) =>
                    (o.mptIssuanceId && o.mptIssuanceId === t.mptIssuanceId) ||
                    (o.currency === t.currency && o.issuer === t.issuer),
                )
              ) {
                ordered.push(t)
              }
            }
            setPairs(ordered)
            if (
              ordered[0] &&
              !ordered.some(
                (p) => p.displaySymbol === selectedSymbol || p.symbol === selectedSymbol,
              )
            ) {
              setSelectedSymbol(ordered[0].displaySymbol)
            }
            return
          }
          const ordered: PairToken[] = []
          for (const sym of POOL_PAIR_ORDER) {
            const hit = list.find(
              (t) =>
                t.symbol.toUpperCase() === sym || t.displaySymbol.toUpperCase() === sym,
            )
            if (hit) ordered.push(hit)
          }
          setPairs(ordered)
        },
      )
      .catch(() => setPairs([]))
  }, [selectedSymbol, networkKey])

  const refresh = useCallback(
    async (address: string, pair: PairToken | null) => {
      // SPV FBTC is MPT (issuer may be empty); IOUs need issuer
      if (!pair || (!pair.issuer && !pair.mptIssuanceId && pair.kind !== 'mpt')) {
        setSwapData(null)
        setPoolLive(false)
        return
      }
      const pairQ = `symbol=${encodeURIComponent(pair.displaySymbol)}`
      const [accR, swapR, bookR] = await Promise.all([
        fetch(
          withNetworkQuery(`/api/wallet/account?address=${encodeURIComponent(address)}`, networkKey),
        ).then((r) => r.json()),
        fetch(
          withNetworkQuery(
            `/api/swap?address=${encodeURIComponent(address)}&${pairQ}`,
            networkKey,
          ),
        ).then((r) => r.json()),
        fetch(withNetworkQuery(`/api/market/orderbook?${pairQ}`, networkKey)).then((r) =>
          r.json(),
        ),
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
      if (!bookR.error) setPoolLive(!!bookR.ammEnabled)
      else setPoolLive(false)
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
      void refresh(wallet.address, selected)
    }
  }, [
    selected?.currency,
    selected?.issuer,
    selected?.mptIssuanceId,
    selected?.kind,
    wallet,
    refresh,
    selected,
  ])

  const isMptPair =
    selected?.kind === 'mpt' ||
    !!selected?.mptIssuanceId ||
    swapData?.token?.kind === 'mpt' ||
    !!swapData?.token?.mptIssuanceId

  const handleTrustLine = async () => {
    // SPV FBTC is MPT — no TrustSet; claim/authorize is on bridge
    if (isMptPair) {
      setError('SPV FBTC uses MPToken — no trust line. Bridge BTC → FBTC in Wallet first.')
      return
    }
    if (!wallet || !swapData?.token.issuer || !network.live) return
    setBusy(true)
    setError(null)
    try {
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)
      const data = await submitWithSequenceRetry({
        networkKey,
        fetchSequence: async () => {
          const a = await fetchSequenceInfo(wallet.address, networkKey)
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
      })
      if (data.success) setTimeout(() => refresh(wallet.address, selected), 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const tokenLabel = selected?.displaySymbol ?? swapData?.token.symbol ?? 'token'

  return (
    <ProductShell intensity={0.4}>
      <Header current="pool" />
      <NetworkBanner />

      <main className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full space-y-5">
        {/* Pair tabs */}
        {pairs.length > 0 && (
          <div className="flex rounded-xl overflow-hidden border border-slate-700 bg-slate-900/60">
            {pairs.map((p) => {
              const active =
                selected?.displaySymbol === p.displaySymbol ||
                (selected?.mptIssuanceId &&
                  selected.mptIssuanceId === p.mptIssuanceId) ||
                (selected?.currency === p.currency &&
                  selected?.issuer === p.issuer &&
                  !p.mptIssuanceId)
              return (
                <button
                  key={
                    p.mptIssuanceId
                      ? `mpt:${p.mptIssuanceId}`
                      : `${p.currency}:${p.issuer}`
                  }
                  type="button"
                  onClick={() => setSelectedSymbol(p.displaySymbol)}
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
            Pair: <span className="text-slate-300 font-medium">FPL / {selected.displaySymbol}</span>
          </p>
        )}

        {loading && (
          <div className="flex items-center justify-center py-24 text-slate-500 gap-3">
            <Spinner className="w-5 h-5" /><span>Loading…</span>
          </div>
        )}

        {!loading && !wallet && (
          <div className="card p-8 text-center space-y-3">
            <div className="text-slate-400">Connect a Falcon wallet to manage liquidity</div>
            <Link href="/wallet" className="btn-primary inline-block px-6 py-2.5 rounded-xl text-sm font-semibold">
              Create Wallet →
            </Link>
          </div>
        )}

        {!loading && wallet && selected && (
          <>
            <PoolStatsPanel
              viewerAddress={wallet.address}
              symbol={selected.displaySymbol}
              currency={selected.currency}
              issuer={selected.issuer}
            />

            <div className="card p-4 space-y-3">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Your wallet</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-800/60 rounded-xl p-3 text-center">
                  <div className="text-xs text-slate-500 mb-1">FPL</div>
                  <div className="text-lg font-bold text-white">
                    {xrpBalance !== null ? fmt(xrpBalance, 2) : '—'}
                  </div>
                </div>
                <div className="bg-slate-800/60 rounded-xl p-3 text-center">
                  <div className="text-xs text-slate-500 mb-1">{tokenLabel}</div>
                  {swapData?.userBalance ? (
                    <div className="text-lg font-bold text-white">
                      {fmtTokenBal(swapData.userBalance.balance)}
                    </div>
                  ) : isMptPair ? (
                    <div className="text-lg font-bold text-white">0</div>
                  ) : (
                    <div className="text-sm text-slate-500 mt-1">No trust line</div>
                  )}
                </div>
              </div>

              {swapData?.token.configured && !swapData.userBalance && !isMptPair && (
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-400">Add a {tokenLabel} trust line to deposit</span>
                  <button
                    onClick={handleTrustLine}
                    disabled={busy || !isPasskeySupported()}
                    className="text-xs px-3 py-1.5 rounded-lg bg-brand-500/10 text-brand-400 border border-brand-500/20 disabled:opacity-40"
                  >
                    {busy ? <Spinner className="w-3 h-3" /> : 'Add Trust Line'}
                  </button>
                </div>
              )}

              {isMptPair && (
                <p className="text-xs text-slate-500">
                  SPV FBTC is an MPToken (no trust line). Bridge BTC → FBTC in Wallet, then deposit.
                </p>
              )}

              <div className="flex flex-wrap gap-3 text-xs">
                <Link href="/swap" className="text-brand-400 hover:text-brand-300">
                  Swap {tokenLabel} →
                </Link>
                <Link href="/wallet?bridge=1" className="text-emerald-400 hover:text-emerald-300">
                  Bridge → {tokenLabel} →
                </Link>
              </div>
            </div>

            {!swapData?.token.configured && (
              <div className="card p-4 text-sm text-amber-400">
                {isMptPair
                  ? 'SPV FBTC MPT issuance not found — is the BTC bridge active on this network?'
                  : `${tokenLabel} issuer not configured for this network.`}
              </div>
            )}

            {swapData?.poolHint && !poolLive && (
              <div className="card p-4 text-sm text-amber-300/90 border border-amber-500/20">
                {swapData.poolHint}
              </div>
            )}

            {swapData?.token && (
              <MarketLiquidityPanel
                key={
                  swapData.token.mptIssuanceId
                    ? `mpt:${swapData.token.mptIssuanceId}`
                    : `${swapData.token.currency}:${swapData.token.issuer}`
                }
                wallet={wallet}
                token={{
                  ...swapData.token,
                  symbol: swapData.token.symbol || tokenLabel,
                  kind: swapData.token.kind || (swapData.token.mptIssuanceId ? 'mpt' : 'iou'),
                  mptIssuanceId: swapData.token.mptIssuanceId || selected?.mptIssuanceId,
                  decimals: swapData.token.decimals ?? selected?.decimals,
                }}
                xrpBalance={xrpBalance}
                usdcBalance={swapData.userBalance?.balance ?? null}
                poolLive={poolLive}
                poolPrice={swapData.market?.price ?? null}
                onRefresh={() => refresh(wallet.address, selected)}
              />
            )}

            {error && (
              <div className="card p-4 border border-red-500/20 text-sm text-red-400">
                {error}
                <button type="button" onClick={() => setError(null)} className="block text-xs text-slate-500 mt-2">Dismiss</button>
              </div>
            )}
          </>
        )}
      </main>
    </ProductShell>
  )
}
