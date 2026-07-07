'use client'

import { useState, useEffect, useCallback } from 'react'
import { useNetwork } from '@/components/NetworkProvider'
import { withNetworkQuery } from '@/lib/network-query'
import { isPasskeySupported, authenticatePasskey } from '@/lib/passkey'
import { decryptSeed } from '@/lib/wallet-crypto'
import { type StoredWallet } from '@/lib/wallet-store'
import {
  signOfferCreate,
  signOfferCancel,
  TF_PASSIVE,
  type IouAmount,
} from '@/lib/wallet-sign-client'
import { submitWithSequenceRetry, fetchSequenceInfo } from '@/lib/wallet-submit'
import { fmtOfferAmount } from '@/lib/swap/dust-offers'

const DROPS_PER_XRP = 1_000_000
/** F-USDC (and the QUC test token) settle to 6 decimal places. */
const FUSDC_PRECISION = 1e6

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
  dust?: boolean
}

interface Props {
  wallet: StoredWallet
  token: SwapToken
  xrpBalance: number | null
  usdcBalance: number | null
  marketPrice?: number | null
  onRefresh: () => void
  onBookRefresh?: () => void
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

export default function DexOrdersPanel({
  wallet,
  token,
  xrpBalance,
  usdcBalance,
  marketPrice,
  onRefresh,
  onBookRefresh,
}: Props) {
  const { networkKey, network } = useNetwork()
  const [side, setSide] = useState<'sell' | 'buy'>('sell')
  const [tokenAmt, setTokenAmt] = useState('')
  const [price, setPrice] = useState(
    marketPrice != null && marketPrice > 0 ? String(marketPrice) : '10',
  )
  const [offers, setOffers] = useState<UserOffer[]>([])
  const [offersLoading, setOffersLoading] = useState(true)
  const [postOnly, setPostOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const loadOffers = useCallback(async () => {
    setOffersLoading(true)
    try {
      const r = await fetch(
        withNetworkQuery(`/api/market/offers?address=${encodeURIComponent(wallet.address)}`, networkKey),
      )
      const d = await r.json()
      if (!d.error) setOffers(d.offers ?? [])
    } finally {
      setOffersLoading(false)
    }
  }, [wallet.address, networkKey])

  useEffect(() => {
    loadOffers()
  }, [loadOffers])

  useEffect(() => {
    if (marketPrice != null && marketPrice > 0) {
      setPrice((p) => (p === '1' || p === '10' ? String(marketPrice) : p))
    }
  }, [marketPrice])

  const handleDexOrder = async () => {
    if (!token.issuer || !network.live) return
    const amt = parseFloat(tokenAmt)
    const px = parseFloat(price)
    if (!Number.isFinite(amt) || amt <= 0 || !Number.isFinite(px) || px <= 0) {
      setError('Enter valid amount and price (FALCON per F-USDC)')
      return
    }

    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)

      // Normalise to avoid float dust and sub-drop pricing: quantise the token
      // amount to 6 dp (F-USDC precision) and derive integer XRP drops from it.
      const tokenAmt = Math.round(amt * FUSDC_PRECISION) / FUSDC_PRECISION
      const xrpDrops = String(Math.round(tokenAmt * px * DROPS_PER_XRP))
      const tokenValue = String(tokenAmt)

      let takerGets: string | IouAmount
      let takerPays: string | IouAmount

      if (side === 'sell') {
        takerGets = { currency: token.currency, issuer: token.issuer, value: tokenValue }
        takerPays = xrpDrops
      } else {
        takerGets = xrpDrops
        takerPays = { currency: token.currency, issuer: token.issuer, value: tokenValue }
      }

      const data = await submitWithSequenceRetry({
        networkKey,
        fetchSequence: async () => {
          const a = await fetchSequenceInfo(wallet.address, networkKey)
          if (!a.exists) throw new Error('Failed to refresh account')
          return { sequence: a.sequence, currentLedger: a.currentLedger }
        },
        sign: ({ sequence, lastLedgerSequence }) =>
          signOfferCreate(
            {
              account: wallet.address,
              takerGets,
              takerPays,
              sequence,
              lastLedgerSequence,
              networkId: network.networkId,
              flags: postOnly ? TF_PASSIVE : 0,
            },
            falcon_secret,
          ),
      })
      const msg = [data.result, data.message].filter(Boolean).join(' — ') || 'Submitted'
      const submittedAmt = amt
      const submittedSide = side
      setTokenAmt('')
      setResult(`${msg} — confirming…`)
      setTimeout(async () => {
        await loadOffers()
        onRefresh()
        onBookRefresh?.()
        const r = await fetch(
          withNetworkQuery(`/api/market/offers?address=${encodeURIComponent(wallet.address)}`, networkKey),
        )
        const offersNow: UserOffer[] = (await r.json()).offers ?? []
        const sameSide = offersNow.filter((o) => o.side === submittedSide)
        const remaining = sameSide.reduce((s, o) => s + o.amountToken, 0)

        if (offersNow.length === 0) {
          setResult(`${msg} — filled completely (matched book and/or AMM).`)
        } else if (!postOnly && remaining > 0 && remaining < submittedAmt - 1e-6) {
          setResult(
            `${msg} — partially filled: ~${fmt(submittedAmt - remaining, 4)} F-USDC traded, ~${fmt(remaining, 4)} still on the book.`,
          )
        } else if (postOnly) {
          setResult(`${msg} — posted to book (post-only; did not take existing orders).`)
        } else {
          setResult(`${msg} — resting on the book (no matching orders at this price).`)
        }
      }, 4000)
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
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)
      const data = await submitWithSequenceRetry({
        networkKey,
        fetchSequence: async () => {
          const a = await fetchSequenceInfo(wallet.address, networkKey)
          return { sequence: a.sequence, currentLedger: a.currentLedger }
        },
        sign: ({ sequence, lastLedgerSequence }) =>
          signOfferCancel(
            {
              account: wallet.address,
              offerSequence: offerSeq,
              sequence,
              lastLedgerSequence,
              networkId: network.networkId,
            },
            falcon_secret,
          ),
      })
      setResult(`Cancelled offer #${offerSeq}: ${data.result ?? 'ok'}`)
      setTimeout(() => { loadOffers(); onRefresh() }, 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Cancel failed')
    } finally {
      setBusy(false)
    }
  }

