/**
 * Time-boxed vault unlock session on the hot portal.
 * Holds NO secrets — only proves the cold device recently signed a challenge
 * for this vault address.
 */

import type { VaultPublicRecord } from './vault-store'

const SESSION_KEY = 'falcon-vault-session-v1'
/** Default unlock window (ms). Cleared on tab close via sessionStorage. */
export const VAULT_SESSION_TTL_MS = 10 * 60 * 1000

export interface VaultSession {
  vaultId: string
  address: string
  publicKey: string
  unlockedAt: number
  expiresAt: number
}

export function saveVaultSession(session: VaultSession): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function loadVaultSession(): VaultSession | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as VaultSession
    if (!s.vaultId || !s.address || !s.expiresAt) return null
    if (Date.now() > s.expiresAt) {
      clearVaultSession()
      return null
    }
    return s
  } catch {
    return null
  }
}

export function clearVaultSession(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(SESSION_KEY)
}

export function isVaultUnlocked(vault: VaultPublicRecord): boolean {
  const s = loadVaultSession()
  if (!s) return false
  return s.vaultId === vault.vaultId && s.address === vault.address && Date.now() <= s.expiresAt
}

export function openVaultSession(vault: VaultPublicRecord, ttlMs = VAULT_SESSION_TTL_MS): VaultSession {
  const now = Date.now()
  const session: VaultSession = {
    vaultId: vault.vaultId,
    address: vault.address,
    publicKey: vault.publicKey,
    unlockedAt: now,
    expiresAt: now + ttlMs,
  }
  saveVaultSession(session)
  return session
}

export function sessionRemainingMs(): number {
  const s = loadVaultSession()
  if (!s) return 0
  return Math.max(0, s.expiresAt - Date.now())
}
