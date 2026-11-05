// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
/**
 * Falcon PL 2300 on-ledger order book (fd-pl 2.10.4, crates/fd-pl/src/orderbook.rs) — pure helpers.
 * Prices are FPL raw per one whole coin; amounts are base-asset raw units.
 */

export type BookAsset = 'USDC' | 'ETH' | 'BTC4'
export const BOOK_ASSETS: BookAsset[] = ['USDC', 'ETH', 'BTC4']

/** Mirrors orderbook.rs constants. */
export const MAX_OPEN_ORDERS_PER_ACCOUNT = 32
export const MIN_ORDER_QUOTE = 1_000n
export const ORDERBOOK_ACTIVATION_HEIGHT = 800_000

/** Base decimals (pair_scale: BTC4 1e8, else coin_scale). FPL has 0 decimals. */
export const BOOK_DECIMALS: Record<BookAsset | 'FPL', number> = { FPL: 0, USDC: 6, ETH: 18, BTC4: 8 }

export function pairOf(asset: BookAsset): string {
  return `${asset}-FPL`
}

export function bookAssetLabel(asset: string): string {
  if (asset === 'USDC') return 'fUSDC'
  if (asset === 'ETH') return 'fETH'
  if (asset === 'BTC4') return 'fBTC'
  return asset
}

export function pairScale(asset: BookAsset): bigint {
  return 10n ** BigInt(BOOK_DECIMALS[asset])
}

/** quote_of in orderbook.rs: FPL value of `amount` base raw at `price`. */
export function quoteOf(amount: bigint, price: bigint, scale: bigint): bigint {
  return (amount * price) / scale
}

/** Human decimal → raw digits (throws on bad input). */
export function toRawDigits(human: string, decimals: number): string {
  const s = human.trim().replace(/,/g, '')
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Enter a number')
  const [whole, frac = ''] = s.split('.')
  if (frac.length > decimals) throw new Error(`At most ${decimals} decimal places`)
  return (whole + frac.padEnd(decimals, '0')).replace(/^0+(?=\d)/, '') || '0'
}

