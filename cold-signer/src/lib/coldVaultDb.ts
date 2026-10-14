/**
 * Cold-device vault store.
 * Secret re-encrypted under cold password OR passkey-derived key material.
 */

import { argon2idAsync } from '@noble/hashes/argon2.js'

export type ColdUnlockMethod = 'password' | 'passkey'

/** Same Argon2id parameters as the hot wallet (audit H-1/H-3). */
export const COLD_ARGON2ID = { m: 47_104, t: 2, p: 1 } as const
export type ColdKdf = { alg: 'argon2id'; v: 0x13; m: number; t: number; p: number }

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
  /** Password KDF. Absent = legacy PBKDF2 record (re-wrapped to Argon2id on next unlock). */
  kdf?: ColdKdf
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

async function deriveArgon2id(passphrase: string, salt: Uint8Array, kdf: ColdKdf): Promise<CryptoKey> {
  if (kdf.alg !== 'argon2id' || kdf.v !== 0x13 || kdf.m < 19_456 || kdf.t < 2 || kdf.p < 1) {
    throw new Error('Unsupported vault KDF')
  }
  const raw = await argon2idAsync(new TextEncoder().encode(passphrase.normalize('NFKC')), salt, {
    m: kdf.m,
    t: kdf.t,
    p: kdf.p,
    dkLen: 32,
  })
  try {
    return await crypto.subtle.importKey('raw', raw.slice().buffer as ArrayBuffer, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ])
  } finally {
    raw.fill(0)
  }
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


type VaultMeta = { address: string; publicKey: string; label: string; createdAt: number }
export type ColdSession = { falcon_secret: string; address: string; publicKey: string; label: string }

function ab(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
}

async function seal(key: CryptoKey, secret: string, salt: Uint8Array) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ab(iv) }, key, new TextEncoder().encode(secret))
  return { data: toBase64(enc), iv: toBase64(iv), salt: toBase64(salt) }
}

async function open_(key: CryptoKey, record: ColdVaultRecord): Promise<string> {
  const iv = fromBase64(record.encrypted.iv)
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ab(iv) }, key, ab(fromBase64(record.encrypted.data)))
  return new TextDecoder().decode(dec)
}

function sessionOf(record: ColdVaultRecord, falcon_secret: string): ColdSession {
  return { falcon_secret, address: record.address, publicKey: record.publicKey, label: record.label }
}

function metaOf(r: ColdVaultRecord): VaultMeta {
  return { address: r.address, publicKey: r.publicKey, label: r.label, createdAt: r.createdAt }
}

/** True when the stored passkey vault was keyed with the credential ID (pre-H-3). */
export function isLegacyWeakPasskeyRecord(r: Pick<ColdVaultRecord, 'unlockMethod' | 'hasPrf'>): boolean {
  return r.unlockMethod === 'passkey' && r.hasPrf !== true
}

export async function saveColdVaultWithPassword(
  meta: VaultMeta,
  falconSecret: string,
  coldPassword: string,
  extra: Partial<Pick<ColdVaultRecord, 'lastAccount'>> = {},
): Promise<void> {
  if (coldPassword.length < 12) {
    throw new Error('Cold password must be at least 12 characters')
  }
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const kdf: ColdKdf = { alg: 'argon2id', v: 0x13, ...COLD_ARGON2ID }
  const key = await deriveArgon2id(coldPassword, salt, kdf)
  await putRecord({
    id: 'main',
    ...meta,
    ...extra,
    unlockMethod: 'password',
    kdf,
    encrypted: await seal(key, falconSecret, salt),
  })
}

/**
 * Passkey protection requires WebAuthn PRF output (>= 32 bytes). The credential ID is
 * public metadata and is never used as key material (audit H-3). Fails closed.
 */
