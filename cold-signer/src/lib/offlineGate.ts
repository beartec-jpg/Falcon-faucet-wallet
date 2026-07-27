/**
 * Hard offline gate for the Falcon cold signer.
 *
 * Policy:
 *  - Install / first cache: online is OK (need network once to download PWA + SW).
 *  - Any vault crypto (import secret, unlock, sign, unlock-QR): MUST be offline.
 *
 * navigator.onLine is imperfect (LAN without WAN still "online") — we treat any
 * connected interface as unsafe and require airplane mode for ops.
 */

export type OnlineState = {
  online: boolean
  /** True when we allow install UI but block secrets */
  opsBlocked: boolean
}

export function readOnlineState(): OnlineState {
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true
  return { online, opsBlocked: online }
}

/**
 * Dev override: set localStorage falcon-cold-allow-online=1 for local testing only.
 * Never document this in end-user copy.
 */
export function allowOnlineOverride(): boolean {
  try {
    return localStorage.getItem('falcon-cold-allow-online') === '1'
  } catch {
    return false
  }
}

export function assertOfflineForOps(): void {
  if (allowOnlineOverride()) return
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    throw new Error(
      'Airplane mode required. Turn off Wi‑Fi and mobile data before using the cold signer.',
    )
  }
}
