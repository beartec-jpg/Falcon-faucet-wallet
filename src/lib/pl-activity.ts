// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
//
// Falcon PL 2300 wallet Activity: account txs + order-book fills (limit fills and
// AMM swaps) + open orders, as display-ready rows. Pure, no I/O, unit-tested.

import { decimalsOf, toDecimalString } from '@/lib/explorer-api/amounts'

type Obj = Record<string, unknown>

/**
 * Observed wall-clock block interval on 2300 (807,036 → 808,403 over 4h05m ≈ 10.75 s).
 * The node's `sealed_at_ms` is a chain stamp, not wall time (it reads 1970-03-14), so
 * row times are estimated from the tip: now − (tip − height) × interval.
 */
export const PL_BLOCK_MS_ESTIMATE = 10_750
const RIPPLE_EPOCH = 946_684_800

/** Wallet display name for a PL asset code. */
export function assetLabel(asset: string): string {
  const a = asset.toUpperCase()
  if (a === 'BTC4') return 'FBTC'
  if (a === 'USDC') return 'F-USDC'
  if (a === 'ETH') return 'FETH'
  return a || 'FPL'
}

/** Base units → grouped human string using the asset's decimals (USDC 6, ETH 18, BTC/BTC4 8, FPL 0). */
export function formatAssetAmount(raw: unknown, asset: string, maxFrac = 8): string {
  let s: string
  try {
    s = toDecimalString(String(raw ?? '0').trim() || '0', decimalsOf(asset))
  } catch {
    return String(raw ?? '')
  }
  const neg = s.startsWith('-')
  const [i, f = ''] = (neg ? s.slice(1) : s).split('.')
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const frac = f.slice(0, maxFrac).replace(/0+$/, '')
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`
}

/** Estimated unix ms for a block height, or undefined when the tip is unknown. */
export function estimateHeightMs(height: number, tip: number, nowMs: number, blockMs = PL_BLOCK_MS_ESTIMATE): number | undefined {
  if (!(height > 0) || !(tip > 0)) return undefined
  return nowMs - Math.max(0, tip - height) * blockMs
}

export type PlActivityRow = {
  hash: string
  type: string
  amount?: string
  amountAsset?: string
  destination?: string
  account: string
  result: string
  /** Ripple-epoch seconds (wallet fmtDate contract). */
  date?: number
  height?: number
  /** Display overrides for non-payment rows. */
  label?: string
  party?: string | null
  direction?: 'in' | 'out' | 'trade'
  amountLabel?: string
}

const KIND_TYPE: Record<string, string> = {
  pay: 'Payment',
  claim: 'Claim',
  asset_pay: 'AssetPay',
  swap_route: 'Swap',
  swap: 'Swap',
  place_limit_order: 'LimitOrder',
  cancel_order: 'CancelOrder',
  set_external_addrs: 'LinkAddress',
}

const KIND_LABEL: Record<string, string> = {
  swap_route: 'Swap submitted',
  swap: 'Swap submitted',
  place_limit_order: 'Placed limit order',
  cancel_order: 'Cancelled order',
  add_liq: 'Added liquidity',
  remove_liq: 'Removed liquidity',
  set_external_addrs: 'Linked external address',
  // fd-pl 2.10.4 account_tx_json collapses every other TxBody variant to "tx".
  tx: 'Chain transaction',
}

const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}
const s = (v: unknown) => (v == null ? '' : String(v))
const toRipple = (ms: number | undefined) => (ms == null ? undefined : Math.floor(ms / 1000) - RIPPLE_EPOCH)

export type BuildActivityInput = {
  self: string
  recentTxs: Obj[]
  /** fills_query body.fills (node wire: asset, side=taker side, price, base, quote, taker, maker, maker_order, height). */
  fills: Obj[]
  /** open_orders_query body.orders. */
  orders: Obj[]
  tip: number
  nowMs: number
}

export function buildPlActivity({ self, recentTxs, fills, orders, tip, nowMs }: BuildActivityInput): PlActivityRow[] {
  const rows: PlActivityRow[] = []
  const when = (h: number) => toRipple(estimateHeightMs(h, tip, nowMs))

  for (const t of recentTxs) {
    const hash = s(t.tx_id)
    if (!hash) continue
    const kind = s(t.kind) || 'tx'
    const height = n(t.height)
    const assetCode = kind === 'asset_pay' || kind === 'rail_deposit' || kind === 'rail_withdraw' ? s(t.asset) || 'FPL' : 'FPL'
    const row: PlActivityRow = {
      hash,
      type: KIND_TYPE[kind] ?? 'Tx',
      amount: t.amount != null && n(t.amount) !== 0 ? formatAssetAmount(t.amount, assetCode) : undefined,
      amountAsset: assetLabel(assetCode),
      destination: t.destination != null && s(t.destination) ? s(t.destination) : undefined,
      account: s(t.account),
      result: 'tesSUCCESS',
      date: when(height),
      height: height || undefined,
    }
    if (KIND_LABEL[kind]) {
      row.label = KIND_LABEL[kind]
      row.party = kind === 'set_external_addrs' && t.chain ? `${s(t.chain)} ${s(t.address)}`.trim() : null
      row.direction = 'trade'
      if (!row.amount) row.amountLabel = '—'
    }
    rows.push(row)
  }

  fills.forEach((f, i) => {
    const asset = s(f.asset).toUpperCase()
    const taker = s(f.taker)
    const maker = s(f.maker)
    const isTaker = taker === self
    if (!isTaker && maker !== self) return
    const takerSide = s(f.side).toLowerCase()
    const mySide = isTaker ? takerSide : takerSide === 'buy' ? 'sell' : 'buy'
    const height = n(f.height)
    const base = formatAssetAmount(f.base, asset)
    const quote = formatAssetAmount(f.quote, 'FPL')
    const price = formatAssetAmount(f.price, 'FPL')
    const amm = maker.startsWith('amm:')
    const lbl = assetLabel(asset)
    const amountLabel = mySide === 'buy' ? `+${base} ${lbl} · −${quote} FPL` : `−${base} ${lbl} · +${quote} FPL`
    const mo = f.maker_order == null ? 'amm' : s(f.maker_order)
    rows.push({
      hash: `fill:${height}:${asset}:${mo}:${i}`,
      type: amm && isTaker ? 'Swap' : 'Trade',
      account: taker,
      destination: maker,
      result: 'tesSUCCESS',
      date: when(height),
      height: height || undefined,
      amount: base,
      amountAsset: lbl,
      direction: 'trade',
      label: amm && isTaker
        ? `Swapped ${mySide === 'buy' ? `FPL → ${lbl}` : `${lbl} → FPL`} @ ${price}`
        : isTaker
          ? `Market ${mySide} ${lbl} @ ${price} filled vs`
          : `Limit ${mySide} ${lbl} @ ${price} filled by`,
      party: amm && isTaker ? 'AMM pool' : isTaker ? maker : taker,
      amountLabel,
    })
  })

  for (const o of orders) {
    const pair = s(o.pair).toUpperCase()
    const asset = pair.split('-')[0] || 'FPL'
    const height = n(o.placed_height)
    const lbl = assetLabel(asset)
    const side = s(o.side).toLowerCase()
    const rem = formatAssetAmount(o.remaining ?? o.amount, asset)
    const total = formatAssetAmount(o.amount, asset)
    rows.push({
      hash: `order:${s(o.id)}`,
      type: 'OpenOrder',
      account: self,
      result: 'tesSUCCESS',
      date: when(height),
      height: height || undefined,
      amount: rem,
      amountAsset: lbl,
      direction: 'trade',
      label: `Open limit ${side} #${s(o.id)} @ ${formatAssetAmount(o.price, 'FPL')}`,
      party: `${pair} · ${rem === total ? total : `${rem} of ${total}`} ${lbl}`,
      amountLabel: `${rem} ${lbl}`,
    })
  }

  // Newest first; stable for equal heights (fills keep engine order).
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (b.r.height ?? 0) - (a.r.height ?? 0) || a.i - b.i)
    .map(({ r }) => r)
}
