// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
// Fixtures shaped like Falcon PL node wire bodies (status_req / account_query / order_book).
import type { PlWire } from '@/lib/pl-rpc'

export const STATUS = {
  tip_height: 512_345,
  tip_hash: 'ab'.repeat(32),
  // chain-physics (NOT wall UTC) — Date(6200000000) => 1970-03-14; honesty must not ISO this
  tip_sealed_at_ms: 6_200_000_000,
  tip_sealed_utc_ms: 0,
  tip_sealed_utc_quality: 'unavailable',
  tip_lag: 1,
  state_root: 'cd'.repeat(32),
  last_pack_packer: 'v1',
  last_pack_txs: 3,
  online_seats: ['v1', 'v2', 'v3', 'v4', 'v5'],
  peers: 5,
  commit_need: 4,
  committee_size: 6,
  product_version: '2.10.3',
  network_id: 2300,
  mempool: 2,
  accounts_count: 77,
  treasury: 1_000_000,
  epoch: 9,
  genesis_ms: 1_760_000_000_000,
  now_ms: 1_762_000_000_000,
  metrics: { ledgers_sealed: 512_345, txs_sealed: 9000, fees_burned_total: 1234 },
  validators: [
    { id: 'v1', bond: 50_000, pack_count: 100, last_advertised_tip: 512_345, perf: 0.99, pong_age_ms: 120 },
    { id: 'v2', bond: 50_000, pack_count: 90, last_advertised_tip: 512_300, jailed: true },
    { id: 'v6', bond: 10_000, pack_count: 0, last_advertised_tip: 0, unbonding: true },
  ],
  rails: [{ asset: 'ETH', tip_height: 21_000_000, tip_hash: '0xee', total_minted: '5000000000000000000', total_burned: '1500000000000000000', min_confirmations: 12, open_withdrawals: 1 }],
}

export const ACCOUNT = {
  account: 'alice',
  exists: true,
  sequence: 4,
  balance: 1500,
  claimable: 7,
  account_type: 'wallet',
  name_status: 'activated',
  vault_locked: false,
  assets: { ETH: '1234567890123456789', USDC: 2500000 },
  lp: [{ pool_id: 'eth-fpl', lp: 100, asset_a: 'ETH', asset_b: 'FPL' }],
  lend_positions: [{ market_id: 'usdc', asset: 'USDC', shares: 10, debt: 1500000, collateral_fpl: 300 }],
  recent_txs: [
    { tx_id: 't3', height: 512_340, kind: 'asset_pay', account: 'alice', destination: 'bob', amount: '1000000000000000000', asset: 'ETH', fee: 2, sealed_at_ms: 1_762_000_000_000 },
    { tx_id: 't2', height: 512_000, kind: 'pay', account: 'bob', destination: 'alice', amount: 10, fee: 1, sealed_at_ms: 1_761_999_000_000 },
    { tx_id: 't1', height: 500_000, kind: 'claim', account: 'alice', destination: '', amount: 0, fee: 1 },
  ],
}

export const DEPTH = {
  pair: 'BTC4-FPL', base: 'BTC4', quote: 'FPL',
  asks: [{ price: 61000, amountBase: 50000000, amountFpl: 30500, orders: 2 }],
  bids: [{ price: 60000, amountBase: 100000000, amountFpl: 60000, orders: 1 }],
}
export const FILLS = { fills: [{ height: 800_010, asset: 'BTC4', side: 'buy', price: 61000, base: 1000000, quote: 610, taker: 'alice', maker: 'bob', maker_order: 7 }] }
export const ORDERS = { account: 'alice', orders: [{ id: 7, pair: 'BTC4-FPL', side: 'sell', owner: 'alice', price: 61000, amount: 100000000, remaining: 50000000, placed_height: 800_001, expiry_height: null }] }

/** Fake wire: order book active (ok), inactive (err not active) or unsupported (gateway 403). */
export function fakeWire(mode: 'ok' | 'inactive' | 'unsupported' = 'ok') {
  return async (msg: Record<string, unknown>): Promise<PlWire> => {
    const t = msg.type
    if (t === 'account_query') {
      if (msg.account === 'ghost') return { type: 'account', body: { account: 'ghost', exists: false } }
      return { type: 'account', body: ACCOUNT, raw: JSON.stringify({ type: 'account', body: ACCOUNT }) }
    }
    if (mode === 'unsupported') throw new Error('pl wire gateway 403')
    if (mode === 'inactive') return { type: 'err', msg: 'order book not active yet' }
    const body = t === 'order_book_query' ? DEPTH : t === 'fills_query' ? FILLS : ORDERS
    return { type: 'order_book', body, raw: JSON.stringify({ type: 'order_book', body }) }
  }
}
