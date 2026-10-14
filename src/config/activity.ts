/**
 * Testnet activity leaderboard rules. Edit here; the indexer and the board
 * both read this file. Excluded accounts are still indexed, just not ranked.
 */
export const ACTIVITY_CONFIG = {
  /** Exact account names never ranked (loadgen / ops wallets). Validators, their bond
   * accounts, watcher-* and the faucet account are excluded automatically from status. */
  excludeAccounts: ['loadgen', 'falcon-pl-loadgen'] as string[],
  /** Name patterns for load-generator / benchmark wallets. */
  excludePatterns: [/^(loadgen|lg|bench|load|stress)[-_.]/i, /^watcher-/i, /-bond$/i] as RegExp[],
  /** Per-address caps (points) so one address cannot dominate a component. */
  caps: { bridge: 30, swaps: 15, lp: 25, lending: 15, tx: 15 },
  /** A gap between index runs longer than this does not count as LP / lending time. */
  maxIntervalMs: 15 * 60_000,
  /** Max account_query calls per index run (rotates through the rest). */
  maxAccountsPerRun: 40,
}
