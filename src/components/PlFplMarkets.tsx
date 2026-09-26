'use client'

import { useCallback, useEffect, useState } from 'react'
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
  ltv_bps: number
  price_fpl: string
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
  return {
    id: String(row.id ?? ''),
    asset: String(row.asset ?? ''),
    total_supply: digitsOf(row.total_supply),
    total_borrow: digitsOf(row.total_borrow),
    ltv_bps: Number(row.ltv_bps ?? 5000) || 5000,
    price_fpl: digitsOf(row.price_fpl),
  }
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

export default function PlFplMarkets({ mode }: { mode: 'swap' | 'pool' | 'lend' }) {
  const { network } = useNetwork()
  const [wallet, setWallet] = useState<StoredWallet | null>(null)
  const [pools, setPools] = useState<Pool[]>([])
  const [markets, setMarkets] = useState<Market[]>([])
  const [sell, setSell] = useState<Asset>('FPL')
  const [buy, setBuy] = useState<Asset>('USDC')
  const [poolId, setPoolId] = useState('usdc-fpl')
  const [marketId, setMarketId] = useState('lend-usdc')
  const [amount, setAmount] = useState('')
  const [amountB, setAmountB] = useState('')
  const [collateral, setCollateral] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/pl2300/defi')
      .then((r) => r.json())
      .then((j) => {
        const rows = (j.pools || []) as Record<string, unknown>[]
        const mk = (j.markets || []) as Record<string, unknown>[]
        setPools(rows.map(asPool))
        setMarkets(mk.map(asMarket))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    void loadPrimaryWallet().then(setWallet)
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [load])

  let quoted = 0n
  if (mode === 'swap' && amount.trim()) {
    try {
      quoted = quoteRoute(pools, sell, buy, BigInt(toRaw(sell, amount)))
    } catch {
      quoted = 0n
    }
  }
  const lendMarket = markets.find((m) => m.id === marketId)
  const lendAsset = (lendMarket?.asset as Asset) || null
  const lendHint =
    mode === 'lend' && lendAsset && lendAsset !== 'FPL'
      ? collateralFor(lendAsset, amount, priceFor(markets, pools, lendAsset), lendMarket?.ltv_bps ?? 5000)
      : null

  async function act(kind: 'swap' | 'add' | 'remove' | 'supply' | 'withdraw' | 'borrow' | 'repay') {
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
        const tx = await signPlAddLiquidity({
          account,
          poolId,
          amtA: toRaw(pool.asset_a as Asset, amount),
          amtB: toRaw(pool.asset_b as Asset, amountB),
          sequence: seq.sequence,
          networkId: network.networkId,
          falconSecret,
        })
        await submitSigned(tx, network.key)
        setMsg('Liquidity add submitted.')
      } else if (kind === 'remove') {
        const lpBurn = decimalToBaseUnits(amount, 0)
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
        const asset = (m?.asset || 'USDC') as Asset
        const raw = kind === 'withdraw' ? decimalToBaseUnits(amount, 0) : toRaw(asset, amount)
        const col = kind === 'borrow' ? decimalToBaseUnits(collateral || '0', 0) : '0'
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
        setMsg(`${kind} submitted on ${marketId}.`)
      }
      setAmount('')
      setAmountB('')
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
        <div className="card p-5 space-y-3">
          <label className="text-xs text-slate-400">
            Pool
            <select className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white" value={poolId} onChange={(e) => setPoolId(e.target.value)}>
              {pools.filter((p) => p.id !== 'fpl-btc').map((p) => (
                <option key={p.id} value={p.id}>{p.asset_a} / {p.asset_b}</option>
              ))}
            </select>
          </label>
          {pools.filter((p) => p.id === poolId).map((p) => {
            const px = poolPrice(p)
            return (
              <p key={p.id} className="text-xs text-slate-400">
                Reserves {fromRaw(p.asset_a as Asset, p.reserve_a)} {p.asset_a} · {fromRaw(p.asset_b as Asset, p.reserve_b)} {p.asset_b}
                {px ? ` · ${fromRaw('FPL', px.price)} FPL per ${px.asset}` : ''}
              </p>
            )
          })}
          <input className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white" placeholder="Amount of first asset (FPL side)" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white" placeholder="Amount of second asset" value={amountB} onChange={(e) => setAmountB(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className="btn-primary flex-1" disabled={busy} onClick={() => act('add')}>Add</button>
            <button type="button" className="flex-1 rounded-xl border border-slate-600 py-2 text-sm" disabled={busy} onClick={() => act('remove')}>Remove LP</button>
          </div>
          <p className="text-[11px] text-slate-500">Remove uses the LP token count, not the coin amount.</p>
        </div>
      )}
      {mode === 'lend' && (
        <div className="card p-5 space-y-3">
          <label className="text-xs text-slate-400">
            Market
            <select className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white" value={marketId} onChange={(e) => setMarketId(e.target.value)}>
              {markets.map((m) => <option key={m.id} value={m.id}>{m.asset}</option>)}
            </select>
          </label>
          {lendMarket && lendAsset && (
            <p className="text-xs text-slate-400">
              {lendMarket.price_fpl !== '0' ? `${fromRaw('FPL', lendMarket.price_fpl)} FPL per ${lendAsset}. ` : ''}
              Supply {fromRaw(lendAsset, lendMarket.total_supply)} {lendAsset}. Borrowed {fromRaw(lendAsset, lendMarket.total_borrow)} {lendAsset}.
            </p>
          )}
          <input className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white" placeholder="Amount (withdraw = share count)" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white" placeholder="FPL collateral (borrow only)" value={collateral} onChange={(e) => setCollateral(e.target.value)} />
          {lendHint && <p className="text-xs text-slate-400">{lendHint}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => act('supply')}>Supply</button>
            <button type="button" className="rounded-xl border border-slate-600 py-2 text-sm" disabled={busy} onClick={() => act('withdraw')}>Withdraw</button>
            <button type="button" className="rounded-xl border border-slate-600 py-2 text-sm" disabled={busy} onClick={() => act('borrow')}>Borrow</button>
            <button type="button" className="rounded-xl border border-slate-600 py-2 text-sm" disabled={busy} onClick={() => act('repay')}>Repay</button>
          </div>
        </div>
      )}
      {msg && <p className="text-sm text-emerald-300">{msg}</p>}
      {err && <p className="text-sm text-red-300">{err}</p>}
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
    </div>
  )
}
