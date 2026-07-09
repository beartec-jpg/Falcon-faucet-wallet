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
import { signTrustSet } from '@/lib/wallet-sign-client'
import { submitWithSequenceRetry, fetchSequenceInfo } from '@/lib/wallet-submit'
import MarketLiquidityPanel from '@/components/MarketLiquidityPanel'
import PoolStatsPanel from '@/components/PoolStatsPanel'

interface SwapData {
  token: { symbol: string; currency: string; issuer: string; configured: boolean }
  market: {
    type: 'amm' | 'dex'
    price: number
    xrpPool: number
    tokenPool: number
    tradingFee: number
  } | null
  userBalance: { balance: number; limit: number } | null
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

export default function PoolPage() {
  const { networkKey, network } = useNetwork()
  const [wallet, setWallet] = useState<StoredWallet | null>(null)
  const [xrpBalance, setXrpBalance] = useState<number | null>(null)
  const [swapData, setSwapData] = useState<SwapData | null>(null)
  const [poolLive, setPoolLive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (address: string) => {
    const [accR, swapR, bookR] = await Promise.all([
      fetch(withNetworkQuery(`/api/wallet/account?address=${encodeURIComponent(address)}`, networkKey)).then((r) => r.json()),
      fetch(withNetworkQuery(`/api/swap?address=${encodeURIComponent(address)}`, networkKey)).then((r) => r.json()),
      fetch(withNetworkQuery('/api/market/orderbook', networkKey)).then((r) => r.json()),
    ])
    if (accR.exists) setXrpBalance(accR.balance)
    if (swapR.token) setSwapData(swapR)
    if (!bookR.error) setPoolLive(!!bookR.ammEnabled)
  }, [networkKey])

  useEffect(() => {
    loadPrimaryWallet()
      .then((primary) => {
        if (primary) {
          setWallet(primary)
          return refresh(primary.address).finally(() => setLoading(false))
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [refresh])

  const handleTrustLine = async () => {
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
      if (data.success) setTimeout(() => refresh(wallet.address), 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header current="pool" />
      <NetworkBanner />

      <main className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full space-y-5">
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

        {!loading && wallet && (
          <>
            <PoolStatsPanel viewerAddress={wallet.address} />

            <div className="card p-4 space-y-3">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Your wallet</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-800/60 rounded-xl p-3 text-center">
                  <div className="text-xs text-slate-500 mb-1">FALCON</div>
                  <div className="text-lg font-bold text-white">
                    {xrpBalance !== null ? fmt(xrpBalance, 2) : '—'}
                  </div>
                </div>
                <div className="bg-slate-800/60 rounded-xl p-3 text-center">
                  <div className="text-xs text-slate-500 mb-1">F-USDC</div>
                  {swapData?.userBalance ? (
                    <div className="text-lg font-bold text-white">{fmt(swapData.userBalance.balance, 2)}</div>
                  ) : (
                    <div className="text-sm text-slate-500 mt-1">No trust line</div>
                  )}
                </div>
              </div>

              {swapData?.token.configured && !swapData.userBalance && (
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-400">Add a F-USDC trust line to deposit</span>
                  <button
                    onClick={handleTrustLine}
                    disabled={busy || !isPasskeySupported()}
                    className="text-xs px-3 py-1.5 rounded-lg bg-brand-500/10 text-brand-400 border border-brand-500/20 disabled:opacity-40"
                  >
                    {busy ? <Spinner className="w-3 h-3" /> : 'Add Trust Line'}
                  </button>
                </div>
              )}

              <div className="flex flex-wrap gap-3 text-xs">
                <Link href="/swap" className="text-brand-400 hover:text-brand-300">
                  Swap F-USDC →
                </Link>
                <Link href="/wallet?bridge=1" className="text-emerald-400 hover:text-emerald-300">
                  Bridge Sepolia USDC → F-USDC →
                </Link>
              </div>
            </div>

            {!swapData?.token.configured && (
              <div className="card p-4 text-sm text-amber-400">
                F-USDC issuer not configured. Run issue-testnet-stables.py on the coordinator.
              </div>
            )}

            {swapData?.token && (
              <MarketLiquidityPanel
                wallet={wallet}
                token={swapData.token}
                xrpBalance={xrpBalance}
                usdcBalance={swapData.userBalance?.balance ?? null}
                poolLive={poolLive}
                poolPrice={swapData.market?.price ?? null}
                onRefresh={() => refresh(wallet.address)}
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
    </div>
  )
}