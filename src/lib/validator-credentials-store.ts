/**
 * Optional encrypted validator signing credentials (separate from payout wallet).
 * Used for ClaimReward and validator-account payments.
 */

import type { StoredWallet } from './wallet-store'

const STORAGE_KEY = 'qxrp-validator-credentials'

export interface StoredValidatorCredentials {
  /** Validator r-address derived from falcon_secret */
  address: string
  /** Uppercase Falcon pubkey hex — ClaimReward ConsensusKey */
  consensusKeyHex: string
  encrypted: StoredWallet['encrypted']
  credentialId: string
  hasPrf: boolean
  label: string
  savedAt: number
}

export function loadValidatorCredentials(): StoredValidatorCredentials | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredValidatorCredentials
    if (!parsed?.address || !parsed?.encrypted) return null
    return parsed
  } catch {
    return null
  }
}

export function saveValidatorCredentials(entry: StoredValidatorCredentials): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entry))
}

export function clearValidatorCredentials(): void {
  localStorage.removeItem(STORAGE_KEY)
}