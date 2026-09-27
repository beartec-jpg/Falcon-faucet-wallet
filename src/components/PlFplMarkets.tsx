'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNetwork } from '@/components/NetworkProvider'
import { authenticatePasskey } from '@/lib/passkey'
import { decryptSeed } from '@/lib/wallet-crypto'
import { loadPrimaryWallet, type StoredWallet } from '@/lib/wallet-store'
import { plAccountId } from '@/lib/pl-names'
import {
  decimalToBaseUnits,
  signPlAddLiquidity,
  signPlLend,
  signPlRemoveLiquidity,
  signPlSwapRoute,
} from '@/lib/pl-wallet-sign'
import { fetchSequenceInfo } from '@/lib/wallet-submit'

type Asset = 'FPL' | 'BTC' | 'ETH' | 'USDC'
const ASSETS: Asset[] = ['FPL', 'USDC', 'ETH', 'BTC']

type Pool = {
  id: string
  asset_a: string
  asset_b: string
  reserve_a: string
  reserve_b: string
  lp_supply: string
}
type Market = {
  id: string
  asset: string
  total_supply: string
  total_borrow: string
  /** Share supply. Absent on older nodes, where it still matches total_supply. */
  share_supply: string
  ltv_bps: number
  price_fpl: string
}
type Position = {
  market_id: string
  asset: string
  shares: string
  debt: string
  collateral_fpl: string
}
type LpPos = {
  pool_id: string
  lp: string
}

const DECIMALS: Record<Asset, number> = {
  FPL: 0,
  BTC: 8,
  ETH: 18,
  USDC: 6,
}

function digitsOf(v: unknown): string {
  if (typeof v === 'string' && /^\d+$/.test(v)) return v.replace(/^0+(?=\d)/, '')
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.trunc(v).toString()
  return '0'
}

function toRaw(asset: Asset, human: string): string {
  return decimalToBaseUnits(human, DECIMALS[asset])
}

function assetLabel(asset: Asset): string {
  if (asset === 'USDC') return 'F-USDC'
  if (asset === 'ETH') return 'FETH'
  if (asset === 'BTC') return 'FBTC'
  return 'FPL'
}

/** Markets the pool page always offers. The amount box follows this selection. */
const POOL_MARKETS: { id: string; asset: Asset }[] = [
  { id: 'usdc-fpl', asset: 'USDC' },
  { id: 'eth-fpl', asset: 'ETH' },
  { id: 'btc-fpl', asset: 'BTC' },
]

function assetFromPoolId(id: string): Asset | null {
  const known = POOL_MARKETS.find((m) => m.id === id)
  if (known) return known.asset
  if (id.includes('usdc')) return 'USDC'
  if (id.includes('eth')) return 'ETH'
  if (id.includes('btc')) return 'BTC'
  return null
}

const LEND_MARKETS: { id: string; asset: Asset }[] = [
  { id: 'lend-usdc', asset: 'USDC' },
  { id: 'lend-eth', asset: 'ETH' },
  { id: 'lend-btc', asset: 'BTC' },
]

function assetFromLendId(id: string): Asset | null {
  const known = LEND_MARKETS.find((m) => m.id === id)
  if (known) return known.asset
  if (id.includes('usdc')) return 'USDC'
  if (id.includes('eth')) return 'ETH'
  if (id.includes('btc')) return 'BTC'
  return null
}

function lendChoices(markets: Market[]): { id: string; asset: Asset }[] {
  const rank: Record<string, number> = { USDC: 0, ETH: 1, BTC: 2 }
  const fromChain = markets
    .map((m) => {
      const asset = (m.asset as Asset) || assetFromLendId(m.id)
      if (!asset || asset === 'FPL' || !(asset in DECIMALS)) return null
      return { id: m.id, asset }
    })
    .filter((row): row is { id: string; asset: 'USDC' | 'ETH' | 'BTC' } => row !== null)
  const rows = fromChain.length ? fromChain : LEND_MARKETS
  return [...rows].sort((a, b) => (rank[a.asset] ?? 9) - (rank[b.asset] ?? 9))
}

function poolChoices(pools: Pool[]): { id: string; asset: Asset }[] {
  const rank: Record<string, number> = { USDC: 0, ETH: 1, BTC: 2 }
  const fromChain = pools
    .filter((p) => p.id !== 'fpl-btc')
    .map((p) => {
      const asset = poolPair(p)?.fAsset ?? assetFromPoolId(p.id)
      return asset ? { id: p.id, asset } : null
    })
    .filter((row): row is { id: string; asset: Asset } => row !== null)
  const rows = fromChain.length ? fromChain : POOL_MARKETS
  return [...rows].sort((a, b) => (rank[a.asset] ?? 9) - (rank[b.asset] ?? 9))
}

