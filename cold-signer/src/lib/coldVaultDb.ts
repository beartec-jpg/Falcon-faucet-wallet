/**
 * Cold-device vault store.
 * Secret re-encrypted under cold password OR passkey-derived key material.
 */

export type ColdUnlockMethod = 'password' | 'passkey'

/** Cached on-chain view from hot unlock challenges (read-only). */
export interface ColdAccountSnapshot {
  balance: number
  exists: boolean
  sequence: number
  currentLedger: number
  fetchedAt: number
  networkKey?: string
  fusdc?: {
    balance: number
    currency?: string
    issuer?: string
    hasTrustLine?: boolean
  }
}

export interface ColdVaultRecord {
  id: 'main'
  address: string
  publicKey: string
  label: string
  createdAt: number
  unlockMethod: ColdUnlockMethod
  /** Present when unlockMethod === 'passkey' */
  credentialId?: string
  hasPrf?: boolean
  /** Last known ledger balances from hot unlock snapshot */
  lastAccount?: ColdAccountSnapshot
  encrypted: {
    data: string
    iv: string
    salt: string
  }
}

const DB_NAME = 'falcon-cold-signer'
const DB_VERSION = 3
const STORE = 'vault'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  bytes.forEach((b) => {
    bin += String.fromCharCode(b)
  })
  return btoa(bin)
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveFromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      iterations: 210_000,
      hash: 'SHA-256',
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function deriveFromKeyBytes(keyBytes: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    'HKDF',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      info: new TextEncoder().encode('falcon-cold-signer-v1'),
    },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function hasColdVault(): Promise<boolean> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get('main')
    req.onsuccess = () => resolve(!!req.result)
    req.onerror = () => reject(req.error)
  })
}

export type ColdVaultMeta = {
  id: 'main'
  address: string
  publicKey: string
  label: string
  createdAt: number
  unlockMethod: ColdUnlockMethod
  credentialId?: string
  hasPrf?: boolean
  lastAccount?: ColdAccountSnapshot
}

export async function loadColdVaultMeta(): Promise<ColdVaultMeta | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get('main')
    req.onsuccess = () => {
      const r = req.result as ColdVaultRecord | undefined
      if (!r) {
        resolve(null)
        return
      }
      resolve({
        id: r.id,
        address: r.address,
        publicKey: r.publicKey,
        label: r.label,
        createdAt: r.createdAt,
        unlockMethod: r.unlockMethod ?? 'password',
        credentialId: r.credentialId,
        hasPrf: r.hasPrf,
        lastAccount: r.lastAccount,
      })
    }
    req.onerror = () => reject(req.error)
  })
}

/** Persist account snapshot from hot unlock challenge (no secret involved). */
export async function updateLastAccount(snapshot: ColdAccountSnapshot): Promise<void> {
  const record = await loadFullRecord()
  record.lastAccount = snapshot
  await putRecord(record)
}

async function putRecord(record: ColdVaultRecord): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function saveColdVaultWithPassword(
  meta: { address: string; publicKey: string; label: string; createdAt: number },
  falconSecret: string,
  coldPassword: string,
): Promise<void> {
  if (coldPassword.length < 12) {
    throw new Error('Cold password must be at least 12 characters')
  }
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveFromPassphrase(coldPassword, salt)
  const enc = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer,
    },
    key,
    new TextEncoder().encode(falconSecret),
  )
  await putRecord({
    id: 'main',
    ...meta,
    unlockMethod: 'password',
    encrypted: {
      data: toBase64(enc),
      iv: toBase64(iv),
      salt: toBase64(salt),
    },
  })
}

export async function saveColdVaultWithPasskey(
  meta: { address: string; publicKey: string; label: string; createdAt: number },
  falconSecret: string,
  credentialId: string,
  keyBytes: Uint8Array,
  hasPrf: boolean,
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveFromKeyBytes(keyBytes, salt)
  const enc = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer,
    },
    key,
    new TextEncoder().encode(falconSecret),
  )
  await putRecord({
    id: 'main',
    ...meta,
    unlockMethod: 'passkey',
    credentialId,
    hasPrf,
    encrypted: {
      data: toBase64(enc),
      iv: toBase64(iv),
      salt: toBase64(salt),
    },
  })
}

async function loadFullRecord(): Promise<ColdVaultRecord> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get('main')
    req.onsuccess = () => {
      const r = req.result as ColdVaultRecord | undefined
      if (!r) reject(new Error('No vault on this device'))
      else resolve(r)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function unlockColdVaultWithPassword(coldPassword: string): Promise<{
  falcon_secret: string
  address: string
  publicKey: string
  label: string
}> {
  const record = await loadFullRecord()
  if ((record.unlockMethod ?? 'password') !== 'password') {
    throw new Error('This vault uses passkey unlock')
  }
  const salt = fromBase64(record.encrypted.salt)
  const iv = fromBase64(record.encrypted.iv)
  const key = await deriveFromPassphrase(coldPassword, salt)
  try {
    const dec = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer,
      },
      key,
      (() => {
        const b = fromBase64(record.encrypted.data)
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
      })(),
    )
    return {
      falcon_secret: new TextDecoder().decode(dec),
      address: record.address,
      publicKey: record.publicKey,
      label: record.label,
    }
  } catch {
    throw new Error('Wrong cold password')
  }
}

export async function unlockColdVaultWithPasskey(keyBytes: Uint8Array): Promise<{
  falcon_secret: string
  address: string
  publicKey: string
  label: string
}> {
  const record = await loadFullRecord()
  if (record.unlockMethod !== 'passkey') {
    throw new Error('This vault uses password unlock')
  }
  const salt = fromBase64(record.encrypted.salt)
  const iv = fromBase64(record.encrypted.iv)
  const key = await deriveFromKeyBytes(keyBytes, salt)
  try {
    const dec = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer,
      },
      key,
      (() => {
        const b = fromBase64(record.encrypted.data)
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
      })(),
    )
    return {
      falcon_secret: new TextDecoder().decode(dec),
      address: record.address,
      publicKey: record.publicKey,
      label: record.label,
    }
  } catch {
    throw new Error('Passkey unlock failed')
  }
}

/** @deprecated use unlockColdVaultWithPassword */
export async function unlockColdVault(coldPassword: string) {
  return unlockColdVaultWithPassword(coldPassword)
}

/** @deprecated use saveColdVaultWithPassword */
export async function saveColdVaultEncrypted(
  meta: { address: string; publicKey: string; label: string; createdAt: number },
  falconSecret: string,
  coldPassword: string,
) {
  return saveColdVaultWithPassword(meta, falconSecret, coldPassword)
}

export async function wipeColdVault(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete('main')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