  const tokenNum = parseFloat(tokenAmt) || 0
  const priceNum = parseFloat(price) || 0
  const falconNeeded = side === 'buy' ? tokenNum * priceNum : 0

  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white">DEX Limit Orders</h2>
          <p className="text-xs text-slate-400 mt-1">
            Limit orders fill against matching bids/asks first; any remainder rests on the book.
            Partial fills are automatic — no extra setting needed.
            {marketPrice ? ` Market ≈ ${fmt(marketPrice, 4)} FALCON per F-USDC (${fmt(1 / marketPrice, 4)} F-USDC per FALCON).` : ''}
            {' '}Price is FALCON per F-USDC — e.g. 10 F-USDC per 1 FALCON = enter 0.1.
            {' '}Prices far from market may also hit the AMM pool.
          </p>
        </div>

        <div className="flex rounded-xl overflow-hidden border border-slate-700 text-sm">
          <button
            type="button"
            onClick={() => setSide('sell')}
            className={`flex-1 py-2 ${side === 'sell' ? 'bg-red-500/10 text-red-400' : 'text-slate-500'}`}
          >
            Sell F-USDC
          </button>
          <button
            type="button"
            onClick={() => setSide('buy')}
            className={`flex-1 py-2 ${side === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-500'}`}
          >
            Buy F-USDC (bid)
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-slate-400">F-USDC amount</label>
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
            <label className="text-xs text-slate-400">Price (FALCON per F-USDC)</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="input-field"
              min="0"
              step="any"
              disabled={busy}
            />
            {priceNum > 0 && (
              <p className="text-[10px] text-slate-500">
                = {fmt(1 / priceNum, 4)} F-USDC per 1 FALCON
              </p>
            )}
          </div>
        </div>

