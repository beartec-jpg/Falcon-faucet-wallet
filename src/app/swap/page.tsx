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
import {
  signTrustSet,
  signPaymentSwap,
  type IouAmount,
} from '@/lib/wallet-sign-client'
import { type UsdcBridgeManifest } from '@/lib/bridge-config'
import BridgeDepositPanel from '@/components/BridgeDepositPanel'

const DROPS_PER_XRP = 1_000_000

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

type Tab = 'swap' | 'bridge'

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
  const [tab, setTab] = useState<Tab>('swap')
  const [wallet, setWallet] = useState<StoredWallet | null>(null)
  const [xrpBalance, setXrpBalance] = useState<number | null>(null)
  const [sequence, setSequence] = useState(0)
  const [ledger, setLedger] = useState(0)
  const [swapData, setSwapData] = useState<SwapData | null>(null)
  const [bridgeCfg, setBridgeCfg] = useState<(UsdcBridgeManifest & { lock_contract_ready?: boolean }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [txResult, setTxResult] = useState<{ ok: boolean; msg: string; hash?: string } | null>(null)

  const [swapDir, setSwapDir] = useState<'buy' | 'sell'>('buy')
  const [swapAmt, setSwapAmt] = useState('')
  const [quote, setQuote] = useState<SwapQuote | null>(null)

  const refresh = useCallback(async (address: string) => {
    const [accR, swapR, bridgeR] = await Promise.all([
      fetch(withNetworkQuery(`/api/wallet/account?address=${encodeURIComponent(address)}`, networkKey)).then((r) => r.json()),
      fetch(withNetworkQuery(`/api/swap?address=${encodeURIComponent(address)}`, networkKey)).then((r) => r.json()),
      fetch('/api/bridge/config').then((r) => r.json()),
    ])
    if (accR.exists) {
      setXrpBalance(accR.balance)
      setSequence(accR.sequence)
      setLedger(accR.currentLedger)
    }
    if (swapR.token) setSwapData(swapR)
    if (!bridgeR.error) setBridgeCfg(bridgeR)
  }, [networkKey])

  useEffect(() => {
    if (wallet?.address) refresh(wallet.address)
  }, [networkKey, wallet?.address, refresh])

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

  // Live quote
  useEffect(() => {
    const amt = parseFloat(swapAmt)
    if (!Number.isFinite(amt) || amt <= 0 || !swapData?.market) {
      setQuote(null)
      return
    }
    const t = setTimeout(() => {
      fetch(
        withNetworkQuery(
          `/api/swap?direction=${swapDir}&amount=${amt}`,
          networkKey,
        ),
      )
        .then((r) => r.json())
        .then((d) => setQuote(d.quote ?? null))
        .catch(() => setQuote(null))
    }, 300)
    return () => clearTimeout(t)
  }, [swapAmt, swapDir, networkKey, swapData?.market])

  const handleTrustLine = async () => {
    if (!wallet || !swapData?.token.issuer || !network.live) return
    setBusy(true)
    setError(null)
    setTxResult(null)
    try {
      const accRes = await fetch(
        withNetworkQuery(`/api/wallet/account?address=${encodeURIComponent(wallet.address)}`, networkKey),
      )
      const accData = await accRes.json()
      if (!accRes.ok || !accData.exists) throw new Error('Failed to refresh account')

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
      setTxResult({ ok: !!data.success, msg: [data.result, data.message].filter(Boolean).join(' — '), hash: data.hash })
      if (data.success) setTimeout(() => refresh(wallet.address), 4000)
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
      const accRes = await fetch(
        withNetworkQuery(`/api/wallet/account?address=${encodeURIComponent(wallet.address)}`, networkKey),
      )
      const accData = await accRes.json()

      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)

      const outAmt = quote.outputAmount
      const minOut = quote.minOutputAmount ?? outAmt * 0.995
      const token = swapData.token

      let amount: string | IouAmount
      let sendMax: string | IouAmount
      let deliverMin: string | IouAmount | undefined

      if (swapDir === 'buy') {
        sendMax = String(Math.round(amt * DROPS_PER_XRP))
        amount = { currency: token.currency, issuer: token.issuer, value: fmt(outAmt, 8) }
        deliverMin = { currency: token.currency, issuer: token.issuer, value: fmt(minOut, 8) }
      } else {
        sendMax = { currency: token.currency, issuer: token.issuer, value: fmt(amt, 8) }
        amount = String(Math.round(outAmt * DROPS_PER_XRP))
        deliverMin = String(Math.round(minOut * DROPS_PER_XRP))
      }

      const { tx_blob } = await signPaymentSwap(
        {
          account: wallet.address,
          destination: wallet.address,
          amount,
          sendMax,
          deliverMin,
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
      setTxResult({ ok: !!data.success, msg: [data.result, data.message].filter(Boolean).join(' — '), hash: data.hash })
      setSwapAmt('')
      if (data.success) setTimeout(() => refresh(wallet.address), 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Swap failed')
    } finally {
      setBusy(false)
    }
  }

  const swapAmtNum = parseFloat(swapAmt) || 0

  return (
    <div className="min-h-screen flex flex-col">
      <Header current="swap" />
      <NetworkBanner />

      <main className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full space-y-5">
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
            {/* Tab switcher */}
            <div className="flex rounded-xl overflow-hidden border border-slate-700 text-sm">
              <button
                type="button"
                onClick={() => setTab('swap')}
                className={`flex-1 py-2.5 font-medium transition-colors ${
                  tab === 'swap' ? 'bg-brand-500/10 text-brand-400' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Swap on Falcon
              </button>
              <button
                type="button"
                onClick={() => setTab('bridge')}
                className={`flex-1 py-2.5 font-medium transition-colors ${
                  tab === 'bridge' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Bridge
              </button>
            </div>

            {/* Balances */}
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
                  <div className="text-xs text-slate-500 mb-1">F-USDC</div>
                  {swapData?.userBalance ? (
                    <div className="text-lg font-bold text-white">{fmt(swapData.userBalance.balance, 2)}</div>
                  ) : (
                    <div className="text-sm text-slate-500 mt-1">No trust line</div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Bridge (in-app passkey EVM wallet) ── */}
            {tab === 'bridge' && bridgeCfg && (
              <BridgeDepositPanel
                wallet={wallet}
                bridgeCfg={bridgeCfg}
                fusdcBalance={swapData?.userBalance?.balance ?? null}
                onWalletUpdate={setWallet}
                onFalconRefresh={() => wallet && refresh(wallet.address)}
              />
            )}

            {/* ── On-ledger swap ── */}
            {tab === 'swap' && (
              <div className="space-y-4">
                {!swapData?.token.configured && (
                  <div className="card p-4 text-sm text-amber-400">
                    USDC issuer not configured. Run issue-testnet-stables.py on the coordinator.
                  </div>
                )}

                {swapData?.token.configured && !swapData.userBalance && (
                  <div className="card p-4 flex items-center justify-between gap-3">
                    <div className="text-sm text-slate-400">Add a USDC trust line to receive tokens</div>
                    <button
                      onClick={handleTrustLine}
                      disabled={busy || !isPasskeySupported()}
                      className="text-xs px-3 py-1.5 rounded-lg bg-brand-500/10 text-brand-400 border border-brand-500/20 disabled:opacity-40"
                    >
                      {busy ? <Spinner className="w-3 h-3" /> : 'Add Trust Line'}
                    </button>
                  </div>
                )}

                {swapData?.market && (
                  <div className="card p-4">
                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                      <span className={`px-1.5 py-0.5 rounded font-mono ${
                        swapData.market.type === 'amm' ? 'bg-purple-500/10 text-purple-400' : 'bg-cyan-500/10 text-cyan-400'
                      }`}>
                        {swapData.market.type === 'amm' ? 'AMM' : 'DEX'}
                      </span>
                      <span>{fmt(swapData.market.price, 6)} FALCON per F-USDC</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-slate-800/60 rounded-lg px-3 py-2">
                        <div className="text-slate-500">FALCON pool</div>
                        <div className="text-slate-200 font-mono">{fmt(swapData.market.xrpPool, 0)}</div>
                      </div>
                      <div className="bg-slate-800/60 rounded-lg px-3 py-2">
                        <div className="text-slate-500">USDC pool</div>
                        <div className="text-slate-200 font-mono">{fmt(swapData.market.tokenPool, 0)}</div>
                      </div>
                    </div>
                  </div>
                )}

                {swapData?.market ? (
                  <div className="card p-5 space-y-4">
                    <h2 className="text-sm font-semibold text-white">FALCON ↔ F-USDC</h2>
                    <p className="text-xs text-slate-500">Mainnet-style swap via on-ledger Payment through the AMM pool.</p>

                    <div className="flex rounded-xl overflow-hidden border border-slate-700 text-sm">
                      <button
                        type="button"
                        onClick={() => { setSwapDir('buy'); setSwapAmt('') }}
                        className={`flex-1 py-2 font-medium transition-colors ${
                          swapDir === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-500'
                        }`}
                      >
                        Buy USDC
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSwapDir('sell'); setSwapAmt('') }}
                        className={`flex-1 py-2 font-medium transition-colors ${
                          swapDir === 'sell' ? 'bg-red-500/10 text-red-400' : 'text-slate-500'
                        }`}
                      >
                        Sell USDC
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs text-slate-400">
                        {swapDir === 'buy' ? 'Spend (FALCON)' : 'Sell (USDC)'}
                      </label>
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
                          {swapDir === 'buy'
                            ? xrpBalance !== null ? `Available: ${fmt(xrpBalance, 4)} FALCON` : ''
                            : swapData.userBalance ? `Available: ${fmt(swapData.userBalance.balance, 4)} USDC` : 'No trust line'}
                        </span>
                        {swapDir === 'buy' && xrpBalance != null && xrpBalance > 0.1 && (
                          <button
                            type="button"
                            onClick={() => setSwapAmt(String(Math.max(0, xrpBalance - 0.1).toFixed(6)))}
                            className="text-brand-500"
                          >Max</button>
                        )}
                        {swapDir === 'sell' && swapData.userBalance && (
                          <button
                            type="button"
                            onClick={() => setSwapAmt(String(swapData.userBalance!.balance))}
                            className="text-brand-500"
                          >Max</button>
                        )}
                      </div>
                    </div>

                    {quote && swapAmtNum > 0 && (
                      <div className="bg-slate-800/60 rounded-xl px-4 py-3 text-sm">
                        <div className="flex justify-between text-slate-400">
                          <span>You receive ~</span>
                          <span className="text-white font-semibold">
                            {fmt(quote.outputAmount, 4)}{' '}
                            <span className="text-brand-500">{swapDir === 'buy' ? 'USDC' : 'FALCON'}</span>
                          </span>
                        </div>
                      </div>
                    )}

                    {swapDir === 'buy' && !swapData.userBalance && (
                      <div className="text-xs text-amber-400 bg-amber-500/10 rounded-xl px-3 py-2">
                        Add a USDC trust line before buying.
                      </div>
                    )}

                    <button
                      onClick={handleSwap}
                      disabled={busy || !swapAmt || swapAmtNum <= 0 || (swapDir === 'buy' && !swapData.userBalance)}
                      className="btn-primary flex items-center justify-center gap-2"
                    >
                      {busy ? <><Spinner /> Signing…</> : `Swap with Passkey`}
                    </button>
                  </div>
                ) : swapData?.token.configured ? (
                  <div className="card p-4 text-sm text-slate-500 space-y-2">
                    <p>No USDC liquidity yet. Bridge USDC in or add to the pool.</p>
                    <Link href="/pool" className="text-brand-400 text-xs inline-block">
                      Go to Pool →
                    </Link>
                  </div>
                ) : null}
              </div>
            )}

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