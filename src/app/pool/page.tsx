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
import { loadWallets, type StoredWallet } from '@/lib/wallet-store'
import { signTrustSet } from '@/lib/wallet-sign-client'
import MarketLiquidityPanel from '@/components/MarketLiquidityPanel'
import OrderBookPanel from '@/components/OrderBookPanel'

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

function CopyButton({ text }: { text: string }) {
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
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export default function PoolPage() {
  const { networkKey, network } = useNetwork()
  const [wallet, setWallet] = useState<StoredWallet | null>(null)
  const [xrpBalance, setXrpBalance] = useState<number | null>(null)
  const [swapData, setSwapData] = useState<SwapData | null>(null)
  const [ammEnabled, setAmmEnabled] = useState(false)
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
    if (!bookR.error) setAmmEnabled(!!bookR.ammEnabled)
  }, [networkKey])

  useEffect(() => {
    loadWallets()
      .then((wallets) => {
        if (wallets.length > 0) {
          setWallet(wallets[0])
          return refresh(wallets[0].address).finally(() => setLoading(false))
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
      const accRes = await fetch(
        withNetworkQuery(`/api/wallet/account?address=${encodeURIComponent(wallet.address)}`, networkKey),
      )
      const accData = await accRes.json()
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)
      const { tx_blob } = await signTrustSet(
        {
          account: wallet.address,
          currency: swapData.token.currency,
          issuer: swapData.token.issuer,
          limit: '10000000',
          sequence: accData.sequence,
          lastLedgerSequence: accData.currentLedger + 20,
          networkId: network.networkId,
        },
        falcon_secret,
      )
      const res = await fetch('/api/wallet/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_blob, network: networkKey }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setTimeout(() => refresh(wallet.address), 4000)
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
            <div className="card p-5 space-y-3">
              <div>
                <h1 className="text-base font-semibold text-white">FALCON / USDC Pool</h1>
                <p className="text-xs text-slate-400 mt-1">
                  Add liquidity to the AMM pool or post limit orders on the DEX. Fees from swaps and fills go to your Falcon wallet.
                </p>
              </div>

              <div className="text-xs text-slate-500">Your Falcon address</div>
              <div className="flex items-center gap-2">
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
                  <div className="text-xs text-slate-500 mb-1">USDC</div>
                  {swapData?.userBalance ? (
                    <div className="text-lg font-bold text-white">{fmt(swapData.userBalance.balance, 2)}</div>
                  ) : (
                    <div className="text-sm text-slate-500 mt-1">No trust line</div>
                  )}
                </div>
              </div>

              {swapData?.market && (
                <div className="bg-slate-800/40 rounded-xl p-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className={`px-1.5 py-0.5 rounded font-mono ${
                      swapData.market.type === 'amm' ? 'bg-purple-500/10 text-purple-400' : 'bg-cyan-500/10 text-cyan-400'
                    }`}>
                      {swapData.market.type === 'amm' ? 'AMM' : 'DEX'}
                    </span>
                    <div className="text-slate-500 mt-2">Price</div>
                    <div className="font-mono text-slate-200">{fmt(swapData.market.price, 6)} FALCON/USDC</div>
                  </div>
                  <div className="text-right">
                    <div className="text-slate-500">Pool depth</div>
                    <div className="font-mono text-slate-200">{fmt(swapData.market.xrpPool, 0)} FALCON</div>
                    <div className="font-mono text-slate-400">{fmt(swapData.market.tokenPool, 0)} USDC</div>
                    {swapData.market.tradingFee > 0 && (
                      <div className="text-slate-500 mt-1">Fee {(swapData.market.tradingFee / 1000).toFixed(2)}%</div>
                    )}
                  </div>
                </div>
              )}

              {swapData?.token.configured && !swapData.userBalance && (
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-400">Add a USDC trust line to deposit</span>
                  <button
                    onClick={handleTrustLine}
                    disabled={busy || !isPasskeySupported()}
                    className="text-xs px-3 py-1.5 rounded-lg bg-brand-500/10 text-brand-400 border border-brand-500/20 disabled:opacity-40"
                  >
                    {busy ? <Spinner className="w-3 h-3" /> : 'Add Trust Line'}
                  </button>
                </div>
              )}

              <Link href="/swap" className="text-xs text-brand-400 hover:text-brand-300 inline-block">
                Need to swap? Go to Swap →
              </Link>
            </div>

            {swapData?.token && (
              <MarketLiquidityPanel
                wallet={wallet}
                token={swapData.token}
                xrpBalance={xrpBalance}
                usdcBalance={swapData.userBalance?.balance ?? null}
                ammEnabled={ammEnabled}
                onRefresh={() => refresh(wallet.address)}
              />
            )}

            <div className="card p-5">
              <h2 className="text-sm font-semibold text-white mb-4">Order Book</h2>
              <OrderBookPanel compact />
            </div>

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