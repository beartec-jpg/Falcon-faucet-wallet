/**
 * Testnet activity tracker rules. Who is ranked, category caps, thresholds.
 * Edit here; the cron, the boards and the profile page all read this file.
 * Nothing here is a reward rule: the tracker only measures testnet activity.
 */
export const TRACKER_CONFIG = {
  /** Test accounts created for development (genesis harness). Never ranked. */
  testAccounts: ['alice', 'bob', 'carol'] as string[],
  /** Protocol and service accounts. Validators, bond accounts and watcher keys are added from node status. */
  systemAccounts: [
    'admission', 'btc-headers', 'faucet', 'treasury', 'community', 'builder', 'genesis', 'root',
    'operator', 'admin', 'falcon', 'fpl', 'pool', 'lend', 'bridge', 'watcher',
  ] as string[],
  systemPatterns: [/^watcher-/i, /-bond$/i] as RegExp[],
  /** Load generators, node-generated load wallets, smoke tests and benchmarks. */
  harnessPatterns: [
    /^w\d{2,4}$/i,
    /^loadgen\d*$/i,
    /^(loadgen|lg|bench|load|stress)[-_.]/i,
    /-smoke-/i,
    /^falcon-pl-loadgen$/i,
  ] as RegExp[],
  /** Points per category (sum 100). Categories without data yet score 0 and say so. */
  caps: {
    bridging: 20,
    swaps: 15,
    liquidity: 15,
    lending: 10,
    payments: 10,
    consistency: 15,
    faucet: 5,
    arcade: 5,
    infra: 5,
  },
  /** Window for day-based categories. */
  windowDays: 60,
  /** Active days for full consistency points. */
  consistencyFullDays: 30,
  /** Faucet claim days for full faucet points. */
  faucetFullDays: 14,
  /** To appear on the ranked board. Others are listed as "building up". */
  minCategories: 2,
  minActiveDays: 2,
  /** Accounts sharing one hashed faucet IP at or above this count are scored as one group. */
  linkedMinAccounts: 3,
}

export type TrackerCategory = keyof typeof TRACKER_CONFIG.caps
