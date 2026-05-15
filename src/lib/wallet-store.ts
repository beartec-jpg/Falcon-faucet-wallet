/**
 * IndexedDB storage for qXRP wallet credentials.
 * All operations run in the browser only.
 */

import type { EncryptedSeed } from './wallet-crypto'

const DB_NAME    = 'qxrp-wallet'
const DB_VERSION = 1
const STORE      = 'wallets'

export interface StoredWallet {
  credentialId: string   // base64url — primary key (WebAuthn credential ID)
  address:      string   // rXXX… XRPL classic address
  publicKey:    string   // hex public key (for display / verification)
  label:        string   // user-provided name
  encrypted:    EncryptedSeed
  hasPrf:       boolean  // true if PRF extension was available at creation
  createdAt:    number   // Date.now()
}

// ─── DB init ──────────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'credentialId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function saveWallet(w: StoredWallet): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(w)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

export async function loadWallets(): Promise<StoredWallet[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result as StoredWallet[])
    req.onerror   = () => reject(req.error)
  })
}

export async function deleteWallet(credentialId: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(credentialId)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}
