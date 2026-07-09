/**
 * IndexedDB storage for Falcon Ledger wallet credentials.
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
  /** Passkey-encrypted Sepolia EVM private key (hex, no 0x) for bridge deposits */
  evmEncrypted?: EncryptedSeed
  /** Checksummed 0x… address on Sepolia */
  evmAddress?: string
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

/** Newest wallet first — the app only supports one active wallet per browser. */
export function sortWalletsNewestFirst(wallets: StoredWallet[]): StoredWallet[] {
  return [...wallets].sort((a, b) => b.createdAt - a.createdAt)
}

/** Load the single active wallet (newest by createdAt), or null if none stored. */
export async function loadPrimaryWallet(): Promise<StoredWallet | null> {
  const wallets = sortWalletsNewestFirst(await loadWallets())
  return wallets[0] ?? null
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

/** Wipe every stored wallet (Falcon + bundled Sepolia keys) from this browser. */
export async function deleteAllWallets(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

/**
 * Remove wallet from device: clears IndexedDB entirely and verifies nothing remains.
 * Falcon address, passkey-encrypted seed, and Sepolia EVM key all live on the same record.
 */
export async function removeWalletFromDevice(): Promise<void> {
  await deleteAllWallets()
  const remaining = await loadWallets()
  if (remaining.length > 0) {
    throw new Error('Wallet removal failed — please try again or clear site data for this site')
  }
}

/** Replace any existing wallet(s) with a single new record (create / restore). */
export async function replacePrimaryWallet(w: StoredWallet): Promise<void> {
  await deleteAllWallets()
  await saveWallet(w)
}
