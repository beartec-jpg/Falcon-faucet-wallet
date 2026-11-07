// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 BEARTEC
//
// Falcon-512 via liboqs (Open Quantum Safe) compiled to WebAssembly by
// @openforge-sh/liboqs, the same build the Falcon wallet uses. Works in Node
// (>=20) and in browsers / bundlers.

export const FALCON512_PUBLIC_KEY_BYTES = 897
export const FALCON512_SECRET_KEY_BYTES = 1281
export const FALCON512_MAX_SIGNATURE_BYTES = 752

/** Minimal Falcon-512 backend. Detached signatures, raw 897-byte public keys. */
export interface FalconBackend {
  generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array }
  sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array
  verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean
}

let backend: FalconBackend | null = null
let loading: Promise<FalconBackend> | null = null

/**
 * Use a custom Falcon-512 backend (for example a pre-loaded WASM instance in
 * an offline page). Must produce standard detached Falcon-512 signatures.
 */
export function setFalconBackend(b: FalconBackend): void {
  backend = b
  loading = Promise.resolve(b)
}

/** Lazily load the liboqs Falcon-512 backend (singleton). */
export async function getFalcon(): Promise<FalconBackend> {
  if (backend) return backend
  if (!loading) {
    loading = import('@openforge-sh/liboqs/sig').then(async (m) => {
      const f = (await m.createFalcon512()) as unknown as FalconBackend
      backend = f
      return f
    })
  }
  return loading
}
