/**
 * Falcon-512 key encoding and address derivation (browser-safe).
 * Matches xrpld wallet_propose / encodeFalconSecret layout.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { encodeAccountID } from 'ripple-address-codec'

export const FALCON512_PREFIX = 0xfb
export const FALCON512_PUB_RAW = 897
export const FALCON512_SEC_RAW = 1281
export const FALCON512_PUB_HEX_LEN = (1 + FALCON512_PUB_RAW) * 2
export const FALCON512_SECRET_HEX_LEN = (1 + FALCON512_PUB_RAW + FALCON512_SEC_RAW) * 2

export interface DecodedFalconSecret {
  pubBlob: Uint8Array
  secretKey: Uint8Array
  publicKeyHex: string
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.trim()
  if (h.length % 2 !== 0) throw new Error('Invalid hex length')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/** Zero-fill sensitive byte arrays (best-effort). */
export function zeroize(bytes: Uint8Array): void {
  bytes.fill(0)
}

export function addressFromPubBlob(pubBlob: Uint8Array): string {
  const accountId = ripemd160(sha256(pubBlob))
  return encodeAccountID(accountId)
}

export function buildPubBlob(rawPublicKey: Uint8Array): Uint8Array {
  if (rawPublicKey.length !== FALCON512_PUB_RAW) {
    throw new Error('Invalid Falcon public key length')
  }
  const pubBlob = new Uint8Array(1 + FALCON512_PUB_RAW)
  pubBlob[0] = FALCON512_PREFIX
  pubBlob.set(rawPublicKey, 1)
  return pubBlob
}

export function encodeFalconSecret(pubBlob: Uint8Array, secretKey: Uint8Array): string {
  if (pubBlob.length !== 1 + FALCON512_PUB_RAW) {
    throw new Error('Invalid Falcon public blob length')
  }
  if (secretKey.length !== FALCON512_SEC_RAW) {
    throw new Error('Invalid Falcon secret key length')
  }
  const buf = new Uint8Array(pubBlob.length + secretKey.length)
  buf.set(pubBlob, 0)
  buf.set(secretKey, pubBlob.length)
  return bytesToHex(buf)
}

export function decodeFalconSecret(hex: string): DecodedFalconSecret {
  const bytes = hexToBytes(hex)
  if (bytes.length !== 1 + FALCON512_PUB_RAW + FALCON512_SEC_RAW) {
    throw new Error('Invalid falcon_secret length')
  }
  if (bytes[0] !== FALCON512_PREFIX) {
    throw new Error('Invalid falcon_secret prefix')
  }
  const pubBlob = bytes.slice(0, 1 + FALCON512_PUB_RAW)
  const secretKey = bytes.slice(1 + FALCON512_PUB_RAW)
  return {
    pubBlob,
    secretKey,
    publicKeyHex: bytesToHex(pubBlob).toUpperCase(),
  }
}

export function validateFalconSecret(secret: string): boolean {
  const hex = secret.trim()
  if (!/^[0-9A-Fa-f]+$/.test(hex)) return false
  if (hex.length !== FALCON512_SECRET_HEX_LEN) return false
  return hex.slice(0, 2).toLowerCase() === 'fb'
}

export function keysFromFalconSecret(falcon_secret: string): {
  address: string
  publicKey: string
} {
  const { pubBlob, publicKeyHex } = decodeFalconSecret(falcon_secret)
  return {
    address: addressFromPubBlob(pubBlob),
    publicKey: publicKeyHex,
  }
}
