/**
 * AES-GCM 256 encryption of wallet secrets under a WalletKey (passkey PRF or Argon2id password).
 *
 * Audit H-1: the old fallback that derived the key from the WebAuthn credential rawId is gone.
 * decryptSeed refuses legacy rawId-encrypted blobs; they can only be re-wrapped (never
 * returned in plaintext) by reencryptLegacyBlob during migration, after a strong key exists.
 */

import { isWalletKey, walletKeyBytes, WalletKeyError, type WalletKey, type WalletKeySource } from '@/lib/wallet-key'

// ─── Base64 helpers ───────────────────────────────────────────────────────────

export function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  bytes.forEach(b => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function ab(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
}

// ─── Key derivation ───────────────────────────────────────────────────────────

const HKDF_INFO = 'qxrp-wallet-v1'

async function deriveAesKey(keyMaterial: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey('raw', ab(keyMaterial), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: ab(salt), info: new TextEncoder().encode(HKDF_INFO) },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ─── Encrypt / Decrypt ────────────────────────────────────────────────────────

export type BlobKek = WalletKeySource | 'legacy-rawid'

export interface EncryptedSeed {
  data: string   // base64 AES-GCM ciphertext
  iv: string     // base64 12-byte IV
  salt: string   // base64 32-byte HKDF salt
  /** true → encrypted under a passkey PRF key. Kept for older readers. */
  hasPrf: boolean
  /** Which kind of key wraps this blob. Missing on pre-H-1 blobs (see blobKek). */
  kek?: WalletKeySource
}

export class LegacyWeakBlobError extends Error {
  constructor() {
    super(
      'This wallet was saved with old, weak encryption. Unlock it again to set a password ' +
        '(or re-wrap with your passkey) before it can be used.',
    )
    this.name = 'LegacyWeakBlobError'
  }
}

/** Classify a stored blob. Pre-H-1 blobs with hasPrf=false were wrapped with the rawId. */
export function blobKek(b: EncryptedSeed): BlobKek {
  if (b.kek === 'prf' || b.kek === 'password') return b.kek
  return b.hasPrf ? 'prf' : 'legacy-rawid'
}

export function isLegacyWeakBlob(b: EncryptedSeed | undefined | null): boolean {
  return !!b && blobKek(b) === 'legacy-rawid'
}

/**
 * Encrypt a secret under a WalletKey. The third argument is ignored (kept so older call
 * sites compile); the blob records the real key source.
 */
export async function encryptSeed(seed: string, key: WalletKey, _legacyHasPrf?: boolean): Promise<EncryptedSeed> {
  const kb = walletKeyBytes(key)
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const aes = await deriveAesKey(kb, salt)
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ab(iv) }, aes, new TextEncoder().encode(seed))
  return { data: toBase64(enc), iv: toBase64(iv), salt: toBase64(salt), hasPrf: key.source === 'prf', kek: key.source }
}

async function rawDecrypt(encrypted: EncryptedSeed, material: Uint8Array): Promise<string> {
  const aes = await deriveAesKey(material, fromBase64(encrypted.salt))
  const dec = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ab(fromBase64(encrypted.iv)) },
    aes,
    ab(fromBase64(encrypted.data)),
  )
  return new TextDecoder().decode(dec)
}

/** Decrypt a secret. Requires a WalletKey of the same kind that wrapped the blob. */
export async function decryptSeed(encrypted: EncryptedSeed, key: WalletKey): Promise<string> {
  if (!isWalletKey(key)) {
    throw new WalletKeyError('A passkey PRF key or a wallet password is required to use wallet keys.')
  }
  const kind = blobKek(encrypted)
  if (kind === 'legacy-rawid') throw new LegacyWeakBlobError()
  if (kind !== key.source) {
    throw new WalletKeyError(
      kind === 'password' ? 'This wallet is protected by a password.' : 'This wallet needs your passkey (PRF).',
    )
  }
  try {
    return await rawDecrypt(encrypted, walletKeyBytes(key))
  } catch {
    throw new WalletKeyError(key.source === 'password' ? 'Wrong wallet password' : 'Passkey could not decrypt this wallet')
  }
}

/**
 * Migration only: re-wrap a legacy rawId blob under a strong key. Returns the NEW blob only;
 * the plaintext never leaves this function. Throws if the blob is not legacy.
 */
export async function reencryptLegacyBlob(
  legacy: EncryptedSeed,
  rawIdBytes: Uint8Array,
  newKey: WalletKey,
): Promise<EncryptedSeed> {
  if (!isLegacyWeakBlob(legacy)) throw new Error('Not a legacy blob')
  if (!isWalletKey(newKey)) throw new WalletKeyError('A strong key is required to migrate')
  const plain = await rawDecrypt(legacy, rawIdBytes)
  return encryptSeed(plain, newKey)
}
