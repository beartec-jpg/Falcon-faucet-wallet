// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
//
// Pure mappers from node wire bodies (status_req / account_query / order_book) to API v1 shapes.
// No I/O here so they are unit-testable with fixtures.

import { big } from '@/lib/pl-exact-json'
import { meshHeadFromStatus, num, str } from '@/lib/pl-mesh'
import { consensusFromStatus } from '@/lib/scan-snapshot'
import { amount, type Amount } from './amounts'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter((x): x is Obj => !!x && typeof x === 'object') : [])

/** Chain-physics ms is a ledger stamp, not Unix wall time. Never feed it to Date(). */
export type ChainPhysicsQuality = 'chain_physics' | 'unavailable'
/** Only hash-bound signed UTC (node tip_sealed_utc_*) is UTC-quality. */
export type SealedUtcSource = 'signed_utc_v5' | 'none'

export type BlockV1 = {
  height: number
  hash: string
  state_root: string | null
  packer: string
  tx_count: number
  /**
   * ISO-8601 UTC wall time — set ONLY when signed UTC quality is utc_committed.
   * Never derived from tip_sealed_at_ms / sealed_at_ms (chain physics).
   */
  sealed_at: string | null
  /** Raw chain-physics ms retained for diagnostics; not wall UTC. */
  sealed_at_ms: number | null
  sealed_at_quality: ChainPhysicsQuality
  /** ISO-8601 from tip_sealed_utc_ms when quality is utc_committed; else null. */
  sealed_utc: string | null
  sealed_utc_ms: number | null
  sealed_utc_quality: string
  sealed_utc_source: SealedUtcSource
  /** Observer wall clock when this API mapped the tip (separate from chain stamps). */
  observed_at: string
}

/** Honest time fields from node status / tx wire. Never Date(chain_physics_ms). */
export function honestSealTimes(input: {
  physicsMs: number
  utcMs: number
  utcQuality: string
  observedAtMs: number
}): Pick<
  BlockV1,
  | 'sealed_at'
  | 'sealed_at_ms'
  | 'sealed_at_quality'
  | 'sealed_utc'
  | 'sealed_utc_ms'
  | 'sealed_utc_quality'
  | 'sealed_utc_source'
  | 'observed_at'
> {
  const physicsOk = Number.isFinite(input.physicsMs) && input.physicsMs > 0
  const q = (input.utcQuality || 'unavailable').trim() || 'unavailable'
  const utcOk = q === 'utc_committed' && Number.isFinite(input.utcMs) && input.utcMs > 0
  const sealedUtc = utcOk ? new Date(input.utcMs).toISOString() : null
  return {
    sealed_at: sealedUtc, // legacy field: only UTC-quality ISO, else null (no Date(physics))
    sealed_at_ms: physicsOk ? input.physicsMs : null,
    sealed_at_quality: physicsOk ? 'chain_physics' : 'unavailable',
    sealed_utc: sealedUtc,
    sealed_utc_ms: Number.isFinite(input.utcMs) && input.utcMs > 0 ? input.utcMs : null,
    sealed_utc_quality: q,
    sealed_utc_source: utcOk ? 'signed_utc_v5' : 'none',
    observed_at: new Date(input.observedAtMs).toISOString(),
  }
}

export function tipBlockFromStatus(st: Obj, observedAtMs: number): BlockV1 {
  const physics = num(st.tip_sealed_at_ms, num(st.last_pack_at_ms, Number.NaN))
  const utcMs = num(st.tip_sealed_utc_ms, Number.NaN)
  const utcQ = str(st.tip_sealed_utc_quality, 'unavailable')
  return {
    height: num(st.tip_height),
    hash: str(st.tip_hash),
    state_root: str(st.state_root) || null,
    packer: str(st.last_pack_packer),
    tx_count: num(st.last_pack_txs),
    ...honestSealTimes({ physicsMs: physics, utcMs, utcQuality: utcQ, observedAtMs }),
  }
}

/** Ring of recently observed tips (newest first). Bounded; resets on cold start. */
export class BlockRing {
  private rows: BlockV1[] = []
  constructor(private readonly size = 256) {}
  remember(b: BlockV1): void {
    if (!b.height) return
    const i = this.rows.findIndex((r) => r.height === b.height)
    if (i >= 0) {
      this.rows[i] = { ...b, observed_at: this.rows[i].observed_at }
      return
    }
    this.rows.push(b)
    this.rows.sort((a, z) => z.height - a.height)
    if (this.rows.length > this.size) this.rows.length = this.size
  }
  list(): BlockV1[] {
    return this.rows.slice()
  }
  get(height: number): BlockV1 | undefined {
    return this.rows.find((r) => r.height === height)
  }
}

