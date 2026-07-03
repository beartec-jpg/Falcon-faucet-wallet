'use client'

import { useCallback, useEffect, useState } from 'react'
import { useNetwork } from '@/components/NetworkProvider'
import { withNetworkQuery } from '@/lib/network-query'
import {
  isPasskeySupported,
  authenticatePasskey,
} from '@/lib/passkey'
import { decryptSeed } from '@/lib/wallet-crypto'
import { type StoredWallet } from '@/lib/wallet-store'
import {
  signOfferCreate,
  signOfferCancel,
  signAmmDeposit,
  signAmmWithdraw,
  type IouAmount,
} from '@/lib/wallet-sign-client'

const DROPS_PER_XRP = 1_000_000

interface SwapToken {
  symbol: string
  currency: string
  issuer: string
  configured: boolean
}

interface UserOffer {
  seq: number
  side: 'sell' | 'buy'
  price: number
  amountToken: number
  amountXrp: number
}

interface LpPosition {
  lpBalance: number
  lpToken: { currency: string; issuer: string }
  sharePct: number
  estXrpOut: number
  estUsdcOut: number
}

interface Props {
  wallet: StoredWallet
  token: SwapToken
  xrpBalance: number | null
  usdcBalance: number | null
  ammEnabled: boolean
  onRefresh: () => void
}

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin-slow ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function fmt(n: number, d = 4): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: d })
}

