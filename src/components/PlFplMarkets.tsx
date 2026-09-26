'use client'

import { useCallback, useEffect, useState } from 'react'
import { useNetwork } from '@/components/NetworkProvider'
import { authenticatePasskey } from '@/lib/passkey'
import { decryptSeed } from '@/lib/wallet-crypto'
import { loadPrimaryWallet, type StoredWallet } from '@/lib/wallet-store'
import { plAccountId } from '@/lib/pl-names'
import {
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
  reserve_a: number
  reserve_b: number
  lp_supply: number
}
type Market = {
  id: string
  asset: string
  total_supply: number
  total_borrow: number
  ltv_bps: number
}

const SCALE: Record<Asset, number> = {
  FPL: 1,
  BTC: 1e8,
  ETH: 1e18,
  USDC: 1e6,
}

function toRaw(asset: Asset, human: number): number {
  return Math.floor(human * SCALE[asset])
}
function fromRaw(asset: Asset, raw: number): string {
  const n = raw / SCALE[asset]
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString(undefined, { maximumFractionDigits: asset === 'BTC' ? 8 : 6 })
}

function quoteOut(rin: bigint, rout: bigint, amountIn: bigint): bigint {
  if (rin <= 0n || rout <= 0n || amountIn <= 0n) return 0n
  const inn = amountIn * 997n
  return (inn * rout) / (rin * 1000n + inn)
}

function poolSides(p: Pool, tokenIn: string): { rin: bigint; rout: bigint } | null {
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

async function submitSigned(tx: unknown, networkKey: string) {
  const res = await fetch('/api/wallet/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx, network: networkKey }),
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
        setPools(j.pools || [])
        setMarkets(j.markets || [])
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    void loadPrimaryWallet().then(setWallet)
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [load])

  const human = parseFloat(amount)
  const quoted =
    mode === 'swap' && Number.isFinite(human) && human > 0
      ? quoteRoute(pools, sell, buy, BigInt(toRaw(sell, human)))
      : 0n

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
      const n = toRaw(kind === 'swap' ? sell : marketAsset() || 'USDC', parseFloat(amount) || 0)
      if (kind === 'swap') {
        if (sell === buy) throw new Error('Pick two different assets')
        const minOut = quoted > 1n ? quoted - quoted / 50n : 1n
        const tx = await signPlSwapRoute({
          account,
          tokenIn: sell,
          tokenOut: buy,
          amountIn: toRaw(sell, parseFloat(amount)),
          minOut: Number(minOut),
          sequence: seq.sequence,
          networkId: network.networkId,
          falconSecret,
        })
        await submitSigned(tx, network.key)
        setMsg(`Swap submitted. You receive about ${fromRaw(buy, Number(quoted))} ${buy} if the pool price holds.`)
      } else if (kind === 'add') {
        const pool = pools.find((p) => p.id === poolId)
        if (!pool) throw new Error('Pool not found')
        const tx = await signPlAddLiquidity({
          account,
          poolId,
          amtA: toRaw(pool.asset_a as Asset, parseFloat(amount) || 0),
          amtB: toRaw(pool.asset_b as Asset, parseFloat(amountB) || 0),
          sequence: seq.sequence,
          networkId: network.networkId,
          falconSecret,
        })
        await submitSigned(tx, network.key)
        setMsg('Liquidity add submitted.')
      } else if (kind === 'remove') {
        const tx = await signPlRemoveLiquidity({
          account,
          poolId,
          lpBurn: Math.floor(parseFloat(amount) || 0),
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
        const raw = kind === 'withdraw' ? Math.floor(parseFloat(amount) || 0) : toRaw(asset, parseFloat(amount) || 0)
        const tx = await signPlLend({
          account,
          kind: lendKind,
          marketId,
          amount: raw,
          collateralFpl: Math.floor(parseFloat(collateral) || 0),
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

  function marketAsset(): Asset | null {
    const m = markets.find((x) => x.id === marketId)
    return (m?.asset as Asset) || null
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
            Quote: {quoted > 0n ? fromRaw(buy, Number(quoted)) : '—'} {buy}
            {sell !== 'FPL' && buy !== 'FPL' ? ' via FPL' : ''}
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
          {pools.filter((p) => p.id === poolId).map((p) => (
            <p key={p.id} className="text-xs text-slate-400">
              Reserves {fromRaw(p.asset_a as Asset, p.reserve_a)} {p.asset_a} · {fromRaw(p.asset_b as Asset, p.reserve_b)} {p.asset_b}
            </p>
          ))}
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
              {markets.map((m) => <option key={m.id} value={m.id}>{m.asset} · supply {m.total_supply} borrowed {m.total_borrow}</option>)}
            </select>
          </label>
          <input className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white" placeholder="Amount (withdraw = share count)" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white" placeholder="FPL collateral (borrow only)" value={collateral} onChange={(e) => setCollateral(e.target.value)} />
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
        {pools.filter((p) => p.id !== 'fpl-btc').map((p) => (
          <div key={p.id} className="rounded-xl border border-slate-800 px-3 py-2 text-xs text-slate-400">
            {p.id}: {fromRaw(p.asset_a as Asset, p.reserve_a)} {p.asset_a} / {fromRaw(p.asset_b as Asset, p.reserve_b)} {p.asset_b}
          </div>
        ))}
      </div>
    </div>
  )
}
