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

interface PoolSnapshot {
  xrp: number
  usdc: number
}

interface Props {
  wallet: StoredWallet
  token: SwapToken
  xrpBalance: number | null
  usdcBalance: number | null
  ammEnabled: boolean
  /** FALCON per F-USDC from parent market data; used until lp-position pool loads. */
  poolPrice?: number | null
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

/** FALCON per F-USDC — same units as pool price display. */
function poolRatioFromPools(falconPool: number, usdcPool: number): number {
  if (usdcPool <= 0) return 0
  return falconPool / usdcPool
}

function matchedDepositAmounts(
  falcon: number,
  usdc: number,
  poolRatio: number,
): { matchedFalcon: number; matchedUsdc: number; imbalancePct: number } {
  if (poolRatio <= 0 || falcon <= 0 || usdc <= 0) {
    return { matchedFalcon: 0, matchedUsdc: 0, imbalancePct: 100 }
  }
  const matchedFalcon = Math.min(falcon, usdc * poolRatio)
  const matchedUsdc = matchedFalcon / poolRatio
  const ref = Math.max(falcon, usdc * poolRatio)
  const imbalancePct = ref > 0 ? (Math.abs(falcon - usdc * poolRatio) / ref) * 100 : 0
  return { matchedFalcon, matchedUsdc, imbalancePct }
}

function maxBalancedDeposit(
  falconBal: number,
  usdcBal: number,
  poolRatio: number,
  reserve = 0.5,
): { falcon: number; usdc: number } {
  const f = Math.max(0, falconBal - reserve)
  const u = Math.max(0, usdcBal)
  if (poolRatio <= 0) return { falcon: f, usdc: u }
  if (u >= f / poolRatio) return { falcon: f, usdc: f / poolRatio }
  return { falcon: u * poolRatio, usdc: u }
}

const DEPOSIT_IMBALANCE_WARN_PCT = 0.5
const DEPOSIT_IMBALANCE_BLOCK_PCT = 1

export default function MarketLiquidityPanel({
  wallet,
  token,
  xrpBalance,
  usdcBalance,
  ammEnabled,
  poolPrice,
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
  const [poolSnapshot, setPoolSnapshot] = useState<PoolSnapshot | null>(null)
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
    if (!d.error) {
      setLpPosition(d.position ?? null)
      if (d.pool) {
        setPoolSnapshot({ xrp: d.pool.xrp, usdc: d.pool.usdc })
      }
    }
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

    if (activePoolRatio > 0) {
      const { matchedFalcon, matchedUsdc, imbalancePct } = matchedDepositAmounts(x, u, activePoolRatio)
      if (imbalancePct > DEPOSIT_IMBALANCE_BLOCK_PCT) {
        setError(
          `Deposit sides don't match the pool ratio (${fmt(activePoolRatio, 4)} FALCON per F-USDC). ` +
            `Only ~${fmt(matchedFalcon, 4)} FALCON + ~${fmt(matchedUsdc, 4)} F-USDC would become LP; ` +
            `excess stays in your wallet or may be swapped at pool price. Click "Match pool ratio" first.`,
        )
        return
      }
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

  const activePoolRatio = poolSnapshot
    ? poolRatioFromPools(poolSnapshot.xrp, poolSnapshot.usdc)
    : (poolPrice ?? 0)

  const depositFalcon = parseFloat(xrpAmt) || 0
  const depositUsdc = parseFloat(usdcAmt) || 0
  const depositMatch =
    activePoolRatio > 0 && depositFalcon > 0 && depositUsdc > 0
      ? matchedDepositAmounts(depositFalcon, depositUsdc, activePoolRatio)
      : null

  const handleFalconDepositChange = (value: string) => {
    setXrpAmt(value)
    const n = parseFloat(value)
    if (activePoolRatio > 0 && Number.isFinite(n) && n > 0) {
      setUsdcAmt(String(Math.round((n / activePoolRatio) * 1e6) / 1e6))
    }
  }

  const handleUsdcDepositChange = (value: string) => {
    setUsdcAmt(value)
    const n = parseFloat(value)
    if (activePoolRatio > 0 && Number.isFinite(n) && n > 0) {
      setXrpAmt(String(Math.round(n * activePoolRatio * 1e6) / 1e6))
    }
  }

  const matchPoolRatio = () => {
    const x = parseFloat(xrpAmt) || 0
    const u = parseFloat(usdcAmt) || 0
    if (activePoolRatio <= 0) return
    if (x <= 0 && u <= 0) return
    const { matchedFalcon, matchedUsdc } =
      x > 0 && u > 0
        ? matchedDepositAmounts(x, u, activePoolRatio)
        : x > 0
          ? { matchedFalcon: x, matchedUsdc: x / activePoolRatio }
          : { matchedFalcon: u * activePoolRatio, matchedUsdc: u }
    setXrpAmt(String(Math.round(matchedFalcon * 1e6) / 1e6))
    setUsdcAmt(String(Math.round(matchedUsdc * 1e6) / 1e6))
    setError(null)
  }

  const applyMaxBalancedFromFalcon = () => {
    if (xrpBalance == null || activePoolRatio <= 0) return
    const { falcon, usdc } = maxBalancedDeposit(xrpBalance, usdcBalance ?? 0, activePoolRatio)
    setXrpAmt(String(Math.round(falcon * 1e6) / 1e6))
    setUsdcAmt(String(Math.round(usdc * 1e6) / 1e6))
  }

  const applyMaxBalancedFromUsdc = () => {
    if (usdcBalance == null || activePoolRatio <= 0) return
    const { falcon, usdc } = maxBalancedDeposit(xrpBalance ?? 0, usdcBalance, activePoolRatio)
    setXrpAmt(String(Math.round(falcon * 1e6) / 1e6))
    setUsdcAmt(String(Math.round(usdc * 1e6) / 1e6))
  }

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
                <p className="text-slate-500">
                  Withdrawable now — your share of the whole pool, not what you originally typed in.
                </p>
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
                    <div className="text-slate-500">Withdrawable FALCON</div>
                    <div className="font-mono text-slate-200">{fmt(lpPosition.estXrpOut, 4)}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Withdrawable F-USDC</div>
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
              Deposit both assets at the current pool ratio
              ({activePoolRatio > 0 ? `${fmt(activePoolRatio, 4)} FALCON per F-USDC` : 'loading…'}).
              This is monetary value at the live price, not equal token counts — if FALCON trades at $2, you deposit
              about twice as much F-USDC as FALCON per dollar of liquidity.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">FALCON</label>
                <input
                  type="number"
                  value={xrpAmt}
                  onChange={(e) => handleFalconDepositChange(e.target.value)}
                  className="input-field"
                  disabled={busy}
                />
                {xrpBalance != null && activePoolRatio > 0 && (
                  <button type="button" className="text-xs text-brand-500" onClick={applyMaxBalancedFromFalcon}>
                    Max (balanced)
                  </button>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">F-USDC</label>
                <input
                  type="number"
                  value={usdcAmt}
                  onChange={(e) => handleUsdcDepositChange(e.target.value)}
                  className="input-field"
                  disabled={busy}
                />
                {usdcBalance != null && activePoolRatio > 0 && (
                  <button type="button" className="text-xs text-brand-500" onClick={applyMaxBalancedFromUsdc}>
                    Max (balanced)
                  </button>
                )}
              </div>
            </div>

            {depositMatch && depositMatch.imbalancePct > DEPOSIT_IMBALANCE_WARN_PCT && (
              <div className="text-xs rounded-xl px-3 py-2 space-y-2 bg-amber-500/10 border border-amber-500/25 text-amber-200">
                <p>
                  Imbalanced deposit. Only ~{fmt(depositMatch.matchedFalcon, 4)}{' '}
                  FALCON + ~{fmt(depositMatch.matchedUsdc, 4)} F-USDC would become LP ({fmt(depositMatch.imbalancePct, 2)}%
                  off pool ratio). Excess stays in your wallet or may be swapped at pool price.
                </p>
                <button
                  type="button"
                  onClick={matchPoolRatio}
                  disabled={busy}
                  className="text-xs px-3 py-1.5 rounded-lg bg-amber-600/80 text-white hover:bg-amber-500 disabled:opacity-40"
                >
                  Match pool ratio
                </button>
              </div>
            )}

            {depositMatch &&
              depositMatch.imbalancePct <= DEPOSIT_IMBALANCE_WARN_PCT &&
              depositFalcon > 0 &&
              depositUsdc > 0 && (
                <p className="text-xs text-emerald-400/90 bg-emerald-500/10 rounded-xl px-3 py-2">
                  Balanced at pool ratio — ~{fmt(depositMatch.matchedFalcon, 4)} FALCON + ~{fmt(depositMatch.matchedUsdc, 4)}{' '}
                  F-USDC will become LP.
                </p>
              )}

            <button
              type="button"
              onClick={handleAmmDeposit}
              disabled={
                busy ||
                !isPasskeySupported() ||
                (depositMatch != null && depositMatch.imbalancePct > DEPOSIT_IMBALANCE_BLOCK_PCT)
              }
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