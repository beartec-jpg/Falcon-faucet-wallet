// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 BEARTEC
//
// Builders for common FPL txs. destination/amount placement matches the Falcon
// wallet (src/lib/pl-wallet-sign.ts): ops with no recipient use destination ""
// and amount 0. Amounts are integer base units.

import { DEFAULT_FEE, FPL_TESTNET_NETWORK_ID, type TxBody, type U64, type UnsignedTx } from './tx.js'

export interface Common {
  account: string
  sequence: U64
  fee?: U64
  networkId?: number
}

function tx(c: Common, destination: string, amount: U64, body: TxBody): UnsignedTx {
  return {
    account: c.account,
    sequence: c.sequence,
    destination,
    amount,
    fee: c.fee ?? DEFAULT_FEE,
    networkId: c.networkId ?? FPL_TESTNET_NETWORK_ID,
    body,
  }
}

export type RailAsset = 'BTC' | 'BTC4' | 'ETH' | 'USDC' | (string & {})
export type SwapToken = 'FPL' | RailAsset

/** Native FPL transfer. */
export const transfer = (c: Common & { destination: string; amount: U64 }) =>
  tx(c, c.destination, c.amount, { kind: 'pay' })

/** Transfer of a bridged asset (sats, wei, or 6-dp USDC units). */
export const assetTransfer = (c: Common & { destination: string; asset: RailAsset; amount: U64 }) =>
  tx(c, c.destination, c.amount, { kind: 'asset_pay', asset: c.asset })

/** FPL transfer that also commits the recipient's Falcon key (sha256 hex of raw pk, see keyHash()). */
export const transferToKey = (c: Common & { destination: string; amount: U64; keyHash: string }) => {
  if (!/^[0-9a-f]{64}$/.test(c.keyHash)) throw new Error('keyHash must be 64 lowercase hex')
  return tx(c, c.destination, c.amount, { kind: 'pay_to_key', key_hash: c.keyHash })
}

export const swapRoute = (c: Common & { tokenIn: SwapToken; tokenOut: SwapToken; amountIn: U64; minOut: U64 }) =>
  tx(c, '', 0, { kind: 'swap_route', token_in: c.tokenIn, token_out: c.tokenOut, amount_in: c.amountIn, min_out: c.minOut })

export const addLiquidity = (c: Common & { poolId: string; amtA: U64; amtB: U64 }) =>
  tx(c, '', 0, { kind: 'add_liquidity', pool_id: c.poolId, amt_a: c.amtA, amt_b: c.amtB })

export const removeLiquidity = (c: Common & { poolId: string; lpBurn: U64 }) =>
  tx(c, '', 0, { kind: 'remove_liquidity', pool_id: c.poolId, lp_burn: c.lpBurn })

export const lendSupply = (c: Common & { marketId: string; amount: U64 }) =>
  tx(c, '', 0, { kind: 'lend_supply', market_id: c.marketId, amount: c.amount })
export const lendWithdraw = (c: Common & { marketId: string; shares: U64 }) =>
  tx(c, '', 0, { kind: 'lend_withdraw', market_id: c.marketId, shares: c.shares })
export const lendBorrow = (c: Common & { marketId: string; amount: U64; collateralFpl: U64 }) =>
  tx(c, '', 0, { kind: 'lend_borrow', market_id: c.marketId, amount: c.amount, collateral_fpl: c.collateralFpl })
export const lendRepay = (c: Common & { marketId: string; amount: U64 }) =>
  tx(c, '', 0, { kind: 'lend_repay', market_id: c.marketId, amount: c.amount })

/** Turn this account into a vault locked to `destination`. */
export const vaultOpen = (c: Common & { destination: string }) =>
  tx(c, c.destination, 0, { kind: 'vault_open', destination: c.destination })
export const vaultLock = (c: Common) => tx(c, '', 0, { kind: 'vault_lock' })

/** Move settled `claimable` FPL into balance. */
export const claim = (c: Common) => tx(c, '', 0, { kind: 'claim' })
export const watcherHeartbeat = (c: Common) => tx(c, '', 0, { kind: 'watcher_heartbeat' })

/** Withdraw a bridged asset to an external-chain address. */
export const railWithdraw = (c: Common & { asset: RailAsset; amount: U64; externalTo: string; signedBtcTx?: string }) => {
  const to = c.externalTo.trim()
  const kick = (c.signedBtcTx ?? '').trim().toLowerCase()
  if (kick && !/^[0-9a-f]+$/.test(kick)) throw new Error('signedBtcTx must be hex')
  return tx(c, to, c.amount, {
    kind: 'rail_withdraw',
    asset: c.asset,
    amount: c.amount,
    external_to: to,
    ...(kick ? { signed_btc_tx: kick } : {}),
  })
}

/** Bind an external chain address (e.g. btc, eth) to this account. */
export const setExternalAddr = (c: Common & { chain: string; address: string }) =>
  tx(c, '', 0, { kind: 'set_external_addrs', chain: c.chain.trim().toLowerCase(), address: c.address.trim() })

export const placeLimitOrder = (
  c: Common & { pair: string; side: 'buy' | 'sell'; price: U64; amount: U64; expiryHeight?: U64 },
) =>
  tx(c, '', 0, {
    kind: 'place_limit_order',
    pair: c.pair,
    side: c.side,
    price: c.price,
    amount: c.amount,
    ...(c.expiryHeight !== undefined ? { expiry_height: c.expiryHeight } : {}),
  })

export const cancelOrder = (c: Common & { orderId: U64 }) => tx(c, '', 0, { kind: 'cancel_order', order_id: c.orderId })

