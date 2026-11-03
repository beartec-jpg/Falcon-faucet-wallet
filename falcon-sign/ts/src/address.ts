// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 BEARTEC

import { sha256 } from '@noble/hashes/sha2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { bytesToHex } from './hex.js'
import { FALCON512_PUBLIC_KEY_BYTES } from './falcon.js'

/** Falcon-512 key-type prefix byte used in wallet public-key blobs. */
export const FALCON512_PREFIX = 0xfb

const ALPHABET = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz'

function base58(bytes: Uint8Array): string {
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  let out = ''
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out
    n /= 58n
  }
  for (const b of bytes) {
    if (b !== 0) break
    out = ALPHABET[0] + out
  }
  return out
}

/** 0xFB || raw public key (898 bytes), as the wallet stores it. */
export function publicKeyBlob(rawPublicKey: Uint8Array): Uint8Array {
  if (rawPublicKey.length !== FALCON512_PUBLIC_KEY_BYTES) throw new Error('invalid Falcon-512 public key length')
  const blob = new Uint8Array(1 + FALCON512_PUBLIC_KEY_BYTES)
  blob[0] = FALCON512_PREFIX
  blob.set(rawPublicKey, 1)
  return blob
}

/**
 * Wallet address for a Falcon key: classic base58check of
 * RIPEMD160(SHA256(0xFB || pk)), the same as the Falcon wallet's
 * `addressFromPubBlob`. Named accounts (e.g. `alice`) are also valid FPL
 * account ids; the address is the default when no name is registered.
 */
export function addressFromPublicKey(rawPublicKey: Uint8Array): string {
  const id = ripemd160(sha256(publicKeyBlob(rawPublicKey)))
  const payload = new Uint8Array(21)
  payload.set(id, 1)
  const check = sha256(sha256(payload)).slice(0, 4)
  const full = new Uint8Array(25)
  full.set(payload)
  full.set(check, 21)
  return base58(full)
}

/** `PayToKey` commitment: sha256 hex of the raw 897-byte public key. */
export function keyHash(rawPublicKey: Uint8Array): string {
  if (rawPublicKey.length !== FALCON512_PUBLIC_KEY_BYTES) throw new Error('invalid Falcon-512 public key length')
  return bytesToHex(sha256(rawPublicKey))
}
