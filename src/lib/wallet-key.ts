/**
 * Wallet key-encryption keys (KEKs).
 *
 * A WalletKey is the only thing encryptSeed/decryptSeed accept. It can be made in exactly
 * two ways:
 *   • from a WebAuthn PRF output (32+ bytes, secret, tied to the passkey private key), or
 *   • from a user password through Argon2id.
 *
 * Nothing stored on the device (credential ID, rawId, KDF salt, check value) is enough to
 * build one. There is deliberately NO constructor from a credential ID or rawId (audit H-1).
 */

import { argon2idAsync } from '@noble/hashes/argon2.js'

export type WalletKeySource = 'prf' | 'password' | 'prf+password'

const KEY_BRAND = Symbol('falcon.walletKey')

export interface WalletKey {
  readonly source: WalletKeySource
  /** @internal raw 32-byte KEK input. Read only through walletKeyBytes(). */
  readonly [KEY_BRAND]: Uint8Array
}

function makeKey(source: WalletKeySource, bytes: Uint8Array): WalletKey {
  return Object.freeze({ source, [KEY_BRAND]: new Uint8Array(bytes) }) as WalletKey
}

export function isWalletKey(k: unknown): k is WalletKey {
  return (
    typeof k === 'object' &&
    k !== null &&
    (KEY_BRAND in (k as object)) &&
    ((k as WalletKey).source === 'prf' ||
      (k as WalletKey).source === 'password' ||
      (k as WalletKey).source === 'prf+password') &&
    (k as WalletKey)[KEY_BRAND] instanceof Uint8Array &&
    (k as WalletKey)[KEY_BRAND].length === 32
  )
}

/** @internal used by wallet-crypto only. */
export function walletKeyBytes(k: WalletKey): Uint8Array {
  if (!isWalletKey(k)) {
    throw new WalletKeyError('A passkey PRF key or a wallet password is required to use wallet keys.')
  }
  return k[KEY_BRAND]
}

export class WalletKeyError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'WalletKeyError'
  }
}

/** Build a key from a WebAuthn PRF result. Rejects anything shorter than 32 bytes. */
export function walletKeyFromPrf(prfOutput: ArrayBuffer | Uint8Array): WalletKey {
  const b = prfOutput instanceof Uint8Array ? prfOutput : new Uint8Array(prfOutput)
  if (b.length < 32) throw new WalletKeyError('Passkey PRF output is too short')
  return makeKey('prf', b.slice(0, 32))
}

// ─── Password KDF (Argon2id) ────────────────────────────────────────────────

export interface PasswordKdfParams {
  alg: 'argon2id'
  v: 0x13
  /** memory in KiB */
  m: number
  t: number
  p: number
  /** base64 16-byte random salt */
  salt: string
}

/** RFC 9106 / OWASP-range parameters: 46 MiB, 2 passes, 1 lane (~1 s desktop). */
export const DEFAULT_ARGON2ID = { m: 47_104, t: 2, p: 1 } as const
/** Floors enforced on stored params so a tampered record cannot downgrade the KDF. */
const MIN_ARGON2ID = { m: 19_456, t: 2, p: 1 } as const

function b64(bytes: Uint8Array): string {
  let s = ''
  bytes.forEach((x) => (s += String.fromCharCode(x)))
  return btoa(s)
}
function unb64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function newPasswordKdfParams(): PasswordKdfParams {
  return { alg: 'argon2id', v: 0x13, ...DEFAULT_ARGON2ID, salt: b64(crypto.getRandomValues(new Uint8Array(16))) }
}

export async function walletKeyFromPassword(password: string, params: PasswordKdfParams): Promise<WalletKey> {
  if (params.alg !== 'argon2id' || params.v !== 0x13) throw new WalletKeyError('Unsupported password KDF')
  if (params.m < MIN_ARGON2ID.m || params.t < MIN_ARGON2ID.t || params.p < MIN_ARGON2ID.p) {
    throw new WalletKeyError('Password KDF parameters are below the minimum')
  }
  const salt = unb64(params.salt)
  if (salt.length < 16) throw new WalletKeyError('Password KDF salt is too short')
  if (!password) throw new WalletKeyError('Password required')
  const out = await argon2idAsync(new TextEncoder().encode(password.normalize('NFKC')), salt, {
    m: params.m,
    t: params.t,
    p: params.p,
    dkLen: 32,
    asyncTick: 10,
  })
  try {
    return makeKey('password', out)
  } finally {
    out.fill(0)
  }
}

// ─── Two-factor key: passkey PRF + password ─────────────────────────────────

const COMBINED_SALT = new TextEncoder().encode('falcon-kek-prf+password-v1')
const COMBINED_INFO = new TextEncoder().encode('falcon wallet kek: HKDF(prf || argon2id(password))')

/**
 * Combine a PRF key and an Argon2id password key into one KEK:
 *   KEK = HKDF-SHA256(ikm = prfOutput || Argon2id(password, salt)).
 * Neither factor alone (e.g. a compromised P-256 passkey) is enough to rebuild it.
 */
export async function walletKeyFromPrfAndPassword(prfKey: WalletKey, passwordKey: WalletKey): Promise<WalletKey> {
  if (!isWalletKey(prfKey) || prfKey.source !== 'prf') throw new WalletKeyError('A passkey PRF key is required')
  if (!isWalletKey(passwordKey) || passwordKey.source !== 'password') throw new WalletKeyError('A wallet password key is required')
  const ikm = new Uint8Array(64)
  ikm.set(prfKey[KEY_BRAND], 0)
  ikm.set(passwordKey[KEY_BRAND], 32)
  try {
    const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
    const bits = new Uint8Array(
      await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: COMBINED_SALT, info: COMBINED_INFO }, base, 256),
    )
    try {
      return makeKey('prf+password', bits)
    } finally {
      bits.fill(0)
    }
  } finally {
    ikm.fill(0)
  }
}

// ─── Password strength ──────────────────────────────────────────────────────

const COMMON = new Set([
  'password1234', 'passwordpassword', 'qwertyuiop12', '123456789012', 'letmein12345',
  'iloveyou1234', 'falconwallet', 'falcon123456', 'administrator', 'welcome12345',
])

/** Minimum wallet password policy. Returns an error message, or null when acceptable. */
export function validateWalletPassword(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < 12) return 'Password must be at least 12 characters'
  if (pw.length > 1024) return 'Password is too long'
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  if (classes < 3) return 'Password must contain at least 3 of: uppercase, lowercase, numbers, symbols'
  if (new Set(pw).size < 6) return 'Password has too many repeated characters'
  if (COMMON.has(pw.toLowerCase())) return 'Password is too common'
  return null
}
