/**
 * Actions /api/wallet and /api/wallet/pl will handle. Anything else gets a 400
 * before any forwarding. Keep in sync with the site's callers
 * (src/lib/pl-dest-lock.ts) and with scripts/verify-btc-withdrawals-off.mjs.
 *
 * btc-kickoff / btc-take are deliberately absent while BTC withdrawals are
 * paused. Re-enabling BTC withdrawals means changing three things in one PR:
 * btc_withdrawals_enabled in public/config/btc-spv-bridge.json, the
 * unconditional BTC Kickoff/take refusal in both wallet routes, and this list.
 */
export const WALLET_ROUTE_ACTIONS: ReadonlySet<string> = new Set([
  'vault-activate',
  'eth-kickoff',
  'eth-open-claim',
  'header-proof',
  'claim-proof',
  'mint-eth-deposit',
  'mint-status',
  'pay',
])

/** Assets the dest-lock (ETH/USDC) actions accept. */
export const DEST_LOCK_ASSETS: ReadonlySet<string> = new Set(['ETH', 'USDC'])

/**
 * Checks the action before routing. A missing (undefined) action means 'pay'
 * (existing behaviour); null or any other non-string is rejected. Returns the
 * action, or an error message for a 400.
 */
export function parseWalletRouteAction(raw: unknown): { action: string } | { error: string } {
  if (raw === undefined) return { action: 'pay' }
  if (typeof raw !== 'string') return { error: 'action must be a string' }
  if (!WALLET_ROUTE_ACTIONS.has(raw)) return { error: 'Unknown action' }
  return { action: raw }
}

/**
 * eth-open-claim asset check: absent means ETH (existing default); otherwise it
 * must be the string ETH or USDC (case-insensitive). Anything else is a 400.
 */
export function isDestLockAssetOk(raw: unknown): boolean {
  if (raw === undefined) return true
  return typeof raw === 'string' && DEST_LOCK_ASSETS.has(raw.trim().toUpperCase())
}