export type TxV1 = {
  tx_id: string
  height: number
  kind: string
  account: string
  destination: string | null
  amount: Amount
  fee: Amount
  /** ISO only when sealed_utc_quality is utc_committed; never Date(sealed_at_ms). */
  sealed_at: string | null
  sealed_at_ms: number | null
  sealed_at_quality: ChainPhysicsQuality
  sealed_utc: string | null
  sealed_utc_ms: number | null
  sealed_utc_quality: string
  sealed_utc_source: SealedUtcSource
  chain?: string
  address?: string
}

export function txFromNode(t: Obj, observedAtMs = Date.now()): TxV1 {
  const asset = str(t.asset) || 'FPL'
  const physics = num(t.sealed_at_ms, Number.NaN)
  const utcMs = num(t.sealed_utc_ms, Number.NaN)
  const utcQ = str(t.sealed_utc_quality, 'unavailable')
  const times = honestSealTimes({ physicsMs: physics, utcMs, utcQuality: utcQ, observedAtMs })
  return {
    tx_id: str(t.tx_id),
    height: num(t.height),
    kind: str(t.kind, 'tx'),
    account: str(t.account),
    destination: str(t.destination) || null,
    amount: amount(asset, t.amount ?? 0),
    fee: amount('FPL', t.fee ?? 0),
    sealed_at: times.sealed_at,
    sealed_at_ms: times.sealed_at_ms,
    sealed_at_quality: times.sealed_at_quality,
    sealed_utc: times.sealed_utc,
    sealed_utc_ms: times.sealed_utc_ms,
    sealed_utc_quality: times.sealed_utc_quality,
    sealed_utc_source: times.sealed_utc_source,
    ...(t.chain ? { chain: str(t.chain) } : {}),
    ...(t.address ? { address: str(t.address) } : {}),
  }
}

export type AccountV1 = {
  account: string
  exists: boolean
  sequence: number
  account_type: string | null
  name_status: string | null
  vault_locked: boolean
  balances: Amount[]
  claimable: Amount
  lp_positions: { pool_id: string; lp: string; asset_a: string; asset_b: string }[]
  lend_positions: { market_id: string; asset: string; shares: string; debt: Amount; collateral: Amount }[]
}

export function balancesFromAccount(body: Obj): Amount[] {
  const out: Amount[] = [amount('FPL', body.balance ?? 0)]
  const assets = obj(body.assets)
  for (const k of Object.keys(assets).sort()) {
    if (k.toUpperCase() === 'FPL') continue
    out.push(amount(k, assets[k]))
  }
  return out
}

export function accountFromNode(name: string, body: Obj): AccountV1 {
  return {
    account: str(body.account, name),
    exists: body.exists !== false,
    sequence: num(body.sequence),
    account_type: body.account_type == null ? null : str(body.account_type),
    name_status: body.name_status == null ? null : str(body.name_status),
    vault_locked: Boolean(body.vault_locked),
    balances: balancesFromAccount(body),
    claimable: amount('FPL', body.claimable ?? 0),
    lp_positions: arr(body.lp).map((x) => ({
      pool_id: str(x.pool_id),
      lp: big(x.lp).toString(),
      asset_a: str(x.asset_a),
      asset_b: str(x.asset_b),
    })),
    lend_positions: arr(body.lend_positions).map((x) => ({
      market_id: str(x.market_id),
      asset: str(x.asset),
      shares: big(x.shares).toString(),
      debt: amount(str(x.asset), x.debt ?? 0),
      collateral: amount('FPL', x.collateral_fpl ?? 0),
    })),
  }
}

export type ValidatorV1 = {
  id: string
  status: 'bonded' | 'jailed' | 'unbonding'
  online: boolean
  bond: Amount
  pack_count: number
  last_advertised_tip: number
  lag_blocks: number | null
  perf: number | null
  pong_age_ms: number | null
  lottery_ready: boolean
}

export function validatorsFromStatus(st: Obj): ValidatorV1[] {
  const tip = num(st.tip_height)
  const online = new Set(meshHeadFromStatus(st).online_seats)
  return arr(st.validators).map((v) => {
    const id = str(v.id || v.bond_account)
    const adv = num(v.last_advertised_tip)
    const perf = num(v.perf, Number.NaN)
    const pong = num(v.pong_age_ms, Number.NaN)
    return {
      id,
      status: v.jailed ? 'jailed' : v.unbonding ? 'unbonding' : 'bonded',
      online: online.has(id),
      bond: amount('FPL', v.bond ?? 0),
      pack_count: num(v.pack_count),
      last_advertised_tip: adv,
      lag_blocks: adv > 0 && tip > 0 ? Math.max(0, tip - adv) : null,
      perf: Number.isFinite(perf) ? perf : null,
      pong_age_ms: Number.isFinite(pong) ? pong : null,
      lottery_ready: Boolean(v.lottery_ready),
    }
  })
}

