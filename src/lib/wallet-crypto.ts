/**
 * AES-GCM 256-bit encryption for XRPL seeds.
 *
 * Key derivation strategy (in priority order):
 *  1. WebAuthn PRF extension output (strongest — 32-byte secret tied to passkey private key)
 *  2. Credential rawId bytes (weaker fallback — rawId is semi-public information)
 *
 * WARNING (M-2): When PRF is unavailable, encryption strength is reduced.
 * This is acceptable only for testnet. Do not reuse these wallets for real value
 * or mainnet accounts. Consider adding a user passphrase as a second factor in the future.
 */

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

// ─── Key derivation ───────────────────────────────────────────────────────────

async function deriveAesKey(
  keyMaterialBytes: Uint8Array,
  salt: Uint8Array
): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey(
    'raw', keyMaterialBytes.buffer.slice(keyMaterialBytes.byteOffset, keyMaterialBytes.byteOffset + keyMaterialBytes.byteLength) as ArrayBuffer,
    'HKDF', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      info: new TextEncoder().encode('qxrp-wallet-v1'),
    },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

// ─── Encrypt / Decrypt ────────────────────────────────────────────────────────

export interface EncryptedSeed {
  data: string   // base64 AES-GCM ciphertext
  iv: string     // base64 12-byte IV
  salt: string   // base64 32-byte HKDF salt
  hasPrf: boolean
}

/**
 * Encrypt an XRPL seed using key material from the passkey.
 * @param seed       - XRPL secret (e.g. sXXX…)
 * @param keyBytes   - 32-byte PRF output OR credential rawId bytes
 * @param hasPrf     - true if keyBytes came from PRF extension
 */
export async function encryptSeed(
  seed: string,
  keyBytes: Uint8Array,
  hasPrf: boolean
): Promise<EncryptedSeed> {
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const iv   = crypto.getRandomValues(new Uint8Array(12))
  const key  = await deriveAesKey(keyBytes, salt)
  const enc  = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer },
    key,
    new TextEncoder().encode(seed)
  )
  return {
    data: toBase64(enc),
    iv:   toBase64(iv),
    salt: toBase64(salt),
    hasPrf,
  }
}

/**
 * Decrypt an XRPL seed.
 * @param encrypted  - result of encryptSeed
 * @param keyBytes   - same key material used during encryption
 */
export async function decryptSeed(
  encrypted: EncryptedSeed,
  keyBytes: Uint8Array
): Promise<string> {
  const salt = fromBase64(encrypted.salt)
  const iv   = fromBase64(encrypted.iv)
  const key  = await deriveAesKey(keyBytes, salt)
  const dec  = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer },
    key,
    (() => { const b = fromBase64(encrypted.data); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer })()
  )
  return new TextDecoder().decode(dec)
}
