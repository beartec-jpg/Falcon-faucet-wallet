// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 BEARTEC

export function bytesToHex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.trim().replace(/^0x/i, '')
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error('invalid hex')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** Best-effort zero-fill of secret material. */
export function zeroize(bytes: Uint8Array): void {
  bytes.fill(0)
}

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)