export default function MarketLiquidityPanel({
  wallet,
  token,
  xrpBalance,
  usdcBalance,
  ammEnabled,
  onRefresh,
}: Props) {
  const { networkKey, network } = useNetwork()
  const [mode, setMode] = useState<'dex' | 'amm'>('dex')

  useEffect(() => {
    if (ammEnabled) setMode('amm')
  }, [ammEnabled])
  const [side, setSide] = useState<'sell' | 'buy'>('sell')
  const [tokenAmt, setTokenAmt] = useState('')
  const [price, setPrice] = useState('1')
  const [xrpAmt, setXrpAmt] = useState('')
  const [usdcAmt, setUsdcAmt] = useState('')
  const [offers, setOffers] = useState<UserOffer[]>([])
  const [lpPosition, setLpPosition] = useState<LpPosition | null>(null)
  const [withdrawPct, setWithdrawPct] = useState('100')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const loadOffers = useCallback(async () => {
    const r = await fetch(
      withNetworkQuery(`/api/market/offers?address=${encodeURIComponent(wallet.address)}`, networkKey),
    )
    const d = await r.json()
    if (!d.error) setOffers(d.offers ?? [])
  }, [wallet.address, networkKey])

  const loadLpPosition = useCallback(async () => {
    const r = await fetch(
      withNetworkQuery(`/api/market/lp-position?address=${encodeURIComponent(wallet.address)}`, networkKey),
    )
    const d = await r.json()
    if (!d.error) setLpPosition(d.position ?? null)
  }, [wallet.address, networkKey])

  useEffect(() => {
    loadOffers()
    if (ammEnabled) loadLpPosition()
  }, [loadOffers, loadLpPosition, ammEnabled])

  const submitTx = async (tx_blob: string) => {
    const res = await fetch('/api/wallet/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx_blob, network: networkKey }),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    return data
  }

  const handleDexOrder = async () => {
    if (!token.issuer || !network.live) return
    const amt = parseFloat(tokenAmt)
    const px = parseFloat(price)
    if (!Number.isFinite(amt) || amt <= 0 || !Number.isFinite(px) || px <= 0) {
      setError('Enter valid amount and price (FALCON per USDC)')
      return
    }

    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const accRes = await fetch(
        withNetworkQuery(`/api/wallet/account?address=${encodeURIComponent(wallet.address)}`, networkKey),
      )
      const accData = await accRes.json()
      if (!accRes.ok || !accData.exists) throw new Error('Failed to refresh account')

      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)

      const xrpTotal = amt * px
      const xrpDrops = String(Math.round(xrpTotal * DROPS_PER_XRP))
      const tokenValue = String(amt)

      let takerGets: string | IouAmount
      let takerPays: string | IouAmount

      if (side === 'sell') {
        takerGets = xrpDrops
        takerPays = { currency: token.currency, issuer: token.issuer, value: tokenValue }
      } else {
        takerGets = { currency: token.currency, issuer: token.issuer, value: tokenValue }
        takerPays = xrpDrops
      }

      const { tx_blob } = await signOfferCreate(
        {
          account: wallet.address,
          takerGets,
          takerPays,
          sequence: accData.sequence,
          lastLedgerSequence: accData.currentLedger + 20,
          networkId: network.networkId,
          flags: 0,
        },
        falcon_secret,
      )

      const data = await submitTx(tx_blob)
      setResult([data.result, data.message].filter(Boolean).join(' — ') || 'Submitted')
      setTokenAmt('')
      setTimeout(() => { loadOffers(); onRefresh() }, 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Order failed')
    } finally {
      setBusy(false)
    }
  }

  const handleCancel = async (offerSeq: number) => {
    setBusy(true)
    setError(null)
    try {
      const accRes = await fetch(
        withNetworkQuery(`/api/wallet/account?address=${encodeURIComponent(wallet.address)}`, networkKey),
      )
      const accData = await accRes.json()
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)
      const { tx_blob } = await signOfferCancel(
        {
          account: wallet.address,
          offerSequence: offerSeq,
          sequence: accData.sequence,
          lastLedgerSequence: accData.currentLedger + 20,
          networkId: network.networkId,
        },
        falcon_secret,
      )
      const data = await submitTx(tx_blob)
      setResult(`Cancelled offer #${offerSeq}: ${data.result ?? 'ok'}`)
      setTimeout(() => { loadOffers(); onRefresh() }, 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Cancel failed')
    } finally {
      setBusy(false)
    }
  }

  const handleAmmDeposit = async () => {
    if (!token.issuer || !ammEnabled) return
    const x = parseFloat(xrpAmt)
    const u = parseFloat(usdcAmt)
    if (!Number.isFinite(x) || x <= 0 || !Number.isFinite(u) || u <= 0) {
      setError('Enter FALCON and USDC amounts for AMM deposit')
      return
    }

    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const accRes = await fetch(
        withNetworkQuery(`/api/wallet/account?address=${encodeURIComponent(wallet.address)}`, networkKey),
      )
      const accData = await accRes.json()
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)

      const { tx_blob } = await signAmmDeposit(
        {
          account: wallet.address,
          currency: token.currency,
          issuer: token.issuer,
          amountXrpDrops: String(Math.round(x * DROPS_PER_XRP)),
          amountToken: String(u),
          sequence: accData.sequence,
          lastLedgerSequence: accData.currentLedger + 20,
          networkId: network.networkId,
        },
        falcon_secret,
      )

      const data = await submitTx(tx_blob)
      setResult(`AMM deposit: ${data.result ?? 'ok'} — LP tokens credited; fees paid to your wallet when swaps occur`)
      setXrpAmt('')
      setUsdcAmt('')
      setTimeout(() => { onRefresh(); loadLpPosition() }, 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'AMM deposit failed')
    } finally {
      setBusy(false)
    }
  }

  const handleAmmWithdraw = async (withdrawAll: boolean) => {
    if (!token.issuer || !ammEnabled || !lpPosition) return
    const pct = withdrawAll ? 100 : parseFloat(withdrawPct)
    if (!withdrawAll && (!Number.isFinite(pct) || pct <= 0 || pct > 100)) {
      setError('Enter a withdraw percentage between 1 and 100')
      return
    }

    const lpAmt = withdrawAll
      ? String(lpPosition.lpBalance)
      : String(Math.floor(lpPosition.lpBalance * (pct / 100) * 1e6) / 1e6)

    if (parseFloat(lpAmt) <= 0) {
      setError('No LP tokens to withdraw')
      return
    }

    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const accRes = await fetch(
        withNetworkQuery(`/api/wallet/account?address=${encodeURIComponent(wallet.address)}`, networkKey),
      )
      const accData = await accRes.json()
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)

      const { tx_blob } = await signAmmWithdraw(
        {
          account: wallet.address,
          currency: token.currency,
          issuer: token.issuer,
          lpTokenCurrency: lpPosition.lpToken.currency,
          lpTokenIssuer: lpPosition.lpToken.issuer,
          lpTokenAmount: lpAmt,
          withdrawAll,
          sequence: accData.sequence,
          lastLedgerSequence: accData.currentLedger + 20,
          networkId: network.networkId,
        },
        falcon_secret,
      )

      const data = await submitTx(tx_blob)
      setResult(
        `Withdrawn from pool: ${data.result ?? 'ok'} — FALCON and USDC returned to your wallet`,
      )
      setTimeout(() => { onRefresh(); loadLpPosition() }, 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'AMM withdraw failed')
    } finally {
      setBusy(false)
    }
  }

  const tokenNum = parseFloat(tokenAmt) || 0
  const withdrawPctNum = parseFloat(withdrawPct) || 0
  const priceNum = parseFloat(price) || 0
  const falconNeeded = side === 'sell' ? 0 : tokenNum * priceNum
  const usdcNeeded = side === 'sell' ? tokenNum : 0

  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white">Provide Liquidity</h2>
          <p className="text-xs text-slate-400 mt-1">
            Post limit orders on the DEX order book, or deposit into the AMM pool when enabled.
            Trading fees from fills are paid to your Falcon wallet.
          </p>
        </div>

        <div className="flex rounded-xl overflow-hidden border border-slate-700 text-sm">
          <button
            type="button"
            onClick={() => setMode('dex')}
            className={`flex-1 py-2 font-medium ${mode === 'dex' ? 'bg-cyan-500/10 text-cyan-400' : 'text-slate-500'}`}
          >
            DEX Orders
          </button>
          <button
            type="button"
            onClick={() => setMode('amm')}
            disabled={!ammEnabled}
            className={`flex-1 py-2 font-medium ${mode === 'amm' ? 'bg-purple-500/10 text-purple-400' : 'text-slate-500'} disabled:opacity-40`}
          >
            AMM Pool {ammEnabled ? '' : '(not live)'}
          </button>
        </div>

        {mode === 'dex' && (
          <div className="space-y-4">
            <div className="flex rounded-xl overflow-hidden border border-slate-700 text-sm">
              <button
                type="button"
                onClick={() => setSide('sell')}
                className={`flex-1 py-2 ${side === 'sell' ? 'bg-red-500/10 text-red-400' : 'text-slate-500'}`}
              >
                Sell USDC
              </button>
              <button
                type="button"
                onClick={() => setSide('buy')}
                className={`flex-1 py-2 ${side === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-500'}`}
              >
                Buy USDC (bid)
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">USDC amount</label>
                <input
                  type="number"
                  value={tokenAmt}
                  onChange={(e) => setTokenAmt(e.target.value)}
                  className="input-field"
                  min="0"
                  step="any"
                  disabled={busy}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Price (FALCON per USDC)</label>
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="input-field"
                  min="0"
                  step="any"
                  disabled={busy}
                />
              </div>
            </div>

            {tokenNum > 0 && priceNum > 0 && (
              <p className="text-xs text-slate-500">
                {side === 'sell'
                  ? `Locks ${fmt(tokenNum, 4)} F-USDC on the book`
                  : `Locks ~${fmt(falconNeeded, 4)} FALCON as bid`}
              </p>
            )}

            <button
              type="button"
              onClick={handleDexOrder}
              disabled={busy || !isPasskeySupported() || !token.issuer || tokenNum <= 0}
              className="btn-primary flex items-center justify-center gap-2 w-full"
            >
              {busy ? <><Spinner /> Signing…</> : 'Post Limit Order'}
            </button>
          </div>
        )}

        {mode === 'amm' && ammEnabled && (
          <div className="space-y-4">
            {lpPosition && (
              <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-3 space-y-2 text-xs">
                <div className="font-medium text-purple-300">Your pool position</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-slate-500">Pool share</div>
                    <div className="font-mono text-slate-200">{fmt(lpPosition.sharePct, 4)}%</div>
                  </div>
                  <div>
                    <div className="text-slate-500">LP tokens</div>
                    <div className="font-mono text-slate-200">{fmt(lpPosition.lpBalance, 0)}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Est. FALCON</div>
                    <div className="font-mono text-slate-200">{fmt(lpPosition.estXrpOut, 4)}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Est. USDC</div>
                    <div className="font-mono text-slate-200">{fmt(lpPosition.estUsdcOut, 4)}</div>
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <input
                    type="number"
                    value={withdrawPct}
                    onChange={(e) => setWithdrawPct(e.target.value)}
                    min="1"
                    max="100"
                    className="input-field flex-1 text-sm"
                    placeholder="%"
                    disabled={busy}
                  />
                  <button
                    type="button"
                    onClick={() => handleAmmWithdraw(false)}
                    disabled={busy || !isPasskeySupported() || withdrawPctNum <= 0}
                    className="text-xs px-3 py-2 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 disabled:opacity-40"
                  >
                    Withdraw %
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAmmWithdraw(true)}
                    disabled={busy || !isPasskeySupported()}
                    className="text-xs px-3 py-2 rounded-lg bg-purple-600/80 text-white hover:bg-purple-500 disabled:opacity-40"
                  >
                    Withdraw all
                  </button>
                </div>
              </div>
            )}

            <p className="text-xs text-slate-500">
              Deposit both assets at the current pool ratio. You receive LP tokens; swap fees accrue to LPs.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">FALCON</label>
                <input type="number" value={xrpAmt} onChange={(e) => setXrpAmt(e.target.value)} className="input-field" disabled={busy} />
                {xrpBalance != null && (
                  <button type="button" className="text-xs text-brand-500" onClick={() => setXrpAmt(String(Math.max(0, xrpBalance - 0.5)))}>
                    Max
                  </button>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">USDC</label>
                <input type="number" value={usdcAmt} onChange={(e) => setUsdcAmt(e.target.value)} className="input-field" disabled={busy} />
                {usdcBalance != null && (
                  <button type="button" className="text-xs text-brand-500" onClick={() => setUsdcAmt(String(usdcBalance))}>
                    Max
                  </button>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={handleAmmDeposit}
              disabled={busy || !isPasskeySupported()}
              className="btn-primary flex items-center justify-center gap-2 w-full bg-purple-600 hover:bg-purple-500"
            >
              {busy ? <><Spinner /> Signing…</> : 'Deposit to AMM'}
            </button>
          </div>
        )}

        {mode === 'amm' && !ammEnabled && (
          <p className="text-xs text-amber-400 bg-amber-500/10 rounded-xl px-3 py-2">
            AMM amendment is not enabled on validators yet. Use DEX limit orders for now, or ask ops to run enable-amm-fleet.sh.
          </p>
        )}
      </div>

      {offers.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-2 text-xs font-semibold text-slate-400 border-b border-slate-800">
            Your open orders ({offers.length})
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800/50">
                <th className="text-left px-3 py-2">Side</th>
                <th className="text-right px-3 py-2">Price</th>
                <th className="text-right px-3 py-2">USDC</th>
                <th className="text-right px-3 py-2 hidden sm:table-cell">FALCON</th>
                <th className="text-right px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.seq} className="border-b border-slate-800/30">
                  <td className={`px-3 py-2 ${o.side === 'sell' ? 'text-red-400' : 'text-emerald-400'}`}>
                    {o.side}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(o.price, 6)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(o.amountToken, 2)}</td>
                  <td className="px-3 py-2 text-right font-mono hidden sm:table-cell">{fmt(o.amountXrp, 2)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleCancel(o.seq)}
                      disabled={busy}
                      className="text-red-400 hover:text-red-300 disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result && (
        <div className="card p-4 border border-emerald-500/20 text-sm text-emerald-400">
          {result}
          <button type="button" onClick={() => setResult(null)} className="block text-xs text-slate-500 mt-2">Dismiss</button>
        </div>
      )}
      {error && (
        <div className="card p-4 border border-red-500/20 text-sm text-red-400">
          {error}
          <button type="button" onClick={() => setError(null)} className="block text-xs text-slate-500 mt-2">Dismiss</button>
        </div>
      )}
    </div>
  )
}