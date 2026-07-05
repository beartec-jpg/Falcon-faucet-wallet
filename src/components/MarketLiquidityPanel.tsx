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
  signAmmCreate,
  signAmmDeposit,
  signAmmWithdraw,
} from '@/lib/wallet-sign-client'
import { AMM_CREATE_FEE_DROPS, submitWalletTx } from '@/lib/wallet-submit'

const DROPS_PER_XRP = 1_000_000

interface SwapToken {
  symbol: string
  currency: string
  issuer: string
  configured: boolean
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
  /** True when an AMM pool exists on-ledger (not the same as DEX order book). */
  poolLive: boolean
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
  poolLive,
  poolPrice,
  onRefresh,
}: Props) {
  const { networkKey, network } = useNetwork()
  const [xrpAmt, setXrpAmt] = useState('')
  const [usdcAmt, setUsdcAmt] = useState('')
  const [lpPosition, setLpPosition] = useState<LpPosition | null>(null)
  const [poolSnapshot, setPoolSnapshot] = useState<PoolSnapshot | null>(null)
  const [withdrawPct, setWithdrawPct] = useState('100')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

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
    if (poolLive) loadLpPosition()
  }, [loadLpPosition, poolLive])

  const submitTx = (tx_blob: string) => submitWalletTx(tx_blob, networkKey)

  const handleAmmCreate = async () => {
    if (!token.issuer || !network.live || poolLive) return
    const x = parseFloat(xrpAmt)
    const u = parseFloat(usdcAmt)
    if (!Number.isFinite(x) || x <= 0 || !Number.isFinite(u) || u <= 0) {
      setError('Enter FALCON and bridged F-USDC amounts to create the pool')
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

      const createFeeFalcon = parseInt(AMM_CREATE_FEE_DROPS, 10) / DROPS_PER_XRP
      if (xrpBalance != null && xrpBalance < x + createFeeFalcon + 0.5) {
        throw new Error(
          `Need ~${fmt(x + createFeeFalcon + 0.5, 2)} FALCON total ` +
            `(${fmt(x, 0)} pool + ~${fmt(createFeeFalcon, 0)} create fee + reserve)`,
        )
      }
      if (usdcBalance != null && usdcBalance < u) {
        throw new Error(`Need ${fmt(u, 4)} bridged F-USDC — bridge USDC in first`)
      }

      const { tx_blob } = await signAmmCreate(
        {
          account: wallet.address,
          currency: token.currency,
          issuer: token.issuer,
          amountXrpDrops: String(Math.round(x * DROPS_PER_XRP)),
          amountToken: String(u),
          fee: AMM_CREATE_FEE_DROPS,
          sequence: accData.sequence,
          lastLedgerSequence: accData.currentLedger + 20,
          networkId: network.networkId,
        },
        falcon_secret,
      )

      const data = await submitTx(tx_blob)
      setResult(`AMM pool created (${data.hash?.slice(0, 12) ?? data.result}) — refresh in a few seconds`)
      setXrpAmt('')
      setUsdcAmt('')
      setTimeout(() => { onRefresh(); loadLpPosition() }, 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'AMM create failed')
    } finally {
      setBusy(false)
    }
  }

  const handleAmmDeposit = async () => {
    if (!token.issuer || !poolLive) return
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
    if (!token.issuer || !poolLive || !lpPosition) return
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

  const withdrawPctNum = parseFloat(withdrawPct) || 0

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
          <h2 className="text-sm font-semibold text-white">AMM Pool</h2>
          <p className="text-xs text-slate-400 mt-1">
            Deposit bridged F-USDC and FALCON into the shared pool, or withdraw your LP share.
            Limit orders are on the Swap tab — they are a separate DEX book, not part of this pool.
          </p>
        </div>

        {error && (
          <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
            {error}
            <button type="button" onClick={() => setError(null)} className="block text-slate-500 mt-1">
              Dismiss
            </button>
          </div>
        )}

        {!poolLive && (
          <div className="space-y-4">
            <p className="text-xs text-amber-200 bg-amber-500/10 rounded-xl px-3 py-2">
              No AMM pool exists yet. Bridge USDC in, then create the pool with bridged F-USDC + FALCON.
              You set the initial price (ratio of the two amounts). Creating the pool costs a one-time{' '}
              ~{fmt(parseInt(AMM_CREATE_FEE_DROPS, 10) / DROPS_PER_XRP, 0)} FALCON ledger fee on top of your deposit.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">FALCON</label>
                <input
                  type="number"
                  value={xrpAmt}
                  onChange={(e) => setXrpAmt(e.target.value)}
                  className="input-field"
                  disabled={busy}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">F-USDC (bridged)</label>
                <input
                  type="number"
                  value={usdcAmt}
                  onChange={(e) => setUsdcAmt(e.target.value)}
                  className="input-field"
                  disabled={busy}
                />
              </div>
            </div>
            {parseFloat(xrpAmt) > 0 && parseFloat(usdcAmt) > 0 && (
              <p className="text-xs text-slate-500">
                Initial price: {fmt(parseFloat(xrpAmt) / parseFloat(usdcAmt), 6)} FALCON per F-USDC
              </p>
            )}
            <button
              type="button"
              onClick={handleAmmCreate}
              disabled={busy || !isPasskeySupported() || !token.issuer}
              className="btn-primary flex items-center justify-center gap-2 w-full bg-purple-600 hover:bg-purple-500"
            >
              {busy ? <><Spinner /> Signing…</> : 'Create AMM Pool'}
            </button>
          </div>
        )}

        {poolLive && (
          <div className="space-y-4">
            {!lpPosition && (
              <p className="text-xs text-slate-500">
                Pool is live — deposit below to add liquidity, or refresh if you just created it.
              </p>
            )}
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
      </div>

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