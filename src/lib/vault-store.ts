/**
 * IndexedDB storage for Falcon vault PUBLIC records only.
 * Never stores falcon_secret — secrets live only on the cold signer / offline media.
 */

const DB_NAME = 'falcon-vault'
const DB_VERSION = 1
const STORE = 'vaults'

export interface VaultPublicRecord {
  vaultId: string
  address: string
  publicKey: string
  label: string
  createdAt: number
  fingerprint?: string
  /** Only address the vault may pay (hot wallet). */
  payoutAddress?: string
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'vaultId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveVaultPublic(v: VaultPublicRecord): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(v)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadVaults(): Promise<VaultPublicRecord[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => {
      const list = (req.result as VaultPublicRecord[]).sort((a, b) => b.createdAt - a.createdAt)
      resolve(list)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function loadPrimaryVault(): Promise<VaultPublicRecord | null> {
  const list = await loadVaults()
  return list[0] ?? null
}

export async function deleteVault(vaultId: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(vaultId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function replacePrimaryVault(v: VaultPublicRecord): Promise<void> {
  const existing = await loadVaults()
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const e of existing) store.delete(e.vaultId)
    store.put(v)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export function newVaultId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