        {tokenNum > 0 && priceNum > 0 && (
          <p className="text-xs text-slate-500">
            {side === 'sell'
              ? `Locks ${fmt(tokenNum, 4)} F-USDC on the book`
              : `Locks ~${fmt(falconNeeded, 4)} FALCON as bid`}
          </p>
        )}

        {side === 'sell' && usdcBalance != null && usdcBalance > 0 && (
          <button
            type="button"
            onClick={() => setTokenAmt(String(usdcBalance))}
            className="text-xs text-brand-500"
          >
            Max F-USDC ({fmt(usdcBalance, 4)})
          </button>
        )}
        {side === 'buy' && xrpBalance != null && xrpBalance > 0.1 && priceNum > 0 && (
          <button
            type="button"
            onClick={() => {
              const maxUsdc = Math.max(0, (xrpBalance - 0.1) / priceNum)
              setTokenAmt(String(Math.floor(maxUsdc * 1e6) / 1e6))
            }}
            className="text-xs text-brand-500"
          >
            Max from FALCON balance
          </button>
        )}

        <label className="flex items-start gap-2 text-xs text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={postOnly}
            onChange={(e) => setPostOnly(e.target.checked)}
            disabled={busy}
            className="mt-0.5 rounded border-slate-600"
          />
          <span>
            Post only — rest on the book without taking existing bids/asks (maker quote).
            Leave unchecked to match the book immediately, including partial fills.
          </span>
        </label>

        <button
          type="button"
          onClick={handleDexOrder}
          disabled={busy || !isPasskeySupported() || !token.issuer || tokenNum <= 0}
          className="btn-primary flex items-center justify-center gap-2 w-full"
        >
          {busy ? <><Spinner /> Signing…</> : 'Post Limit Order'}
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-2 text-xs font-semibold text-slate-400 border-b border-slate-800 flex items-center justify-between">
          <span>Your open orders ({offers.length})</span>
          <button
            type="button"
            onClick={() => loadOffers()}
            disabled={offersLoading}
            className="text-brand-400 hover:text-brand-300 disabled:opacity-40"
          >
            {offersLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {offersLoading && offers.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-slate-600 flex items-center justify-center gap-2">
            <Spinner className="w-3 h-3" /> Loading orders…
          </div>
        ) : offers.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-slate-600">
            No open limit orders — post a sell or buy above to add one to the book.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800/50">
                <th className="text-left px-3 py-2">Side</th>
                <th className="text-right px-3 py-2">Price</th>
                <th className="text-right px-3 py-2">F-USDC</th>
                <th className="text-right px-3 py-2 hidden sm:table-cell">FALCON</th>
                <th className="text-right px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.seq} className={`border-b border-slate-800/30 ${o.dust ? 'bg-amber-500/5' : ''}`}>
                  <td className={`px-3 py-2 ${o.side === 'sell' ? 'text-red-400' : 'text-emerald-400'}`}>
                    {o.side}
                    {o.dust && <span className="block text-[10px] text-amber-400/80">dust</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(o.price, 6)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtOfferAmount(o.amountToken)}</td>
                  <td className="px-3 py-2 text-right font-mono hidden sm:table-cell">{fmtOfferAmount(o.amountXrp)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleCancel(o.seq)}
                      disabled={busy}
                      className="text-red-400 hover:text-red-300 disabled:opacity-40"
                    >
                      {o.dust ? 'Cancel dust' : 'Cancel'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {result && (
        <div className="card p-4 border border-emerald-500/20 text-sm text-emerald-400">
          {result}
          <button type="button" onClick={() => setResult(null)} className="block text-xs text-slate-500 mt-2">
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="card p-4 border border-red-500/20 text-sm text-red-400">
          {error}
          <button type="button" onClick={() => setError(null)} className="block text-xs text-slate-500 mt-2">
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}