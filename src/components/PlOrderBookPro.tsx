// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'

/**
 * Falcon PL 2300 "Pro" trading: on-ledger order book (fd-pl 2.10.4).
 * Ladder + recent trades from /api/v1/explorer/orderbook/[pair](/trades), account orders/fills,
 * and a limit / market order form that signs PlaceLimitOrder / CancelOrder / SwapRoute in the browser.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNetwork } from '@/components/NetworkProvider'
import { authenticatePasskey } from '@/lib/passkey'
import { decryptSeed } from '@/lib/wallet-crypto'
import { loadPrimaryWallet, type StoredWallet } from '@/lib/wallet-store'
import { plAccountId } from '@/lib/pl-names'
import { signPlCancelOrder, signPlPay, signPlPlaceLimitOrder, signPlSwapRoute } from '@/lib/pl-wallet-sign'
import { fetchSequenceInfo } from '@/lib/wallet-submit'
import { explainTxError } from '@/lib/pl-key-commit'
import {
  BOOK_ASSETS,
  BOOK_DECIMALS,
  MAX_OPEN_ORDERS_PER_ACCOUNT,
  MIN_ORDER_QUOTE,
  ORDERBOOK_ACTIVATION_HEIGHT,
  amountForPct,
  bookAssetLabel,
  classifyBookResponse,
  cumulative,
  fromRawDigits,
  pairOf,
  parseLevels,
  planLimitOrder,
  spreadOf,
  toRawDigits,
  type BookAsset,
  type BookState,
  type Level,
} from '@/lib/pl-orderbook'

type Amt = { raw: string; value: string } | undefined
type Trade = { height: number; side: string; price: Amt; amount: Amt; total: Amt; taker: string; maker: string }
type OpenOrder = { id: number; pair: string; side: string; price: Amt; amount: Amt; remaining: Amt; placed_height: number; expiry_height: number | null }
type Pool = { asset_a: string; asset_b: string; reserve_a: string; reserve_b: string }

const POLL_MS = 5_000
const SUBMIT_TIMEOUT_MS = 45_000

const raw = (a: Amt) => (a && /^\d+$/.test(a.raw) ? BigInt(a.raw) : 0n)
const fmtBase = (asset: string, v: bigint | string, frac = 6) => fromRawDigits(v, BOOK_DECIMALS[asset as BookAsset] ?? 0, frac)
const fmtFpl = (v: bigint | string) => fromRawDigits(v, 0)

function digits(v: unknown): bigint {
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v)
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v)
  return 0n
}

function poolFor(pools: Pool[], asset: BookAsset): { base: bigint; fpl: bigint } | null {
  for (const p of pools) {
    if (p.asset_a === asset && p.asset_b === 'FPL') return { base: digits(p.reserve_a), fpl: digits(p.reserve_b) }
    if (p.asset_b === asset && p.asset_a === 'FPL') return { base: digits(p.reserve_b), fpl: digits(p.reserve_a) }
  }
  return null
}

function ammOut(rin: bigint, rout: bigint, x: bigint): bigint {
  if (rin <= 0n || rout <= 0n || x <= 0n) return 0n
  const inn = x * 997n
  return (inn * rout) / (rin * 1000n + inn)
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const r = await fetch(url, { cache: 'no-store' })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

async function submitSigned(tx: { rawJson?: string }, networkKey: string) {
  let res: Response
  try {
    res = await fetch('/api/wallet/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tx.rawJson ? { tx_json: tx.rawJson, network: networkKey } : { tx, network: networkKey }),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    })
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new Error('The network did not answer within 45 s. Check your orders before retrying: the transaction may still land.')
    }
    throw e
  }
  const out = (await res.json().catch(() => ({}))) as { error?: string; success?: boolean; message?: string }
  if (!res.ok || out.error || out.success === false) throw new Error(out.error || out.message || `Submit failed (HTTP ${res.status})`)
  return out
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out. Try again.`)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

function Tabs<T extends string>({ value, options, onChange, className = '' }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={`flex gap-1 rounded-lg bg-slate-950/50 p-1 text-xs ${className}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={o.id === value}
          onClick={() => onChange(o.id)}
          className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${o.id === value ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function InactiveNotice({ state }: { state: BookState }) {
  if (state === 'live' || state === 'loading') return null
  const text =
    state === 'unavailable'
      ? 'Order book not active yet. The ledger has the order book from height 800,000, but this site cannot read it yet. Market orders still work through the AMM.'
      : state === 'inactive'
        ? `Order book not active yet on this ledger (activates at height ${ORDERBOOK_ACTIVATION_HEIGHT.toLocaleString()}). Market orders still work through the AMM.`
        : 'Order book data is unavailable right now. Retrying…'
  return (
    <div className="card border border-amber-500/20 p-3 text-xs text-amber-300" role="status">
      {text}
    </div>
  )
}

function Ladder({ asset, bids, asks, onPick, state }: { asset: BookAsset; bids: Level[]; asks: Level[]; onPick: (price: bigint) => void; state: BookState }) {
  const rows = 12
  const a = asks.slice(0, rows)
  const b = bids.slice(0, rows)
  const ca = cumulative(a)
  const cb = cumulative(b)
  const max = [...ca, ...cb].reduce((m, v) => (v > m ? v : m), 0n)
  const pct = (v: bigint) => (max > 0n ? Number((v * 1000n) / max) / 10 : 0)
  const sp = spreadOf(bids, asks)
  const Row = ({ l, cum, side }: { l: Level; cum: bigint; side: 'bid' | 'ask' }) => (
    <button
      type="button"
      onClick={() => onPick(l.price)}
      className="relative grid w-full grid-cols-3 px-2 py-[3px] text-right font-mono text-[11px] tabular-nums hover:bg-slate-800/60"
      title={`${l.orders} order${l.orders === 1 ? '' : 's'}`}
    >
      <span
        aria-hidden
        className={`absolute inset-y-0 right-0 ${side === 'bid' ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}
        style={{ width: `${pct(cum)}%` }}
      />
      <span className={`relative text-left ${side === 'bid' ? 'text-emerald-400' : 'text-red-400'}`}>{fmtFpl(l.price)}</span>
      <span className="relative text-slate-200">{fmtBase(asset, l.amount, 6)}</span>
      <span className="relative text-slate-400">{fmtFpl(l.total)}</span>
    </button>
  )
  return (
    <div className="text-xs">
      <div className="grid grid-cols-3 px-2 pb-1 text-right text-[10px] uppercase tracking-wider text-slate-500">
        <span className="text-left">Price (FPL)</span>
        <span>Size ({bookAssetLabel(asset)})</span>
        <span>Total (FPL)</span>
      </div>
      <div className="flex min-h-[180px] flex-col justify-end">
        {a.length === 0 && <div className="py-6 text-center text-slate-600">{state === 'live' ? 'No asks' : '—'}</div>}
        {[...a].reverse().map((l, i) => (
          <Row key={`a${l.price}`} l={l} cum={ca[a.length - 1 - i]} side="ask" />
        ))}
      </div>
      <div className="my-1 flex items-center justify-between border-y border-slate-800 px-2 py-1.5 font-mono text-[11px] tabular-nums">
        <span className="text-slate-500">Spread</span>
        <span className="text-slate-300">
          {sp.spread != null ? `${fmtFpl(sp.spread)} FPL${sp.bps != null ? ` (${(sp.bps / 100).toFixed(2)}%)` : ''}` : '—'}
        </span>
      </div>
      <div className="min-h-[180px]">
        {b.length === 0 && <div className="py-6 text-center text-slate-600">{state === 'live' ? 'No bids' : '—'}</div>}
        {b.map((l, i) => (
          <Row key={`b${l.price}`} l={l} cum={cb[i]} side="bid" />
        ))}
      </div>
    </div>
  )
}

function Trades({ asset, trades, state }: { asset: BookAsset; trades: Trade[]; state: BookState }) {
  return (
    <div className="text-xs">
      <div className="grid grid-cols-3 px-2 pb-1 text-right text-[10px] uppercase tracking-wider text-slate-500">
        <span className="text-left">Price (FPL)</span>
        <span>Size</span>
        <span>Block</span>
      </div>
      {trades.length === 0 && <div className="py-6 text-center text-slate-600">{state === 'live' ? 'No trades yet' : '—'}</div>}
      <div className="max-h-[400px] overflow-y-auto">
        {trades.slice(0, 40).map((t, i) => (
          <div key={`${t.height}:${i}`} className="grid grid-cols-3 px-2 py-[3px] text-right font-mono text-[11px] tabular-nums">
            <span className={`text-left ${t.side === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmtFpl(raw(t.price))}
              {t.maker.startsWith('amm:') && <span className="ml-1 text-[9px] text-cyan-500">AMM</span>}
            </span>
            <span className="text-slate-200">{fmtBase(asset, raw(t.amount), 6)}</span>
            <span className="text-slate-500">{t.height.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PlOrderBookPro() {
  const { network } = useNetwork()
  const [asset, setAsset] = useState<BookAsset>('USDC')
  const pair = pairOf(asset)
  const [wallet, setWallet] = useState<StoredWallet | null>(null)
  const account = wallet ? plAccountId(wallet) : ''

  const [bookState, setBookState] = useState<BookState>('loading')
  const [bids, setBids] = useState<Level[]>([])
  const [asks, setAsks] = useState<Level[]>([])
  const [trades, setTrades] = useState<Trade[]>([])
  const [orders, setOrders] = useState<OpenOrder[]>([])
  const [fills, setFills] = useState<Trade[]>([])
  const [pools, setPools] = useState<Pool[]>([])
  const [tip, setTip] = useState<number | null>(null)
  const [fpl, setFpl] = useState(0n)
  const [bal, setBal] = useState<Record<BookAsset, bigint>>({ USDC: 0n, ETH: 0n, BTC4: 0n })

  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [kind, setKind] = useState<'limit' | 'market'>('limit')
  const [price, setPrice] = useState('')
  const [amount, setAmount] = useState('')
  const [expiry, setExpiry] = useState('')
  const [bottom, setBottom] = useState<'open' | 'fills'>('open')
  const [mobilePane, setMobilePane] = useState<'book' | 'trades'>('book')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void loadPrimaryWallet().then(setWallet)
  }, [])

  const loadMarket = useCallback(async () => {
    try {
      const [book, tr] = await Promise.all([
        getJson(`/api/v1/explorer/orderbook/${pair}?levels=50`),
        getJson(`/api/v1/explorer/orderbook/${pair}/trades?limit=50`),
      ])
      const st = classifyBookResponse(book.status, book.body)
      setBookState(st)
      const b = (book.body ?? {}) as { bids?: unknown; asks?: unknown }
      setBids(st === 'live' ? parseLevels(b.bids) : [])
      setAsks(st === 'live' ? parseLevels(b.asks) : [])
      const t = (tr.body ?? {}) as { items?: Trade[] }
      setTrades(classifyBookResponse(tr.status, tr.body) === 'live' && Array.isArray(t.items) ? t.items : [])
    } catch {
      setBookState('error')
    }
  }, [pair])

  const loadAccount = useCallback(async () => {
    fetch('/api/pl2300/defi', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setPools(((j.pools || []) as Record<string, unknown>[]).map((p) => ({
        asset_a: String(p.asset_a ?? ''), asset_b: String(p.asset_b ?? ''),
        reserve_a: String(p.reserve_a ?? '0'), reserve_b: String(p.reserve_b ?? '0'),
      }))))
      .catch(() => {})
    getJson('/api/v1/explorer/blocks/latest')
      .then(({ body }) => {
        const h = Number((body as { height?: unknown }).height)
        if (Number.isFinite(h) && h > 0) setTip(h)
      })
      .catch(() => {})
    if (!account) return
    fetch(`/api/wallet/account?address=${encodeURIComponent(account)}&network=${encodeURIComponent(network.key)}`)
      .then((r) => r.json())
      .then((j) => {
        const a = (j.assets || {}) as Record<string, unknown>
        setFpl(digits(j.balance))
        setBal({ USDC: digits(a.USDC ?? a.usdc), ETH: digits(a.ETH ?? a.eth), BTC4: digits(a.BTC4) })
      })
      .catch(() => {})
    const [o, f] = await Promise.all([
      getJson(`/api/v1/explorer/accounts/${encodeURIComponent(account)}/orders`).catch(() => null),
      getJson(`/api/v1/explorer/trades?account=${encodeURIComponent(account)}&limit=50`).catch(() => null),
    ])
    const ob = (o?.body ?? {}) as { orders?: OpenOrder[] }
    setOrders(o && classifyBookResponse(o.status, o.body) === 'live' && Array.isArray(ob.orders) ? ob.orders : [])
    const fb = (f?.body ?? {}) as { items?: Trade[] }
    setFills(f && classifyBookResponse(f.status, f.body) === 'live' && Array.isArray(fb.items) ? fb.items : [])
  }, [account, network.key])

  useEffect(() => {
    void loadMarket()
    const t = setInterval(() => void loadMarket(), POLL_MS)
    return () => clearInterval(t)
  }, [loadMarket])

  useEffect(() => {
    void loadAccount()
    const t = setInterval(() => void loadAccount(), POLL_MS * 3)
    return () => clearInterval(t)
  }, [loadAccount])

  const pool = poolFor(pools, asset)
  const spot = pool && pool.base > 0n ? (pool.fpl * 10n ** BigInt(BOOK_DECIMALS[asset])) / pool.base : null
  const sp = spreadOf(bids, asks)
  const bookLive = bookState === 'live'

  const plan = useMemo(() => {
    if (kind !== 'limit' || !price || !amount) return null
    try {
      return { ok: planLimitOrder({ asset, side, price, amount, expiryBlocks: expiry, tipHeight: tip, openOrders: orders.length, fplBalance: fpl, assetBalance: bal[asset] }) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Invalid order' }
    }
  }, [kind, asset, side, price, amount, expiry, tip, orders.length, fpl, bal])

  /** Market order: SwapRoute FPL↔asset (ledger routes it through book + AMM, best of both). */
  const market = useMemo(() => {
    if (kind !== 'market' || !amount || !pool) return null
    try {
      if (side === 'buy') {
        const spend = BigInt(toRawDigits(amount, 0))
        return { amountIn: spend, out: ammOut(pool.fpl, pool.base, spend) }
      }
      const sell = BigInt(toRawDigits(amount, BOOK_DECIMALS[asset]))
      return { amountIn: sell, out: ammOut(pool.base, pool.fpl, sell) }
    } catch {
      return null
    }
  }, [kind, amount, pool, side, asset])

  const avail = side === 'buy' ? `${fmtFpl(fpl)} FPL` : `${fmtBase(asset, bal[asset], 8)} ${bookAssetLabel(asset)}`

  function pickPct(p: number) {
    if (kind === 'market') {
      const v = side === 'buy' ? (fpl * BigInt(p)) / 100n : (bal[asset] * BigInt(p)) / 100n
      setAmount(side === 'buy' ? v.toString() : fromRawDigits(v, BOOK_DECIMALS[asset]).replace(/,/g, ''))
      return
    }
    setAmount(amountForPct(asset, side, p, price || (spot ? spot.toString() : ''), fpl, bal[asset]))
    if (!price && spot) setPrice(spot.toString())
  }

  async function run(label: string, build: (falconSecret: string, account: string, sequence: number) => Promise<{ rawJson?: string }>) {
    if (!wallet) return
    setBusy(true)
    setErr(null)
    setMsg(null)
    setStage('Confirm with your passkey…')
    try {
      const { keyBytes } = await withTimeout(authenticatePasskey(wallet.credentialId, wallet.hasPrf), 90_000, 'Passkey confirmation')
      setStage('Preparing…')
      const falconSecret = await decryptSeed(wallet.encrypted, keyBytes)
      const acct = plAccountId(wallet)
      const seq = await withTimeout(fetchSequenceInfo(acct, network.key), 20_000, 'Loading your account')
      const included = async (after: number) => {
        for (let i = 0; i < 12; i++) {
          setStage(`Waiting for inclusion… ${((i + 1) * 2.5) | 0}s`)
          await new Promise((r) => setTimeout(r, 2500))
          const s = await fetchSequenceInfo(acct, network.key).catch(() => null)
          if (s && s.sequence > after) return
        }
        throw new Error('Accepted by the node but not included after 30 s, so nothing moved yet.')
      }
      setStage('Submitting…')
      try {
        await submitSigned(await build(falconSecret, acct, seq.sequence), network.key)
        await included(seq.sequence)
      } catch (e) {
        if (!/unknown key/i.test(e instanceof Error ? e.message : String(e))) throw e
        // Seat restarted and forgot the key: re-enroll with a zero self-Pay, then retry at seq+1.
        const enroll = await signPlPay({ account: acct, destination: acct, amount: 0, sequence: seq.sequence, fee: 2, networkId: network.networkId, falconSecret })
        await submitSigned(enroll, network.key)
        await submitSigned(await build(falconSecret, acct, seq.sequence + 1), network.key)
        await included(seq.sequence + 1)
      }
      setMsg(label)
      setAmount('')
      void loadMarket()
      void loadAccount()
    } catch (e) {
      setErr(e instanceof Error ? explainTxError(e.message) : 'Failed')
    } finally {
      setStage(null)
      setBusy(false)
    }
  }

  function submit() {
    if (kind === 'limit') {
      if (!plan || 'error' in plan || !plan.ok) return
      const p = plan.ok
      void run(
        `${p.side === 'buy' ? 'Buy' : 'Sell'} order placed: ${fmtBase(asset, p.amountRaw, 8)} ${bookAssetLabel(asset)} @ ${fmtFpl(p.priceRaw)} FPL.`,
        (falconSecret, acct, sequence) =>
          signPlPlaceLimitOrder({ account: acct, pair: p.pair, side: p.side, price: p.priceRaw, amount: p.amountRaw, expiryHeight: p.expiryHeight, sequence, networkId: network.networkId, falconSecret }),
      )
      return
    }
    if (!market || market.amountIn <= 0n) return
    const bal0 = side === 'buy' ? fpl : bal[asset]
    if (market.amountIn > bal0) {
      setErr('Not enough balance for this order')
      return
    }
    const minOut = market.out > 1n ? market.out - market.out / 50n : 1n
    void run(`Market ${side} submitted.`, (falconSecret, acct, sequence) =>
      signPlSwapRoute({
        account: acct,
        tokenIn: side === 'buy' ? 'FPL' : asset,
        tokenOut: side === 'buy' ? asset : 'FPL',
        amountIn: market.amountIn.toString(),
        minOut: minOut.toString(),
        sequence,
        networkId: network.networkId,
        falconSecret,
      }),
    )
  }

  function cancel(o: OpenOrder) {
    void run(`Cancel sent for order #${o.id}.`, (falconSecret, acct, sequence) =>
      signPlCancelOrder({ account: acct, orderId: String(o.id), sequence, networkId: network.networkId, falconSecret }),
    )
  }

  const limitDisabled = !bookLive
  const canSubmit = !!wallet && !busy && (kind === 'limit' ? !limitDisabled && !!plan && 'ok' in plan : !!market && market.amountIn > 0n)

  return (
    <div className="space-y-4">
      {/* Market header */}
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
        <label className="flex items-center gap-2">
          <span className="sr-only">Pair</span>
          <select
            value={asset}
            onChange={(e) => { setAsset(e.target.value as BookAsset); setPrice(''); setAmount('') }}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
          >
            {BOOK_ASSETS.map((a) => (
              <option key={a} value={a}>{bookAssetLabel(a)} / FPL</option>
            ))}
          </select>
        </label>
        <Stat label="AMM spot" value={spot != null ? `${fmtFpl(spot)} FPL` : '—'} />
        <Stat label="Best bid" value={sp.bid != null ? fmtFpl(sp.bid) : '—'} tone="text-emerald-400" />
        <Stat label="Best ask" value={sp.ask != null ? fmtFpl(sp.ask) : '—'} tone="text-red-400" />
        <Stat label="Last" value={trades[0] ? fmtFpl(raw(trades[0].price)) : '—'} />
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${bookLive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
          {bookLive ? 'Book live' : 'Book offline'}
        </span>
      </div>

      <InactiveNotice state={bookState} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px_minmax(0,1fr)]">
        {/* Order form: first on mobile */}
        <div className="card order-first space-y-3 p-4 lg:order-none lg:col-start-2 lg:row-start-1">
          <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-slate-700 text-sm font-semibold">
            <button type="button" onClick={() => setSide('buy')} className={`py-2 ${side === 'buy' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400'}`}>Buy</button>
            <button type="button" onClick={() => setSide('sell')} className={`py-2 ${side === 'sell' ? 'bg-red-500/20 text-red-300' : 'text-slate-400'}`}>Sell</button>
          </div>
          <Tabs value={kind} onChange={(v) => { setKind(v); setAmount('') }} options={[{ id: 'limit', label: 'Limit' }, { id: 'market', label: 'Market' }]} />
          <div className="flex justify-between text-[11px] text-slate-500">
            <span>Available</span>
            <span className="font-mono text-slate-300">{wallet ? avail : '—'}</span>
          </div>
          {kind === 'limit' && (
            <Field label="Price" unit="FPL" value={price} onChange={setPrice} placeholder={spot ? spot.toString() : '0'} inputMode="numeric" />
          )}
          <Field
            label={kind === 'market' && side === 'buy' ? 'Spend' : 'Amount'}
            unit={kind === 'market' && side === 'buy' ? 'FPL' : bookAssetLabel(asset)}
            value={amount}
            onChange={setAmount}
            placeholder="0"
            inputMode="decimal"
          />
          <div className="grid grid-cols-4 gap-1">
            {[25, 50, 75, 100].map((p) => (
              <button key={p} type="button" disabled={!wallet} onClick={() => pickPct(p)} className="rounded-md border border-slate-700 py-1 text-[11px] text-slate-300 hover:border-slate-500 disabled:opacity-40">
                {p}%
              </button>
            ))}
          </div>
          {kind === 'limit' && (
            <Field label="Expires in" unit="blocks" value={expiry} onChange={setExpiry} placeholder="Good till cancelled" inputMode="numeric" />
          )}
          <div className="space-y-1 rounded-lg bg-slate-950/40 p-2 text-[11px] text-slate-400">
            {kind === 'limit' ? (
              <>
                <Line k="Order value" v={plan && 'ok' in plan && plan.ok ? `${fmtFpl(plan.ok.quoteRaw)} FPL` : '—'} />
                <Line k="Escrow" v={plan && 'ok' in plan && plan.ok ? `${plan.ok.escrowAsset === 'FPL' ? fmtFpl(plan.ok.escrowRaw) : fmtBase(asset, plan.ok.escrowRaw, 8)} ${bookAssetLabel(plan.ok.escrowAsset)}` : '—'} />
                <Line k="Open orders" v={`${orders.length} / ${MAX_OPEN_ORDERS_PER_ACCOUNT}`} />
                <Line k="Min order" v={`${MIN_ORDER_QUOTE.toString()} FPL`} />
              </>
            ) : (
              <>
                <Line k="Est. receive" v={market ? (side === 'buy' ? `${fmtBase(asset, market.out, 8)} ${bookAssetLabel(asset)}` : `${fmtFpl(market.out)} FPL`) : '—'} />
                <Line k="Max slippage" v="2%" />
                <Line k="Route" v="Best of book + AMM" />
              </>
            )}
            <Line k="Network fee" v="2 FPL" />
          </div>
          {kind === 'limit' && plan && 'error' in plan && <p className="text-[11px] text-amber-400">{plan.error}</p>}
          {kind === 'limit' && limitDisabled && <p className="text-[11px] text-slate-500">Limit orders open when the order book is live.</p>}
          {!wallet ? (
            <a href="/wallet" className="block w-full rounded-xl bg-slate-800 py-2.5 text-center text-sm font-medium text-slate-200">Open wallet to trade</a>
          ) : (
            <button
              type="button"
              disabled={!canSubmit}
              onClick={submit}
              className={`w-full rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-40 ${side === 'buy' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'}`}
            >
              {busy ? stage ?? 'Working…' : `${side === 'buy' ? 'Buy' : 'Sell'} ${bookAssetLabel(asset)}`}
            </button>
          )}
          {msg && <p className="text-[11px] text-emerald-400">{msg}</p>}
          {err && <p className="text-[11px] text-red-400">{err}</p>}
        </div>

        {/* Book: desktop left, mobile tabbed with trades */}
        <div className="card p-3 lg:col-start-1 lg:row-start-1">
          <Tabs className="mb-3 lg:hidden" value={mobilePane} onChange={setMobilePane} options={[{ id: 'book', label: 'Order book' }, { id: 'trades', label: 'Trades' }]} />
          <h3 className="mb-2 hidden text-xs font-semibold uppercase tracking-wider text-slate-400 lg:block">Order book</h3>
          <div className={mobilePane === 'book' ? '' : 'hidden lg:block'}>
            <Ladder asset={asset} bids={bids} asks={asks} state={bookState} onPick={(p) => { setKind('limit'); setPrice(p.toString()) }} />
          </div>
          <div className={mobilePane === 'trades' ? 'lg:hidden' : 'hidden'}>
            <Trades asset={asset} trades={trades} state={bookState} />
          </div>
        </div>

        <div className="card hidden p-3 lg:col-start-3 lg:row-start-1 lg:block">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Recent trades</h3>
          <Trades asset={asset} trades={trades} state={bookState} />
        </div>
      </div>

      {/* Account tabs */}
      <div className="card p-4">
        <Tabs className="mb-3 max-w-xs" value={bottom} onChange={setBottom} options={[{ id: 'open', label: `Open orders (${orders.length})` }, { id: 'fills', label: 'Fills' }]} />
        {!wallet ? (
          <p className="py-4 text-center text-xs text-slate-500">Open your wallet to see your orders.</p>
        ) : bottom === 'open' ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[11px]">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr><th className="py-1">Pair</th><th>Side</th><th className="text-right">Price</th><th className="text-right">Amount</th><th className="text-right">Remaining</th><th className="text-right">Expiry</th><th /></tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {orders.length === 0 && <tr><td colSpan={7} className="py-4 text-center font-sans text-slate-500">{bookLive ? 'No open orders' : 'Order book not active yet'}</td></tr>}
                {orders.map((o) => {
                  const base = o.pair.split('-')[0]
                  return (
                    <tr key={o.id} className="border-t border-slate-800/80">
                      <td className="py-1.5 font-sans text-slate-300">{bookAssetLabel(base)}/FPL</td>
                      <td className={o.side === 'buy' ? 'text-emerald-400' : 'text-red-400'}>{o.side}</td>
                      <td className="text-right text-slate-200">{fmtFpl(raw(o.price))}</td>
                      <td className="text-right text-slate-300">{fmtBase(base, raw(o.amount), 8)}</td>
                      <td className="text-right text-slate-300">{fmtBase(base, raw(o.remaining), 8)}</td>
                      <td className="text-right text-slate-500">{o.expiry_height ? o.expiry_height.toLocaleString() : 'GTC'}</td>
                      <td className="text-right">
                        <button type="button" disabled={busy} onClick={() => cancel(o)} className="rounded border border-slate-700 px-2 py-0.5 font-sans text-[10px] text-slate-300 hover:border-red-500/60 hover:text-red-300 disabled:opacity-40">
                          Cancel
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[11px]">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr><th className="py-1">Block</th><th>Pair</th><th>Side</th><th className="text-right">Price</th><th className="text-right">Size</th><th className="text-right">Total (FPL)</th><th className="text-right">Role</th></tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {fills.length === 0 && <tr><td colSpan={7} className="py-4 text-center font-sans text-slate-500">{bookLive ? 'No fills yet' : 'Order book not active yet'}</td></tr>}
                {fills.map((f, i) => {
                  const base = (f as Trade & { pair?: string }).pair?.split('-')[0] ?? asset
                  const role = f.taker === account ? 'taker' : 'maker'
                  const mySide = role === 'taker' ? f.side : f.side === 'buy' ? 'sell' : 'buy'
                  return (
                    <tr key={`${f.height}:${i}`} className="border-t border-slate-800/80">
                      <td className="py-1.5 text-slate-500">{f.height.toLocaleString()}</td>
                      <td className="font-sans text-slate-300">{bookAssetLabel(base)}/FPL</td>
                      <td className={mySide === 'buy' ? 'text-emerald-400' : 'text-red-400'}>{mySide}</td>
                      <td className="text-right text-slate-200">{fmtFpl(raw(f.price))}</td>
                      <td className="text-right text-slate-300">{fmtBase(base, raw(f.amount), 8)}</td>
                      <td className="text-right text-slate-300">{fmtFpl(raw(f.total))}</td>
                      <td className="text-right font-sans text-slate-500">{role}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-600">
        On-ledger order book: orders escrow funds (buys hold FPL, sells hold the asset) until filled, cancelled or expired. Matching is price-time
        priority and every taker gets the better of the book and the AMM.
      </p>
    </div>
  )
}

function Stat({ label, value, tone = 'text-white' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`font-mono text-sm tabular-nums ${tone}`}>{value}</div>
    </div>
  )
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span>{k}</span>
      <span className="font-mono text-slate-300">{v}</span>
    </div>
  )
}

function Field({ label, unit, value, onChange, placeholder, inputMode }: { label: string; unit: string; value: string; onChange: (v: string) => void; placeholder?: string; inputMode?: 'numeric' | 'decimal' }) {
  return (
    <label className="block">
      <span className="text-[11px] text-slate-500">{label}</span>
      <div className="mt-1 flex items-center rounded-lg border border-slate-700 bg-slate-900 focus-within:border-sky-500/70">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          className="w-full bg-transparent px-3 py-2 font-mono text-sm text-white outline-none"
        />
        <span className="pr-3 text-[11px] text-slate-500">{unit}</span>
      </div>
    </label>
  )
}