/** Amount string for an input. No thousands separators. */
function plainAmount(asset: Asset, raw: string): string {
  const d = DECIMALS[asset]
  const s = raw.replace(/^0+/, '') || '0'
  if (s === '0') return '0'
  if (d === 0) return s
  const pad = s.padStart(d + 1, '0')
  const whole = pad.slice(0, -d)
  const frac = pad.slice(-d).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

type PoolPair = { fAsset: Asset; fReserve: string; fplReserve: string }

function poolPair(p: Pool): PoolPair | null {
  if (p.asset_a === 'FPL' && p.asset_b !== 'FPL') {
    return { fAsset: p.asset_b as Asset, fReserve: p.reserve_b, fplReserve: p.reserve_a }
  }
  if (p.asset_b === 'FPL' && p.asset_a !== 'FPL') {
    return { fAsset: p.asset_a as Asset, fReserve: p.reserve_a, fplReserve: p.reserve_b }
  }
  return null
}

/** Largest add that matches the pool and fits both balances. 2 FPL stays back for the fee. */
function evenAdd(
  fBal: bigint,
  fplBal: bigint,
  fReserve: bigint,
  fplReserve: bigint,
  pctBps: bigint,
): { f: bigint; fpl: bigint } {
  const fee = 2n
  const fplSpend = fplBal > fee ? fplBal - fee : 0n
  if (fBal === 0n || fplSpend === 0n || fReserve === 0n || fplReserve === 0n || pctBps === 0n) {
    return { f: 0n, fpl: 0n }
  }
  const fplForAll = (fBal * fplReserve) / fReserve
  let f = fBal
  let fpl = fplForAll
  if (fplForAll > fplSpend) {
    fpl = fplSpend
    f = (fplSpend * fReserve) / fplReserve
  }
  f = (f * pctBps) / 10000n
  fpl = f === 0n ? 0n : (f * fplReserve) / fReserve
  if (fpl > fplSpend) {
    fpl = fplSpend
    f = (fpl * fReserve) / fplReserve
  }
  if (f > fBal) f = fBal
  return { f, fpl }
}

function fromRaw(asset: Asset, raw: string): string {
  const d = DECIMALS[asset]
  const s = raw.replace(/^0+/, '') || '0'
  if (d === 0) return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const pad = s.padStart(d + 1, '0')
  const whole = pad.slice(0, -d).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const frac = pad.slice(-d).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

function asPool(row: Record<string, unknown>): Pool {
  return {
    id: String(row.id ?? ''),
    asset_a: String(row.asset_a ?? ''),
    asset_b: String(row.asset_b ?? ''),
    reserve_a: digitsOf(row.reserve_a),
    reserve_b: digitsOf(row.reserve_b),
    lp_supply: digitsOf(row.lp_supply),
  }
}

function asMarket(row: Record<string, unknown>): Market {
  const total = digitsOf(row.total_supply)
  const issued = row.share_supply == null ? total : digitsOf(row.share_supply)
  return {
    id: String(row.id ?? ''),
    asset: String(row.asset ?? ''),
    total_supply: total,
    total_borrow: digitsOf(row.total_borrow),
    share_supply: issued === '0' ? total : issued,
    ltv_bps: Number(row.ltv_bps ?? 5000) || 5000,
    price_fpl: digitsOf(row.price_fpl),
  }
}

function asPosition(row: Record<string, unknown>): Position {
  return {
    market_id: String(row.market_id ?? ''),
    asset: String(row.asset ?? ''),
    shares: digitsOf(row.shares),
    debt: digitsOf(row.debt),
    collateral_fpl: digitsOf(row.collateral_fpl),
  }
}

function asLp(row: Record<string, unknown>): LpPos {
  return {
    pool_id: String(row.pool_id ?? ''),
    lp: digitsOf(row.lp),
  }
}

/** This account's slice of a pool reserve. */
function coinsFor(reserve: string, lp: string, supply: string): string {
  const whole = BigInt(supply || '0')
  if (whole === 0n) return '0'
  return ((BigInt(reserve || '0') * BigInt(lp || '0')) / whole).toString()
}

function pctText(part: bigint, whole: bigint): string {
  if (whole === 0n || part === 0n) return '0%'
  const bps = (part * 10000n) / whole
  if (bps === 0n) return '<0.01%'
  const s = bps.toString().padStart(3, '0')
  const head = s.slice(0, -2)
  const frac = s.slice(-2).replace(/0+$/, '')
  return frac ? `${head}.${frac}%` : `${head}%`
}

/** Coin raw units this many shares can withdraw. */
function sharesToCoin(shares: string, totalSupply: string, shareSupply: string): string {
  const supply = BigInt(totalSupply || '0')
  const issued = BigInt(shareSupply || '0')
  if (supply === 0n || issued === 0n) return '0'
  return ((BigInt(shares || '0') * supply) / issued).toString()
}

/** Shares to burn for a coin amount. Rejects a withdraw larger than this account's supply. */
function coinToShares(raw: string, totalSupply: string, shareSupply: string, haveShares: string): string {
  const supply = BigInt(totalSupply || '0')
  const issued = BigInt(shareSupply && shareSupply !== '0' ? shareSupply : totalSupply || '0')
  const have = BigInt(haveShares || '0')
  if (have === 0n) throw new Error('You have nothing supplied on this market')
  if (supply === 0n || issued === 0n) throw new Error('This market has no supply')
  const want = (BigInt(raw) * issued) / supply
  if (want === 0n) throw new Error('Amount is too small to withdraw')
  if (want > have) throw new Error('That is more than you have supplied')
  return want.toString()
}

/** FPL for one whole coin, from the pool reserves. */
function poolPrice(p: Pool): { asset: Asset; price: string } | null {
  const a = p.asset_a as Asset
  const b = p.asset_b as Asset
  let fpl = ''
  let other = ''
  let asset: Asset | null = null
  if (a === 'FPL' && b in DECIMALS && b !== 'FPL') {
    fpl = p.reserve_a
    other = p.reserve_b
    asset = b
  } else if (b === 'FPL' && a in DECIMALS && a !== 'FPL') {
    fpl = p.reserve_b
    other = p.reserve_a
    asset = a
  }
  if (!asset || other === '0') return null
  const px = (BigInt(fpl) * 10n ** BigInt(DECIMALS[asset])) / BigInt(other)
  if (px <= 0n) return null
  return { asset, price: px.toString() }
}

function priceFor(markets: Market[], pools: Pool[], asset: Asset): string {
  const m = markets.find((x) => x.asset === asset && x.price_fpl !== '0')
  if (m) return m.price_fpl
  for (const p of pools) {
    const q = poolPrice(p)
    if (q && q.asset === asset) return q.price
  }
  return '0'
}

function maxBorrowRaw(asset: Asset, fplSpend: bigint, priceFpl: string, ltvBps: number): bigint {
  if (fplSpend <= 0n || priceFpl === '0') return 0n
  const ltv = BigInt(ltvBps > 0 ? ltvBps : 5000)
  const debtFpl = (fplSpend * ltv) / 10000n
  const scale = 10n ** BigInt(DECIMALS[asset])
  return (debtFpl * scale) / BigInt(priceFpl)
}

function collateralRaw(asset: Asset, amountRaw: bigint, priceFpl: string, ltvBps: number): bigint {
  if (amountRaw <= 0n || priceFpl === '0') return 0n
  const scale = 10n ** BigInt(DECIMALS[asset])
  const debt = (amountRaw * BigInt(priceFpl)) / scale
  if (debt === 0n) return 0n
  const ltv = BigInt(ltvBps > 0 ? ltvBps : 5000)
  return (debt * 10000n + ltv - 1n) / ltv
}

function collateralFor(asset: Asset, human: string, priceFpl: string, ltvBps: number): string | null {
  if (!human.trim() || priceFpl === '0') return null
  let raw: string
  try {
    raw = toRaw(asset, human)
  } catch {
    return null
  }
  const scale = 10n ** BigInt(DECIMALS[asset])
  const debt = (BigInt(raw) * BigInt(priceFpl)) / scale
  if (debt === 0n) return 'That amount is under 1 FPL at this price.'
  const ltv = BigInt(ltvBps > 0 ? ltvBps : 5000)
  const need = (debt * 10000n + ltv - 1n) / ltv
  return `About ${fromRaw('FPL', need.toString())} FPL collateral at ${fromRaw('FPL', priceFpl)} FPL per ${asset}.`
}

function quoteOut(rin: bigint, rout: bigint, amountIn: bigint): bigint {
  if (rin <= 0n || rout <= 0n || amountIn <= 0n) return 0n
  const inn = amountIn * 997n
  return (inn * rout) / (rin * 1000n + inn)
}

function poolSides(p: Pool, tokenIn: string): { rin: bigint; rout: bigint } | null {
  if (p.reserve_a === '0' || p.reserve_b === '0') return null
  if (p.asset_a === tokenIn) return { rin: BigInt(p.reserve_a), rout: BigInt(p.reserve_b) }
  if (p.asset_b === tokenIn) return { rin: BigInt(p.reserve_b), rout: BigInt(p.reserve_a) }
  return null
}

function quoteRoute(pools: Pool[], tokenIn: Asset, tokenOut: Asset, amountIn: bigint): bigint {
  const direct = pools.find((p) => poolSides(p, tokenIn) && (p.asset_a === tokenOut || p.asset_b === tokenOut))
  if (direct) {
    const s = poolSides(direct, tokenIn)!
    return quoteOut(s.rin, s.rout, amountIn)
  }
  if (tokenIn !== 'FPL' && tokenOut !== 'FPL') {
    const mid = quoteRoute(pools, tokenIn, 'FPL', amountIn)
    return quoteRoute(pools, 'FPL', tokenOut, mid)
  }
  return 0n
}

async function submitSigned(tx: { rawJson?: string }, networkKey: string) {
  const res = await fetch('/api/wallet/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tx.rawJson ? { tx_json: tx.rawJson, network: networkKey } : { tx, network: networkKey }),
  })
  const out = (await res.json().catch(() => ({}))) as { error?: string; success?: boolean; message?: string }
  if (!res.ok || out.error) throw new Error(out.error || out.message || 'Submit failed')
  return out
}

function ChoiceBar({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-slate-700/80 bg-slate-950/40">
        {options.map((o) => {
          const on = o.id === value
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.id)}
              className={
                on
                  ? 'bg-sky-500/15 px-1 py-2.5 text-[11px] font-semibold leading-tight text-white sm:text-sm'
                  : 'px-1 py-2.5 text-[11px] font-medium leading-tight text-slate-400 hover:text-slate-200 sm:text-sm'
              }
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PctRow({ onPick, disabled }: { onPick: (pct: number) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {[25, 50, 75, 100].map((pct) => (
        <button
          key={pct}
          type="button"
          disabled={disabled}
          onClick={() => onPick(pct)}
          className="rounded-lg border border-slate-700/80 bg-slate-950/30 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-40"
        >
          {pct === 100 ? 'Max' : `${pct}%`}
        </button>
      ))}
    </div>
  )
}

function AmountField({
  label,
  aside,
  value,
  onChange,
  placeholder,
  readOnly,
  inputMode = 'decimal',
}: {
  label: string
  aside?: string
  value: string
  onChange?: (v: string) => void
  placeholder: string
  readOnly?: boolean
  inputMode?: 'decimal' | 'numeric'
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between gap-3 text-xs text-slate-400">
        <span>{label}</span>
        {aside && <span className="text-right text-slate-500">{aside}</span>}
      </span>
      <input
        className="w-full rounded-xl border border-slate-700/80 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500/70"
        inputMode={inputMode}
        placeholder={placeholder}
        value={value}
        readOnly={readOnly}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      />
    </label>
  )
}

function GhostButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="w-full rounded-xl border border-slate-700 py-2.5 text-sm font-medium text-slate-200 hover:border-slate-500 disabled:opacity-50"
    >
      {children}
    </button>
  )
}

function StatSection({ title, rows }: { title: string; rows: { k: string; v: string }[] }) {
  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</h3>
      <dl className="mt-1 divide-y divide-slate-800/80">
        {rows.map((row) => (
          <div key={row.k} className="flex items-baseline justify-between gap-4 py-2">
            <dt className="shrink-0 text-xs text-slate-500">{row.k}</dt>
            <dd className="text-right text-sm text-slate-100 break-all">{row.v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function slicePct(bal: bigint, pct: number): bigint {
  return (bal * BigInt(pct)) / 100n
}

function capCoin(asset: Asset, rawText: string, maxRaw: bigint): string {
  const cleaned = rawText.trim()
  if (!cleaned) return ''
  let n: bigint
  try {
    n = BigInt(toRaw(asset, cleaned))
  } catch {
    return rawText
  }
  if (n > maxRaw) n = maxRaw
  if (n === 0n) return ''
  return n === BigInt(toRaw(asset, cleaned)) ? cleaned : plainAmount(asset, n.toString())
}

function PoolAdd({
  pools,
  poolId,
  setPoolId,
  amount,
  amountB,
  balances,
  busy,
  onAmounts,
  lpAmount,
  onLpAmount,
  lpBal,
  walletReady,
  onAdd,
  onRemove,
}: {
  pools: Pool[]
  poolId: string
  setPoolId: (id: string) => void
  amount: string
  amountB: string
  balances: Record<Asset, string>
  busy: boolean
  onAmounts: (fAsset: string, fpl: string) => void
  lpAmount: string
  onLpAmount: (v: string) => void
  /** LP tokens this account holds in the selected pool. Null until a wallet is open. */
  lpBal: string | null
  walletReady: boolean
  onAdd: () => void
  onRemove: () => void
}) {
  const choices = poolChoices(pools)
  const pool = pools.find((p) => p.id === poolId) ?? null
  const pair = pool ? poolPair(pool) : null
  const fAsset = pair?.fAsset ?? assetFromPoolId(poolId)
  const fBal = BigInt(fAsset ? balances[fAsset] || '0' : '0')
  const fplBal = BigInt(balances.FPL || '0')

  useEffect(() => {
    if (!pair || !fAsset || !amount.trim()) return
    onFAsset(amount)
    // Recompute the matched FPL once this pool's reserves arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool?.id])

  function fillPct(pct: number) {
    if (!pair || !fAsset) return
    const quote = evenAdd(fBal, fplBal, BigInt(pair.fReserve), BigInt(pair.fplReserve), BigInt(pct * 100))
    onAmounts(
      quote.f === 0n ? '' : plainAmount(fAsset, quote.f.toString()),
      quote.fpl === 0n ? '' : plainAmount('FPL', quote.fpl.toString()),
    )
  }

  const haveLp = BigInt(lpBal || '0')

  function fillLp(pct: number) {
    if (!walletReady || lpBal == null) return
    const cut = (haveLp * BigInt(pct)) / 100n
    onLpAmount(cut === 0n ? '' : cut.toString())
  }

  function onLpTyped(raw: string) {
    const cleaned = raw.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '')
    if (!cleaned) {
      onLpAmount('')
      return
    }
    const n = BigInt(cleaned)
    if (walletReady && lpBal != null && n > haveLp) {
      onLpAmount(haveLp === 0n ? '' : haveLp.toString())
      return
    }
    onLpAmount(cleaned)
  }

  let lpOut: { f: string; fpl: string } | null = null
  if (pair && pool && lpAmount.trim()) {
    try {
      const burn = BigInt(decimalToBaseUnits(lpAmount, 0))
      lpOut = {
        f: coinsFor(pair.fReserve, burn.toString(), pool.lp_supply),
        fpl: coinsFor(pair.fplReserve, burn.toString(), pool.lp_supply),
      }
    } catch {
      lpOut = null
    }
  }

  function onFAsset(raw: string) {
    if (!pair || !fAsset) {
      onAmounts(raw, '')
      return
    }
    const cleaned = raw.trim()
    if (!cleaned) {
      onAmounts('', '')
      return
    }
    let fRaw: bigint
    try {
      fRaw = BigInt(toRaw(fAsset, cleaned))
    } catch {
      onAmounts(raw, '')
      return
    }
    const capped = fRaw > fBal ? fBal : fRaw
    const quote = evenAdd(capped, fplBal, BigInt(pair.fReserve), BigInt(pair.fplReserve), 10000n)
    const unchanged = quote.f === capped
    onAmounts(
      quote.f === 0n ? '' : unchanged ? raw : plainAmount(fAsset, quote.f.toString()),
      quote.fpl === 0n ? '' : plainAmount('FPL', quote.fpl.toString()),
    )
  }

  const name = fAsset ? `${assetLabel(fAsset)} / FPL` : 'Pool'
  return (
    <div className="space-y-4">
      <div className="card space-y-5 p-5">
        <ChoiceBar
          label="Pool"
          value={poolId}
          onChange={setPoolId}
          options={choices.map((c) => ({ id: c.id, label: `${assetLabel(c.asset)} / FPL` }))}
        />
        <section className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Add</h3>
          <AmountField
            label={fAsset ? assetLabel(fAsset) : 'F-asset'}
            aside={fAsset ? `Available ${fromRaw(fAsset, balances[fAsset] || '0')}` : 'Choose a pool'}
            placeholder={fAsset ? `Amount of ${assetLabel(fAsset)}` : 'Choose a pool'}
            value={amount}
            onChange={onFAsset}
          />
          <PctRow onPick={fillPct} disabled={!pair} />
          <AmountField
            label="FPL"
            aside={`Available ${fromRaw('FPL', balances.FPL || '0')}`}
            placeholder="FPL matched to the pool"
            value={amountB}
            readOnly
          />
          <p className="text-[11px] leading-relaxed text-slate-500">
            Max uses the smaller side so the add matches the pool. 2 FPL stays back for the fee.
          </p>
          <button type="button" className="btn-primary" disabled={busy} onClick={onAdd}>Add</button>
        </section>
        <section className="space-y-3 border-t border-slate-800/80 pt-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Remove</h3>
          <AmountField
            label="LP tokens"
            aside={
              walletReady && lpBal != null
                ? `Your balance ${fromRaw('FPL', lpBal)}`
                : 'Sign in to see your LP'
            }
            placeholder={fAsset ? `LP to remove from ${name}` : 'LP tokens to remove'}
            value={lpAmount}
            onChange={onLpTyped}
            inputMode="numeric"
          />
          <PctRow onPick={fillLp} disabled={!walletReady || haveLp === 0n} />
          {lpOut && fAsset && (
            <p className="text-xs text-slate-400">
              Removes about {fromRaw(fAsset, lpOut.f)} {assetLabel(fAsset)} and {fromRaw('FPL', lpOut.fpl)} FPL
            </p>
          )}
          <GhostButton disabled={busy} onClick={onRemove}>Remove LP</GhostButton>
        </section>
      </div>
      <PoolPosition poolId={poolId} pool={pool} lpBal={lpBal} walletReady={walletReady} />
    </div>
  )
}

function PoolPosition({
  poolId,
  pool,
  lpBal,
  walletReady,
}: {
  poolId: string
  pool: Pool | null
  lpBal: string | null
  walletReady: boolean
}) {
  const pair = pool ? poolPair(pool) : null
  const asset = pair?.fAsset ?? assetFromPoolId(poolId)
  const name = asset ? `${assetLabel(asset)} / FPL` : poolId
  const px = pool ? poolPrice(pool) : null
  const supply = pool?.lp_supply || '0'
  const mine = walletReady && lpBal != null ? lpBal : null
  const yoursF = mine != null && pair ? coinsFor(pair.fReserve, mine, supply) : '0'
  const yoursFpl = mine != null && pair ? coinsFor(pair.fplReserve, mine, supply) : '0'
  const you = mine == null ? '—' : undefined
  return (
    <div className="card p-5" data-pool={poolId}>
      <div className="text-sm font-medium text-white">Your pool · {name}</div>
      {!pool || !pair || !asset ? (
        <p className="mt-3 text-xs text-slate-500">Loading this pool…</p>
      ) : (
        <div className="mt-4 space-y-5">
          <StatSection
            title="Pool"
            rows={[
              { k: 'Reserves', v: `${fromRaw(asset, pair.fReserve)} ${assetLabel(asset)}` },
              { k: 'FPL in pool', v: `${fromRaw('FPL', pair.fplReserve)} FPL` },
              { k: 'Price', v: px ? `${fromRaw('FPL', px.price)} FPL per ${assetLabel(asset)}` : '—' },
              { k: 'LP supply', v: fromRaw('FPL', supply) },
            ]}
          />
          <StatSection
            title="You"
            rows={[
              { k: 'LP tokens', v: you ?? fromRaw('FPL', mine!) },
              { k: 'Share', v: you ?? pctText(BigInt(mine!), BigInt(supply || '0')) },
              { k: assetLabel(asset), v: you ?? fromRaw(asset, yoursF) },
              { k: 'FPL', v: you ?? fromRaw('FPL', yoursFpl) },
            ]}
          />
        </div>
      )}
      {pool && mine === '0' && (
        <p className="mt-3 text-xs text-slate-500">You have no LP in this pool.</p>
      )}
    </div>
  )
}

function LendPanel({
  markets,
  pools,
  positions,
  marketId,
  setMarketId,
  balances,
  walletReady,
  busy,
  onAct,
}: {
  markets: Market[]
  pools: Pool[]
  positions: Position[]
  marketId: string
  setMarketId: (id: string) => void
  balances: Record<Asset, string>
  walletReady: boolean
  busy: boolean
  onAct: (kind: 'supply' | 'withdraw' | 'borrow' | 'repay', amount: string, collateral?: string) => Promise<void>
}) {
  const choices = lendChoices(markets)
  const market = markets.find((m) => m.id === marketId) ?? null
  const asset = (market?.asset as Asset) || assetFromLendId(marketId)
  const label = asset ? assetLabel(asset) : 'Market'
  const pos = positions.find((p) => p.market_id === marketId)
  const issued = market
    ? market.share_supply && market.share_supply !== '0'
      ? market.share_supply
      : market.total_supply
    : '0'
  const suppliedRaw = market && pos ? sharesToCoin(pos.shares, market.total_supply, market.share_supply) : '0'
  const debtRaw = pos?.debt || '0'
  const price = asset ? priceFor(markets, pools, asset) : '0'
  const ltv = market?.ltv_bps ?? 5000
  const coinBal = BigInt(asset ? balances[asset] || '0' : '0')
  const fplBal = BigInt(balances.FPL || '0')
  const fplSpend = fplBal > 2n ? fplBal - 2n : 0n
  const liquid =
    market && BigInt(market.total_supply || '0') > BigInt(market.total_borrow || '0')
      ? BigInt(market.total_supply) - BigInt(market.total_borrow)
      : 0n
  const fromCol = asset ? maxBorrowRaw(asset, fplSpend, price, ltv) : 0n
  const borrowCap = fromCol < liquid ? fromCol : liquid

  const [supplyAmt, setSupplyAmt] = useState('')
  const [withdrawAmt, setWithdrawAmt] = useState('')
  const [borrowAmt, setBorrowAmt] = useState('')
  const [repayAmt, setRepayAmt] = useState('')
  const [collateralAmt, setCollateralAmt] = useState('')

  function fillSupply(pct: number) {
    if (!asset) return
    const cut = slicePct(coinBal, pct)
    setSupplyAmt(cut === 0n ? '' : plainAmount(asset, cut.toString()))
  }
  function fillWithdraw(pct: number) {
    if (!asset) return
    const cut = slicePct(BigInt(suppliedRaw || '0'), pct)
    setWithdrawAmt(cut === 0n ? '' : plainAmount(asset, cut.toString()))
  }
  function fillRepay(pct: number) {
    if (!asset) return
    const cut = slicePct(BigInt(debtRaw || '0'), pct)
    setRepayAmt(cut === 0n ? '' : plainAmount(asset, cut.toString()))
  }
  function fillBorrow(pct: number) {
    if (!asset) return
    const cut = slicePct(borrowCap, pct)
    setBorrowAmt(cut === 0n ? '' : plainAmount(asset, cut.toString()))
    const col = collateralRaw(asset, cut, price, ltv)
    setCollateralAmt(col === 0n ? '' : col.toString())
  }
  function onBorrow(raw: string) {
    if (!asset) {
      setBorrowAmt(raw)
      return
    }
    const next = capCoin(asset, raw, borrowCap)
    setBorrowAmt(next)
    try {
      const n = next.trim() ? BigInt(toRaw(asset, next)) : 0n
      const col = collateralRaw(asset, n, price, ltv)
      setCollateralAmt(col === 0n ? '' : col.toString())
    } catch {
      /* keep collateral while the amount is still being typed */
    }
  }

  async function run(kind: 'supply' | 'withdraw' | 'borrow' | 'repay', amount: string, collateral?: string) {
    await onAct(kind, amount, collateral)
    if (kind === 'supply') setSupplyAmt('')
    if (kind === 'withdraw') setWithdrawAmt('')
    if (kind === 'repay') setRepayAmt('')
    if (kind === 'borrow') {
      setBorrowAmt('')
      setCollateralAmt('')
    }
  }

  const borrowHint = asset && borrowAmt.trim() ? collateralFor(asset, borrowAmt, price, ltv) : null
  const yours = walletReady ? undefined : '—'

  return (
    <div className="space-y-4">
      <div className="card space-y-5 p-5">
        <ChoiceBar
          label="Market"
          value={marketId}
          onChange={setMarketId}
          options={choices.map((c) => ({ id: c.id, label: assetLabel(c.asset) }))}
        />
        <section className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Supply</h3>
          <AmountField
            label={label}
            aside={asset ? `Available ${fromRaw(asset, coinBal.toString())}` : 'Sign in to see your balance'}
            placeholder={asset ? `Amount of ${label}` : 'Choose a market'}
            value={supplyAmt}
            onChange={(v) => asset && setSupplyAmt(capCoin(asset, v, coinBal))}
          />
          <PctRow onPick={fillSupply} disabled={!asset || coinBal === 0n} />
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void run('supply', supplyAmt)}>
            Supply
          </button>
        </section>
        <section className="space-y-3 border-t border-slate-800/80 pt-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Withdraw</h3>
          <AmountField
            label={label}
            aside={asset ? `Supplied ${fromRaw(asset, suppliedRaw)}` : ''}
            placeholder={asset ? `Withdraw ${label}` : 'Choose a market'}
            value={withdrawAmt}
            onChange={(v) => asset && setWithdrawAmt(capCoin(asset, v, BigInt(suppliedRaw || '0')))}
          />
          <PctRow onPick={fillWithdraw} disabled={suppliedRaw === '0'} />
          <GhostButton disabled={busy} onClick={() => void run('withdraw', withdrawAmt)}>Withdraw</GhostButton>
        </section>
        <section className="space-y-3 border-t border-slate-800/80 pt-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Borrow</h3>
          <AmountField
            label={label}
            aside={asset && price !== '0' ? `Up to ${fromRaw(asset, borrowCap.toString())}` : 'Waiting for a pool price'}
            placeholder={asset ? `Borrow ${label}` : 'Choose a market'}
            value={borrowAmt}
            onChange={onBorrow}
          />
          <PctRow onPick={fillBorrow} disabled={borrowCap === 0n} />
          <AmountField
            label="FPL collateral"
            aside={`Available ${fromRaw('FPL', fplBal.toString())}`}
            placeholder="FPL locked for this borrow"
            value={collateralAmt}
            onChange={setCollateralAmt}
            inputMode="numeric"
          />
          <p className="text-[11px] leading-relaxed text-slate-500">
            {borrowHint ?? 'Max borrows against your FPL and what the market still has. 2 FPL stays back for the fee.'}
          </p>
          <GhostButton disabled={busy} onClick={() => void run('borrow', borrowAmt, collateralAmt)}>Borrow</GhostButton>
        </section>
        <section className="space-y-3 border-t border-slate-800/80 pt-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Repay</h3>
          <AmountField
            label={label}
            aside={asset ? `Debt ${fromRaw(asset, debtRaw)}` : ''}
            placeholder={asset ? `Repay ${label}` : 'Choose a market'}
            value={repayAmt}
            onChange={(v) => asset && setRepayAmt(capCoin(asset, v, BigInt(debtRaw || '0')))}
          />
          <PctRow onPick={fillRepay} disabled={debtRaw === '0'} />
          <GhostButton disabled={busy} onClick={() => void run('repay', repayAmt)}>Repay</GhostButton>
        </section>
      </div>
      <div className="card p-5" data-market={marketId}>
        <div className="text-sm font-medium text-white">Your market · {label}</div>
        {!market || !asset ? (
          <p className="mt-3 text-xs text-slate-500">Loading this market…</p>
        ) : (
          <div className="mt-4 space-y-5">
            <StatSection
              title="Market"
              rows={[
                { k: 'Supplied', v: `${fromRaw(asset, market.total_supply)} ${label}` },
                { k: 'Borrowed', v: `${fromRaw(asset, market.total_borrow)} ${label}` },
                { k: 'Still available', v: `${fromRaw(asset, liquid.toString())} ${label}` },
                { k: 'Price', v: price !== '0' ? `${fromRaw('FPL', price)} FPL per ${label}` : '—' },
                { k: 'Max LTV', v: `${Math.round(ltv / 100)}%` },
              ]}
            />
            <StatSection
              title="You"
              rows={[
                { k: 'Supplied', v: yours ?? `${fromRaw(asset, suppliedRaw)} ${label}` },
                { k: 'Share', v: yours ?? (pos ? pctText(BigInt(pos.shares || '0'), BigInt(issued || '0')) : '0%') },
                { k: 'Debt', v: yours ?? `${fromRaw(asset, debtRaw)} ${label}` },
                { k: 'Collateral', v: yours ?? `${fromRaw('FPL', pos?.collateral_fpl || '0')} FPL` },
              ]}
            />
          </div>
        )}
        {market && walletReady && suppliedRaw === '0' && debtRaw === '0' && (
          <p className="mt-3 text-xs text-slate-500">You have no supply or debt on this market.</p>
        )}
      </div>
    </div>
  )
}

export default function PlFplMarkets({ mode }: { mode: 'swap' | 'pool' | 'lend' }) {
  const { network } = useNetwork()
  const [wallet, setWallet] = useState<StoredWallet | null>(null)
  const [pools, setPools] = useState<Pool[]>([])
  const [markets, setMarkets] = useState<Market[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [lpRows, setLpRows] = useState<LpPos[]>([])
  const [sell, setSell] = useState<Asset>('FPL')
  const [buy, setBuy] = useState<Asset>('USDC')
  const [poolId, setPoolId] = useState('usdc-fpl')
  const [marketId, setMarketId] = useState('lend-usdc')
  const [amount, setAmount] = useState('')
  const [amountB, setAmountB] = useState('')
  const [lpAmount, setLpAmount] = useState('')
  const [collateral, setCollateral] = useState('')
  const [balances, setBalances] = useState<Record<Asset, string>>({
    FPL: '0',
    BTC: '0',
    ETH: '0',
    USDC: '0',
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    const id = wallet ? plAccountId(wallet) : ''
    const q = id ? `?account=${encodeURIComponent(id)}` : ''
    fetch('/api/pl2300/defi' + q)
      .then((r) => r.json())
      .then((j) => {
        const rows = (j.pools || []) as Record<string, unknown>[]
        const mk = (j.markets || []) as Record<string, unknown>[]
        const pos = (j.positions || []) as Record<string, unknown>[]
        const lps = (j.lp || []) as Record<string, unknown>[]
        setPools(rows.map(asPool))
        setMarkets(mk.map(asMarket))
        setPositions(pos.map(asPosition))
        setLpRows(lps.map(asLp))
      })
      .catch(() => {})
    if (!wallet) return
    const account = plAccountId(wallet)
    fetch(`/api/wallet/account?address=${encodeURIComponent(account)}&network=${encodeURIComponent(network.key)}`)
      .then((r) => r.json())
      .then((j) => {
        const assets = (j.assets || {}) as Record<string, unknown>
        setBalances({
          FPL: digitsOf(j.balance),
          BTC: digitsOf(assets.BTC ?? assets.btc),
          ETH: digitsOf(assets.ETH ?? assets.eth),
          USDC: digitsOf(assets.USDC ?? assets.usdc),
        })
      })
      .catch(() => {})
  }, [wallet, network.key])

  useEffect(() => {
    void loadPrimaryWallet().then(setWallet)
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    const visible = pools.filter((p) => p.id !== 'fpl-btc')
    if (!visible.length) return
    if (!visible.some((p) => p.id === poolId)) setPoolId(visible[0].id)
  }, [pools, poolId])

  useEffect(() => {
    if (!markets.length) return
    const choices = lendChoices(markets)
    if (!choices.some((c) => c.id === marketId)) setMarketId(choices[0].id)
  }, [markets, marketId])

  let quoted = 0n
  if (mode === 'swap' && amount.trim()) {
    try {
      quoted = quoteRoute(pools, sell, buy, BigInt(toRaw(sell, amount)))
    } catch {
      quoted = 0n
    }
  }
  async function act(
    kind: 'swap' | 'add' | 'remove' | 'supply' | 'withdraw' | 'borrow' | 'repay',
    lendAmount?: string,
    lendCollateral?: string,
  ) {
    if (!wallet) {
      setErr('Open the wallet and create an account first.')
      return
    }
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falconSecret = await decryptSeed(wallet.encrypted, keyBytes)
      const account = plAccountId(wallet)
      const seq = await fetchSequenceInfo(account, network.key)
      if (kind === 'swap') {
        if (sell === buy) throw new Error('Pick two different assets')
        const amountIn = toRaw(sell, amount)
        const minOut = quoted > 1n ? quoted - quoted / 50n : 1n
        const tx = await signPlSwapRoute({
          account,
          tokenIn: sell,
          tokenOut: buy,
          amountIn,
          minOut: minOut.toString(),
          sequence: seq.sequence,
          networkId: network.networkId,
          falconSecret,
        })
        await submitSigned(tx, network.key)
        setMsg(`Swap submitted. You receive about ${fromRaw(buy, quoted.toString())} ${buy} if the pool price holds.`)
      } else if (kind === 'add') {
        const pool = pools.find((p) => p.id === poolId)
        if (!pool) throw new Error('Pool not found')
        const pair = poolPair(pool)
        if (!pair) throw new Error('Pool has no FPL side')
        const fRaw = toRaw(pair.fAsset, amount)
        const fplRaw = toRaw('FPL', amountB)
        const tx = await signPlAddLiquidity({
          account,
          poolId,
          amtA: pool.asset_a === 'FPL' ? fplRaw : fRaw,
          amtB: pool.asset_a === 'FPL' ? fRaw : fplRaw,
          sequence: seq.sequence,
          networkId: network.networkId,
          falconSecret,
        })
        await submitSigned(tx, network.key)
        setMsg('Liquidity add submitted.')
      } else if (kind === 'remove') {
        const have = lpRows.find((r) => r.pool_id === poolId)?.lp ?? '0'
        const lpBurn = decimalToBaseUnits(lpAmount, 0)
        if (BigInt(lpBurn) > BigInt(have)) throw new Error('That is more LP than you have in this pool')
        const tx = await signPlRemoveLiquidity({
          account,
          poolId,
          lpBurn,
          sequence: seq.sequence,
          networkId: network.networkId,
          falconSecret,
        })
        await submitSigned(tx, network.key)
        setMsg('Liquidity remove submitted.')
      } else {
        const lendKind =
          kind === 'supply'
            ? 'lend_supply'
            : kind === 'withdraw'
              ? 'lend_withdraw'
              : kind === 'borrow'
                ? 'lend_borrow'
                : 'lend_repay'
        const m = markets.find((x) => x.id === marketId)
        const asset = (m?.asset || assetFromLendId(marketId) || 'USDC') as Asset
        const pos = positions.find((p) => p.market_id === marketId)
        const coin = lendAmount ?? amount
        const raw =
          kind === 'withdraw'
            ? coinToShares(toRaw(asset, coin), m?.total_supply || '0', m?.share_supply || '0', pos?.shares || '0')
            : toRaw(asset, coin)
        const colIn = lendCollateral ?? collateral
        if (kind === 'borrow' && !colIn.trim()) throw new Error('Enter FPL collateral')
        const col = kind === 'borrow' ? decimalToBaseUnits(colIn, 0) : '0'
        const tx = await signPlLend({
          account,
          kind: lendKind,
          marketId,
          amount: raw,
          collateralFpl: col,
          sequence: seq.sequence,
          networkId: network.networkId,
          falconSecret,
        })
        await submitSigned(tx, network.key)
        setMsg(`${kind[0].toUpperCase()}${kind.slice(1)} submitted on ${assetLabel(asset)}.`)
      }
      setAmount('')
      setAmountB('')
      setLpAmount('')
      load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Falcon PL ledger markets. Trades, liquidity, and loans are packed on chain. FBNB is not a market.
      </p>
      {mode === 'swap' && (
        <div className="card p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-400">
              Sell
              <select className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white" value={sell} onChange={(e) => setSell(e.target.value as Asset)}>
                {ASSETS.map((a) => <option key={a}>{a}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Receive
              <select className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white" value={buy} onChange={(e) => setBuy(e.target.value as Asset)}>
                {ASSETS.map((a) => <option key={a}>{a}</option>)}
              </select>
            </label>
          </div>
          <input className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white" placeholder={`Amount of ${sell}`} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <p className="text-xs text-slate-400">
            Quote: {quoted > 0n ? fromRaw(buy, quoted.toString()) : '—'} {buy}
            {sell !== 'FPL' && buy !== 'FPL' ? ' via FPL' : ''}
            {sell !== 'FPL' && priceFor(markets, pools, sell) !== '0'
              ? ` · ${fromRaw('FPL', priceFor(markets, pools, sell))} FPL per ${sell}`
              : ''}
            {buy !== 'FPL' && priceFor(markets, pools, buy) !== '0'
              ? ` · ${fromRaw('FPL', priceFor(markets, pools, buy))} FPL per ${buy}`
              : ''}
          </p>
          <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => act('swap')}>
            {busy ? 'Submitting…' : 'Swap on ledger'}
          </button>
        </div>
      )}
      {mode === 'pool' && (
        <PoolAdd
          pools={pools}
          poolId={poolId}
          setPoolId={(id) => {
            setPoolId(id)
            setAmount('')
            setAmountB('')
            setLpAmount('')
          }}
          amount={amount}
          amountB={amountB}
          balances={balances}
          busy={busy}
          onAmounts={(fAmt, fplAmt) => {
            setAmount(fAmt)
            setAmountB(fplAmt)
          }}
          lpAmount={lpAmount}
          onLpAmount={setLpAmount}
          lpBal={wallet ? (lpRows.find((r) => r.pool_id === poolId)?.lp ?? '0') : null}
          walletReady={Boolean(wallet)}
          onAdd={() => act('add')}
          onRemove={() => act('remove')}
        />
      )}
      {mode === 'lend' && (
        <LendPanel
          key={marketId}
          markets={markets}
          pools={pools}
          positions={positions}
          marketId={marketId}
          setMarketId={setMarketId}
          balances={balances}
          walletReady={Boolean(wallet)}
          busy={busy}
          onAct={(kind, coin, col) => act(kind, coin, col)}
        />
      )}
      {msg && <p className="text-sm text-emerald-300">{msg}</p>}
      {err && <p className="text-sm text-red-300">{err}</p>}
      {mode === 'swap' && (
        <div className="space-y-2">
          {pools.filter((p) => p.id !== 'fpl-btc').map((p) => {
            const px = poolPrice(p)
            return (
              <div key={p.id} className="rounded-xl border border-slate-800 px-3 py-2 text-xs text-slate-400">
                {p.id}: {fromRaw(p.asset_a as Asset, p.reserve_a)} {p.asset_a} / {fromRaw(p.asset_b as Asset, p.reserve_b)} {p.asset_b}
                {px ? ` · ${fromRaw('FPL', px.price)} FPL per ${px.asset}` : ''}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