export async function saveColdVaultWithPasskey(
  meta: VaultMeta,
  falconSecret: string,
  credentialId: string,
  prfOutput: Uint8Array,
  extra: Partial<Pick<ColdVaultRecord, 'lastAccount'>> = {},
): Promise<void> {
  if (!(prfOutput instanceof Uint8Array) || prfOutput.byteLength < 32) {
    throw new Error('This passkey does not support PRF. Use a password to protect the vault.')
  }
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const key = await deriveFromKeyBytes(prfOutput, salt)
  await putRecord({
    id: 'main',
    ...meta,
    ...extra,
    unlockMethod: 'passkey',
    credentialId,
    hasPrf: true,
    encrypted: await seal(key, falconSecret, salt),
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

export async function unlockColdVaultWithPassword(coldPassword: string): Promise<ColdSession> {
  const record = await loadFullRecord()
  if ((record.unlockMethod ?? 'password') !== 'password') {
    throw new Error('This vault uses passkey unlock')
  }
  const salt = fromBase64(record.encrypted.salt)
  let secret: string
  try {
    const key = record.kdf
      ? await deriveArgon2id(coldPassword, salt, record.kdf)
      : await deriveFromPassphrase(coldPassword, salt)
    secret = await open_(key, record)
  } catch (e) {
    if (e instanceof Error && e.message === 'Unsupported vault KDF') throw e
    throw new Error('Wrong cold password')
  }
  if (!record.kdf) {
    // Legacy PBKDF2 record: re-wrap under Argon2id and overwrite.
    await saveColdVaultWithPassword(metaOf(record), secret, coldPassword, { lastAccount: record.lastAccount })
  }
  return sessionOf(record, secret)
}

/** Unlock a PRF-protected passkey vault. Legacy credential-ID vaults are refused here. */
export async function unlockColdVaultWithPasskey(prfOutput: Uint8Array | null): Promise<ColdSession> {
  const record = await loadFullRecord()
  if (record.unlockMethod !== 'passkey') {
    throw new Error('This vault uses password unlock')
  }
  if (isLegacyWeakPasskeyRecord(record)) {
    throw new Error('This vault must be migrated before unlock')
  }
  if (!(prfOutput instanceof Uint8Array) || prfOutput.byteLength < 32) {
    throw new Error('Passkey did not return PRF output; unlock refused')
  }
  try {
    const key = await deriveFromKeyBytes(prfOutput, fromBase64(record.encrypted.salt))
    return sessionOf(record, await open_(key, record))
  } catch {
    throw new Error('Passkey unlock failed')
  }
}

/**
 * Migrate a pre-H-3 passkey vault (encrypted under the credential ID). The legacy key is used
 * once, only to decrypt; the secret is immediately re-wrapped and the weak blob overwritten:
 *  - with PRF output when the authenticator now returns it, otherwise
 *  - with a new cold password (Argon2id). With neither, migration fails closed.
 */
export async function migrateLegacyPasskeyVault(opts: {
  assertedRawId: Uint8Array
  prfOutput: Uint8Array | null
  newPassword?: string
}): Promise<{ session: ColdSession; method: ColdUnlockMethod }> {
  const record = await loadFullRecord()
  if (!isLegacyWeakPasskeyRecord(record)) throw new Error('Vault does not need migration')
  const usePrf = opts.prfOutput instanceof Uint8Array && opts.prfOutput.byteLength >= 32
  if (!usePrf && !(opts.newPassword && opts.newPassword.length >= 12)) {
    throw new Error('This passkey has no PRF support. Set a cold password (12+ characters) to finish the upgrade.')
  }
  if (toBase64Url(opts.assertedRawId) !== record.credentialId) {
    throw new Error('Passkey does not match this vault')
  }
  let secret: string
  try {
    const legacyKey = await deriveFromKeyBytes(opts.assertedRawId, fromBase64(record.encrypted.salt))
    secret = await open_(legacyKey, record)
  } catch {
    throw new Error('Passkey unlock failed')
  }
  if (usePrf) {
    await saveColdVaultWithPasskey(metaOf(record), secret, record.credentialId!, opts.prfOutput!, {
      lastAccount: record.lastAccount,
    })
  } else {
    await saveColdVaultWithPassword(metaOf(record), secret, opts.newPassword!, { lastAccount: record.lastAccount })
  }
  return { session: sessionOf(record, secret), method: usePrf ? 'passkey' : 'password' }
}

function toBase64Url(u: Uint8Array): string {
  return toBase64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
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