export type BridgeRailV1 = {
  asset: string
  tip_height: number
  tip_hash: string
  total_minted: Amount
  total_burned: Amount
  outstanding: Amount
  min_confirmations: number
  open_withdrawals: number
}

export function bridgeFromStatus(st: Obj): { rails: BridgeRailV1[] } {
  return {
    rails: arr(st.rails).map((r) => {
      const asset = str(r.asset)
      const minted = big(r.total_minted)
      const burned = big(r.total_burned)
      return {
        asset,
        tip_height: num(r.tip_height),
        tip_hash: str(r.tip_hash),
        total_minted: amount(asset, minted),
        total_burned: amount(asset, burned),
        outstanding: amount(asset, minted > burned ? minted - burned : 0n),
        min_confirmations: num(r.min_confirmations),
        open_withdrawals: num(r.open_withdrawals),
      }
    }),
  }
}

export function networkFromStatus(st: Obj) {
  const head = meshHeadFromStatus(st)
  const metrics = obj(st.metrics)
  return {
    product: str(st.product, 'Falcon PL'),
    ticker: str(st.ticker, 'FPL'),
    network_id: num(st.network_id, 2300),
    version: head.product_version || null,
    height: head.height,
    tip_hash: str(st.tip_hash),
    state: head.server_state,
    peers: head.peers,
    commit: head.commit,
    online_seats: head.online_seats,
    mempool: num(st.mempool),
    accounts: Number.isFinite(num(st.accounts_count, Number.NaN)) ? num(st.accounts_count) : null,
    treasury: amount('FPL', st.treasury ?? 0),
    epoch: num(st.epoch, 1),
    totals: {
      ledgers_sealed: num(metrics.ledgers_sealed, head.height),
      txs_sealed: num(metrics.txs_sealed),
      fees_burned: amount('FPL', metrics.fees_burned_total ?? 0),
    },
    ...consensusFromStatus(st),
  }
}

// ---------------------------------------------------------------------------
// Order book (node v2.10.4 RPC: order_book_query / open_orders_query / fills_query)
// ---------------------------------------------------------------------------

/** Height at which the PL 2300 order book activates (TESTNET_2300_V2_10_4_FROM_HEIGHT). */
export const ORDERBOOK_ACTIVATION_HEIGHT = 800_000

export function normalizePair(p: string): string | null {
  const u = p.trim().toUpperCase()
  const base = u.replace(/[-/_]FPL$/, '')
  if (!base || base === 'FPL' || !/^[A-Z0-9]{1,16}$/.test(base)) return null
  return `${base}-FPL`
}

export type BookLevelV1 = { price: Amount; amount: Amount; total: Amount; orders: number }

export function depthFromNode(pair: string, body: Obj, levels: number) {
  const base = pair.split('-')[0]
  const side = (v: unknown): BookLevelV1[] =>
    arr(v).slice(0, levels).map((l) => ({
      price: amount('FPL', l.price ?? 0),
      amount: amount(base, l.amountBase ?? l.base ?? 0),
      total: amount('FPL', l.amountFpl ?? l.quote ?? 0),
      orders: num(l.orders, 1),
    }))
  return { pair, bids: side(body.bids), asks: side(body.asks) }
}

export type TradeV1 = {
  height: number
  pair: string
  side: string
  price: Amount
  amount: Amount
  total: Amount
  taker: string
  maker: string
  maker_order: number | null
}

export function tradesFromNode(body: Obj): TradeV1[] {
  return arr(body.fills).map((f) => {
    const base = str(f.asset)
    const mo = num(f.maker_order, Number.NaN)
    return {
      height: num(f.height),
      pair: `${base}-FPL`,
      side: str(f.side).toLowerCase(),
      price: amount('FPL', f.price ?? 0),
      amount: amount(base, f.base ?? 0),
      total: amount('FPL', f.quote ?? 0),
      taker: str(f.taker),
      maker: str(f.maker),
      maker_order: Number.isFinite(mo) ? mo : null,
    }
  })
}

export function ordersFromNode(body: Obj) {
  return arr(body.orders).map((o) => {
    const pair = str(o.pair)
    const base = pair.split('-')[0] || 'FPL'
    return {
      id: num(o.id),
      pair,
      side: str(o.side).toLowerCase(),
      owner: str(o.owner),
      price: amount('FPL', o.price ?? 0),
      amount: amount(base, o.amount ?? 0),
      remaining: amount(base, o.remaining ?? 0),
      placed_height: num(o.placed_height),
      expiry_height: o.expiry_height == null ? null : num(o.expiry_height),
    }
  })
}
