/**
 * Per-credential record of how wallet keys are wrapped (passkey PRF or password).
 * Holds only public parameters: mode, Argon2id salt/params and an AES-GCM check value
 * encrypted under the key. None of it allows decryption without the PRF output or password.
 */

import type { PasswordKdfParams } from '@/lib/wallet-key'
import type { EncryptedSeed } from '@/lib/wallet-crypto'

const DB_NAME = 'falcon-kek'
const DB_VERSION = 1
const STORE = 'keks'

export interface KekRecord {
  credentialId: string
  mode: 'prf' | 'password'
  kdf?: PasswordKdfParams
  /** encryptSeed(KEK_CHECK_PLAINTEXT) under the key: detects a wrong password early. */
  check?: EncryptedSeed
  createdAt: number
}

export const KEK_CHECK_PLAINTEXT = 'falcon-kek-check-v1'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'credentialId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadKekRecord(credentialId: string): Promise<KekRecord | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(credentialId)
    req.onsuccess = () => resolve((req.result as KekRecord | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function saveKekRecord(r: KekRecord): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(r)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function deleteKekRecord(credentialId: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(credentialId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