/** Raw digits → human decimal string with thousands separators. */
export function fromRawDigits(raw: string | bigint, decimals: number, maxFrac = decimals): string {
  const s = (typeof raw === 'bigint' ? raw.toString() : raw).replace(/^0+(?=\d)/, '') || '0'
  const group = (w: string) => w.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (decimals === 0) return group(s)
  const pad = s.padStart(decimals + 1, '0')
  const whole = group(pad.slice(0, -decimals))
  const frac = pad.slice(-decimals).slice(0, maxFrac).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

export type LimitInput = {
  asset: BookAsset
  side: 'buy' | 'sell'
  /** Human FPL per 1 whole coin. FPL has 0 decimals so this is an integer. */
  price: string
  /** Human base amount. */
  amount: string
  /** Blocks from now; empty = good till cancelled. */
  expiryBlocks?: string
  tipHeight: number | null
  openOrders: number
  /** Raw balances. */
  fplBalance: bigint
  assetBalance: bigint
}

export type LimitPlan = {
  pair: string
  side: 'buy' | 'sell'
  priceRaw: string
  amountRaw: string
  quoteRaw: bigint
  escrowAsset: 'FPL' | BookAsset
  escrowRaw: bigint
  expiryHeight: string | null
}

/** Validate like place_limit (orderbook.rs) and return the tx fields. */
export function planLimitOrder(i: LimitInput): LimitPlan {
  const priceRaw = toRawDigits(i.price, BOOK_DECIMALS.FPL)
  const amountRaw = toRawDigits(i.amount, BOOK_DECIMALS[i.asset])
  const price = BigInt(priceRaw)
  const amount = BigInt(amountRaw)
  if (price <= 0n || amount <= 0n) throw new Error('Price and amount must be above zero')
  if (price > 18446744073709551615n || amount > 18446744073709551615n) throw new Error('Value too large')
  const quote = quoteOf(amount, price, pairScale(i.asset))
  if (quote < MIN_ORDER_QUOTE) throw new Error(`Order value must be at least ${MIN_ORDER_QUOTE.toString()} FPL`)
  if (i.openOrders >= MAX_OPEN_ORDERS_PER_ACCOUNT) {
    throw new Error(`You already have ${MAX_OPEN_ORDERS_PER_ACCOUNT} open orders (the per-account limit). Cancel one first.`)
  }
  const escrowAsset = i.side === 'buy' ? 'FPL' : i.asset
  const escrowRaw = i.side === 'buy' ? quote : amount
  const bal = i.side === 'buy' ? i.fplBalance : i.assetBalance
  if (escrowRaw > bal) throw new Error(`Not enough ${bookAssetLabel(escrowAsset)} for this order`)
  let expiryHeight: string | null = null
  const eb = (i.expiryBlocks ?? '').trim()
  if (eb) {
    if (!/^\d{1,9}$/.test(eb) || Number(eb) <= 0) throw new Error('Expiry must be a whole number of blocks')
    if (i.tipHeight == null) throw new Error('Chain height unknown; leave expiry empty or retry')
    expiryHeight = String(i.tipHeight + Number(eb))
  }
  return { pair: pairOf(i.asset), side: i.side, priceRaw, amountRaw, quoteRaw: quote, escrowAsset, escrowRaw, expiryHeight }
}

/** Amount (human) that spends `pct`% of the relevant balance at `price`. */
export function amountForPct(asset: BookAsset, side: 'buy' | 'sell', pct: number, priceHuman: string, fplBalance: bigint, assetBalance: bigint): string {
  const p = BigInt(Math.round(pct))
  if (side === 'sell') return fromRawDigits((assetBalance * p) / 100n, BOOK_DECIMALS[asset]).replace(/,/g, '')
  let price: bigint
  try {
    price = BigInt(toRawDigits(priceHuman || '0', 0))
  } catch {
    return ''
  }
  if (price <= 0n) return ''
  const spend = (fplBalance * p) / 100n
  return fromRawDigits((spend * pairScale(asset)) / price, BOOK_DECIMALS[asset]).replace(/,/g, '')
}

export type Level = { price: bigint; amount: bigint; total: bigint; orders: number }

type AmountLike = { raw?: string } | string | number | null | undefined
function rawOf(v: AmountLike): bigint {
  if (v == null) return 0n
  if (typeof v === 'object') return /^\d+$/.test(v.raw ?? '') ? BigInt(v.raw as string) : 0n
  const s = String(v)
  return /^\d+$/.test(s) ? BigInt(s) : 0n
}

export function parseLevels(rows: unknown): Level[] {
  if (!Array.isArray(rows)) return []
  return rows.map((r) => {
    const o = (r ?? {}) as Record<string, AmountLike>
    return { price: rawOf(o.price), amount: rawOf(o.amount), total: rawOf(o.total), orders: Number(o.orders ?? 1) || 1 }
  })
}

/** Cumulative base depth per level (bids best→worse, asks best→worse). */
export function cumulative(levels: Level[]): bigint[] {
  let acc = 0n
  return levels.map((l) => (acc += l.amount))
}

export function spreadOf(bids: Level[], asks: Level[]): { bid: bigint | null; ask: bigint | null; spread: bigint | null; bps: number | null } {
  const bid = bids[0]?.price ?? null
  const ask = asks[0]?.price ?? null
  if (bid == null || ask == null) return { bid, ask, spread: null, bps: null }
  const spread = ask - bid
  const mid = (ask + bid) / 2n
  return { bid, ask, spread, bps: mid > 0n ? Number((spread * 10000n) / mid) : null }
}

/** API states: live data, ledger says not active, or RPC not reachable through the gateway. */
export type BookState = 'loading' | 'live' | 'inactive' | 'unavailable' | 'error'

export function classifyBookResponse(status: number, body: unknown): BookState {
  const b = (body ?? {}) as { active?: boolean; error?: { code?: string } }
  if (status === 501 || b.error?.code === 'not_implemented') return 'unavailable'
  if (b.active === false) return 'inactive'
  if (status >= 200 && status < 300 && b.active !== undefined) return 'live'
  return 'error'
}
