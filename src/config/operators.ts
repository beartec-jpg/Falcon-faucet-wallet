/**
 * Operators pool rules (decided 2026-10-21). Proposed model; nothing is promised and
 * every figure is subject to change until the mainnet parameter sheet is published.
 * Edit here; the cron, the API and the /airdrop page all read this file.
 */
export const PRE_MAINNET_AIRDROP_FPL = 1_000_000_000

export const OPERATORS_CONFIG = {
  /** Pre-mainnet airdrop (1B) that the operators pool is carved from. */
  airdropFpl: PRE_MAINNET_AIRDROP_FPL,
  /** Operators pool: up to 10% of the pre-mainnet airdrop (100M FPL). */
  poolShare: 0.1,
  /** Most any one operator can get: 1% of the pre-mainnet airdrop (10M FPL). */
  maxShare: 0.01,
  /** With N <= smallSetMax eligible operators, each gets between floorShare and maxShare of the airdrop. */
  floorShare: 0.007,
  smallSetMax: 10,
  /** Eligible if active (scored, not jailed / locked) in at least this fraction of window epochs. */
  minActiveFraction: 0.5,
  /** Scoring window start (UTC). The window ends at the mainnet snapshot. */
  windowStart: '2026-10-21',
  /** Buffer held back from the user side of the pre-mainnet airdrop (same 5% as the release-phase scorer). */
  userBuffer: 0.05,
  /**
   * Falcon-operated seats: shown on the board, never paid. Test, system, bond and
   * watcher accounts are excluded by the tracker rules (src/config/tracker.ts).
   */
  internalSeats: [
    'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13',
    'falcon-node', 'scottspersonalnode',
  ] as string[],
} as const

export const OPERATORS_POOL_FPL = OPERATORS_CONFIG.airdropFpl * OPERATORS_CONFIG.poolShare
export const OPERATOR_MAX_FPL = OPERATORS_CONFIG.airdropFpl * OPERATORS_CONFIG.maxShare
export const OPERATOR_FLOOR_FPL = OPERATORS_CONFIG.airdropFpl * OPERATORS_CONFIG.floorShare
