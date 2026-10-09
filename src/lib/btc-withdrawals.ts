/**
 * Single switch for FBTC → BTC withdrawals (Bridge out to Bitcoin).
 *
 * Source of truth: `btc_withdrawals_enabled` in public/config/btc-spv-bridge.json.
 * Turning withdrawals back on is a one-line change there. Anything other than
 * an explicit `true` counts as off. BTC deposits are not affected.
 *
 * Gated entry points (keep in sync; checked by scripts/verify-btc-withdrawals-off.mjs):
 *   - UI: BridgeDepositPanel FBTC Bridge out (button + handler)
 *   - API: /api/wallet/submit refuses a BTC rail_withdraw (the FBTC burn)
 *   - API: /api/wallet and /api/wallet/pl refuse every btc-* walletd action
 *     (btc-kickoff, btc-take) before anything is forwarded
 * Read-only status/lookup routes stay open so a pending withdrawal stays visible.
 */
import btcBridgeConfig from '../../public/config/btc-spv-bridge.json'

export const BTC_WITHDRAWALS_ENABLED =
  (btcBridgeConfig as { btc_withdrawals_enabled?: unknown }).btc_withdrawals_enabled === true

export const BTC_WITHDRAWALS_OFF_MESSAGE = 'BTC withdrawals are in final testing.'

export const BTC_WITHDRAWALS_OFF_ERROR =
  'BTC withdrawals are in final testing. Bridge out to Bitcoin is switched off for now; BTC deposits still work.'

export const BTC_WITHDRAWALS_OFF_CODE = 'btc_withdrawals_disabled'

/** JSON body + HTTP status for a refused BTC withdrawal step. */
export function btcWithdrawalsOffResponse(): {
  body: { error: string; code: string }
  status: number
} {
  return { body: { error: BTC_WITHDRAWALS_OFF_ERROR, code: BTC_WITHDRAWALS_OFF_CODE }, status: 503 }
}

/**
 * walletd actions that sign or broadcast a BTC-side withdrawal step
 * (today: btc-kickoff, btc-take). Every `btc-*` / `btc_*` action counts, so a
 * future BTC withdrawal action is refused by default while the flag is off.
 */
export function isBtcWithdrawWalletdAction(action: unknown): boolean {
  return typeof action === 'string' && /^btc[-_]/i.test(action.trim())
}

/**
 * True when a Falcon PL tx (object or exact JSON string) is a BTC rail_withdraw,
 * i.e. the FBTC burn that starts a BTC withdrawal.
 */
export function isBtcPegOutPlTx(tx: unknown): boolean {
  let t: unknown = tx
  if (typeof t === 'string') {
    const raw = t
    try {
      t = JSON.parse(raw)
    } catch {
      // Fail closed on text we cannot parse but that looks like a BTC burn.
      return /rail_withdraw/i.test(raw) && /"btc"/i.test(raw)
    }
  }
  if (!t || typeof t !== 'object') return false
  let body = (t as { body?: unknown }).body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      return false
    }
  }
  if (!body || typeof body !== 'object') return false
  const b = body as { kind?: unknown; asset?: unknown }
  return (
    String(b.kind ?? '').trim().toLowerCase() === 'rail_withdraw' &&
    String(b.asset ?? '').trim().toUpperCase() === 'BTC'
  )
}
