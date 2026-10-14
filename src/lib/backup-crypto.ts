/**
 * Password-sealed backup envelopes (audit M-4).
 *
 * Argon2id (same parameters as wallet passwords) → HKDF-free 256-bit AES-GCM key.
 * The public header (type, version, KDF params) is bound as AES-GCM additional data, so it
 * cannot be swapped or downgraded without failing decryption. Callers put everything
 * else, addresses and labels included, inside the ciphertext.
 */

import { argon2idAsync } from '@noble/hashes/argon2.js'

export interface BackupKdf {
  alg: 'argon2id'
  v: 0x13
  m: number
  t: number
  p: number
  salt: string
}

export interface SealedPayload {
  kdf: BackupKdf
  iv: string
  data: string
}

export const BACKUP_ARGON2ID = { m: 47_104, t: 2, p: 1 } as const
const MIN = { m: 19_456, t: 2, p: 1 } as const

function b64(u: Uint8Array): string {
  let s = ''
  u.forEach((x) => (s += String.fromCharCode(x)))
  return btoa(s)
}
function unb64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function ab(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
}

function aad(type: string, version: number, kdf: BackupKdf): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify([type, version, kdf.alg, kdf.v, kdf.m, kdf.t, kdf.p, kdf.salt]),
  )
}

async function aesKey(passphrase: string, kdf: BackupKdf): Promise<CryptoKey> {
  if (kdf.alg !== 'argon2id' || kdf.v !== 0x13) throw new Error('Unsupported backup KDF')
  if (kdf.m < MIN.m || kdf.t < MIN.t || kdf.p < MIN.p || kdf.m > 1_048_576 || kdf.t > 20 || kdf.p > 8) {
    throw new Error('Backup KDF parameters out of range')
  }
  const salt = unb64(kdf.salt)
  if (salt.length < 16) throw new Error('Backup KDF salt too short')
  const raw = await argon2idAsync(new TextEncoder().encode(passphrase.normalize('NFKC')), salt, {
    m: kdf.m, t: kdf.t, p: kdf.p, dkLen: 32, asyncTick: 10,
  })
  try {
    return await crypto.subtle.importKey('raw', ab(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  } finally {
    raw.fill(0)
  }
}

export async function sealBackup(type: string, version: number, plaintext: unknown, passphrase: string): Promise<SealedPayload> {
  const kdf: BackupKdf = { alg: 'argon2id', v: 0x13, ...BACKUP_ARGON2ID, salt: b64(crypto.getRandomValues(new Uint8Array(16))) }
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await aesKey(passphrase, kdf)
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ab(iv), additionalData: ab(aad(type, version, kdf)) },
    key,
    new TextEncoder().encode(JSON.stringify(plaintext)),
  )
  return { kdf, iv: b64(iv), data: b64(new Uint8Array(enc)) }
}

/** Throws 'Wrong backup password or corrupted backup file' on any failure. */
export async function openBackup<T>(type: string, version: number, sealed: SealedPayload, passphrase: string): Promise<T> {
  try {
    const key = await aesKey(passphrase, sealed.kdf)
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ab(unb64(sealed.iv)), additionalData: ab(aad(type, version, sealed.kdf)) },
      key,
      ab(unb64(sealed.data)),
    )
    return JSON.parse(new TextDecoder().decode(dec)) as T
  } catch {
    throw new Error('Wrong backup password or corrupted backup file')
  }
}

export function isSealedPayload(p: unknown): p is SealedPayload {
  const s = p as SealedPayload
  return (
    !!s && typeof s === 'object' && typeof s.iv === 'string' && typeof s.data === 'string' &&
    !!s.kdf && s.kdf.alg === 'argon2id' && typeof s.kdf.salt === 'string' &&
    Number.isFinite(s.kdf.m) && Number.isFinite(s.kdf.t) && Number.isFinite(s.kdf.p)
  )
}
