/**
 * Offline gate for the Falcon cold signer.
 *
 * Policy (updated for read-only device unlock + testing):
 *  - **No vault:** online OK (install, import).
 *  - **Vault + device locked/unlocked (password/passkey):** online OK for
 *    **read-only** views (last known balance). Soft banner when online.
 *  - **Sign / vault-unlock QR (uses secret for tx):** must be offline.
 *
 * navigator.onLine is imperfect — treat any connected interface as "online".
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
 */
export function allowOnlineOverride(): boolean {
  try {
    return localStorage.getItem('falcon-cold-allow-online') === '1'
  } catch {
    return false
  }
}

/**
 * Full-screen wall only when we need to force airplane before secret use.
 * Prefer soft banners; hard-block is applied via assertOfflineForVaultOps.
 */
export function isVaultOpsBlocked(_hasVault: boolean, _online: boolean): boolean {
  return false
}

/**
 * Call before unlock-QR response signing and transaction signing.
 * Device password/passkey unlock and balance display do NOT require offline.
 */
export function assertOfflineForVaultOps(hasVault = true): void {
  if (allowOnlineOverride()) return
  if (!hasVault) return
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    throw new Error(
      'Airplane mode required to sign. Turn off Wi‑Fi and mobile data, then try again.',
    )
  }
}

/** @deprecated use assertOfflineForVaultOps */
export function assertOfflineForOps(): void {
  assertOfflineForVaultOps(true)
}
