/**
 * Offline gate for the Falcon cold signer.
 *
 * Policy:
 *  - **No vault on device:** online is fully allowed (download PWA, install,
 *    import vault file). Same fix as Crypto: you cannot install while walled.
 *  - **Vault present:** any secret use (unlock, sign, unlock-QR) requires
 *    offline / airplane mode. Going online mid-session locks and walls.
 *
 * navigator.onLine is imperfect (LAN without WAN still "online") — we treat any
 * connected interface as unsafe once a vault exists.
 */

export type OnlineState = {
  online: boolean
}

export function readOnlineState(): OnlineState {
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true
  return { online }
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

/** True when secret ops must be blocked (vault loaded + online). */
export function isVaultOpsBlocked(hasVault: boolean, online: boolean): boolean {
  if (allowOnlineOverride()) return false
  if (!hasVault) return false
  return online
}

/**
 * Call before unlock / sign / unlock-QR — not before install or empty-state UI.
 * Import is allowed online so the first-time path works; user should still go
 * offline afterward.
 */
export function assertOfflineForVaultOps(hasVault = true): void {
  if (allowOnlineOverride()) return
  if (!hasVault) return
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    throw new Error(
      'Airplane mode required. Turn off Wi‑Fi and mobile data before unlocking or signing.',
    )
  }
}

/** @deprecated use assertOfflineForVaultOps */
export function assertOfflineForOps(): void {
  assertOfflineForVaultOps(true)
}
