/**
 * Falcon PL 2.10.4 on-ledger order book (testnet 2300).
 * Single source of truth for the activation height shown/gated in the UI.
 * Must equal TESTNET_2300_V2_10_4_FROM_HEIGHT in falcon-pl-rs params_v2.rs.
 */
export const ORDERBOOK_ACTIVATION_HEIGHT = 800_000

/** Pairs with an <ASSET>/FPL pool (node pair id `<ASSET>-FPL`). */
export const ORDERBOOK_PAIRS = ['USDC', 'ETH', 'BTC4'] as const
export type OrderBookAsset = (typeof ORDERBOOK_PAIRS)[number]

/** Smallest order (FPL value at the limit price), orderbook.rs MIN_ORDER_QUOTE. */
export const ORDERBOOK_MIN_ORDER_FPL = 1_000
/** orderbook.rs MAX_OPEN_ORDERS_PER_ACCOUNT. */
export const ORDERBOOK_MAX_OPEN_PER_ACCOUNT = 32
