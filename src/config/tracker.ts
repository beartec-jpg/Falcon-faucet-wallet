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
    // Our own watcher service keys (also caught by /^watcher-/).
    'watcher-brain', 'watcher-falcon2',
  ] as string[],
  systemPatterns: [/^watcher-/i, /-bond$/i] as RegExp[],
  /**
   * Validator seat accounts explicitly allowed onto the user wallet activity
   * leaderboard in addition to the operators board (e.g. nodesafe, which used
   * its validator seat account for user DeFi/wallet activity).
   */
  userBoardValidators: ['nodesafe'] as readonly string[],
  /** Load generators, node-generated load wallets, smoke tests and benchmarks. */
  harnessPatterns: [
    /^w\d{2,4}$/i,
    /^loadgen\d*$/i,
    /^(loadgen|lg|bench|load|stress)[-_.]/i,
    /-smoke-/i,
    /^falcon-pl-loadgen$/i,
  ] as RegExp[],
  /** Points per category (sum 100). All nine categories are scored. */
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
  /**
   * Bonus categories on top of the 100 activity points. Feedback: sum of bonuses on
   * feedback approved in the admin (default 1 per item, see config/feedback.ts), capped here.
   */
  bonusCaps: {
    feedback: 5,
  },
  /** Window for day-based categories. */
  windowDays: 60,
  /** Active days for full consistency points. */
  consistencyFullDays: 30,
  /** Faucet claim days for full faucet points. */
  faucetFullDays: 14,
  /** Arcade: distinct UTC days with a score in the window for the day part (60%); distinct games for the rest (40%). */
  arcadeFullDays: 7,
  /** Watchers: heartbeat slots credited this epoch for full slot points (70%); rail work units for full work points (30%). */
  watcherFullSlots: 50,
  watcherFullWork: 500,
  /** To appear on the ranked board. Others are listed as "building up". */
  minCategories: 2,
  minActiveDays: 2,
  /** Accounts sharing one hashed faucet IP at or above this count are scored as one group. */
  linkedMinAccounts: 3,
}

export type ActivityCategory = keyof typeof TRACKER_CONFIG.caps
export type BonusCategory = keyof typeof TRACKER_CONFIG.bonusCaps
export type TrackerCategory = ActivityCategory | BonusCategory
/** Highest possible score: 100 activity points plus bonus caps. */
export const TRACKER_MAX_SCORE = [...Object.values(TRACKER_CONFIG.caps), ...Object.values(TRACKER_CONFIG.bonusCaps)].reduce((t, x) => t + x, 0)
