// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 BEARTEC

import { bytesToHex, hexToBytes, utf8 } from './hex.js'
import {
  getFalcon,
  FALCON512_PUBLIC_KEY_BYTES as PK,
  FALCON512_SECRET_KEY_BYTES as SK,
  FALCON512_MAX_SIGNATURE_BYTES,
} from './falcon.js'
import { addressFromPublicKey, publicKeyBlob, FALCON512_PREFIX } from './address.js'

/**
 * A Falcon-512 key pair. `secretKey` is raw liboqs bytes: keep it off servers
 * and logs. Call `destroy()` when finished to zero it.
 */
export interface FalconKeyPair {
  publicKey: Uint8Array
  secretKey: Uint8Array
  /** Lowercase hex of the raw public key (the tx `public_key` field). */
  publicKeyHex: string
  address: string
  destroy(): void
}

function pair(publicKey: Uint8Array, secretKey: Uint8Array): FalconKeyPair {
  if (publicKey.length !== PK) throw new Error('invalid Falcon-512 public key length')
  if (secretKey.length !== SK) throw new Error('invalid Falcon-512 secret key length')
  return {
    publicKey,
    secretKey,
    publicKeyHex: bytesToHex(publicKey),
    address: addressFromPublicKey(publicKey),
    destroy: () => secretKey.fill(0),
  }
}

export async function generateKeyPair(): Promise<FalconKeyPair> {
  const f = await getFalcon()
  const { publicKey, secretKey } = f.generateKeyPair()
  return pair(publicKey, secretKey)
}

/**
 * Wallet export format (`falcon_secret`): hex of 0xFB || pk(897) || sk(1281).
 * Byte-identical to the Falcon wallet's `encodeFalconSecret`.
 */
export function encodeFalconSecret(kp: Pick<FalconKeyPair, 'publicKey' | 'secretKey'>): string {
  const blob = publicKeyBlob(kp.publicKey)
  const buf = new Uint8Array(blob.length + SK)
  buf.set(blob)
  buf.set(kp.secretKey, blob.length)
  const hex = bytesToHex(buf)
  buf.fill(0)
  return hex
}

export function keyPairFromFalconSecret(falconSecret: string): FalconKeyPair {
  const b = hexToBytes(falconSecret)
  if (b.length !== 1 + PK + SK) throw new Error('invalid falcon_secret length')
  if (b[0] !== FALCON512_PREFIX) throw new Error('invalid falcon_secret prefix')
  const kp = pair(b.slice(1, 1 + PK), b.slice(1 + PK))
  b.fill(0)
  return kp
}

export type SecretInput = FalconKeyPair | Uint8Array | string

function secretBytes(s: SecretInput): { sk: Uint8Array; owned: boolean } {
  if (typeof s === 'string') return { sk: keyPairFromFalconSecret(s).secretKey, owned: true }
  if (s instanceof Uint8Array) return { sk: s, owned: false }
  return { sk: s.secretKey, owned: false }
}

/** Detached Falcon-512 signature over `message` (bytes or UTF-8 string). */
export async function sign(message: Uint8Array | string, secret: SecretInput): Promise<Uint8Array> {
  const f = await getFalcon()
  const { sk, owned } = secretBytes(secret)
  try {
    return f.sign(typeof message === 'string' ? utf8(message) : message, sk)
  } finally {
    if (owned) sk.fill(0)
  }
}

/** Verify a detached Falcon-512 signature. Returns false on any malformed input. */
export async function verify(
  message: Uint8Array | string,
  signature: Uint8Array | string,
  publicKey: Uint8Array | string,
): Promise<boolean> {
  try {
    const pk = typeof publicKey === 'string' ? hexToBytes(publicKey) : publicKey
    const sig = typeof signature === 'string' ? hexToBytes(signature) : signature
    if (pk.length !== PK || sig.length === 0 || sig.length > FALCON512_MAX_SIGNATURE_BYTES) return false
    const f = await getFalcon()
    return f.verify(typeof message === 'string' ? utf8(message) : message, sig, pk)
  } catch {
    return false
  }
}
