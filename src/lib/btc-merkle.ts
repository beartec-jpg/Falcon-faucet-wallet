/**
 * Independent Bitcoin Merkle proof checks (W1.3).
 * Uses double-SHA256; siblings in Bitcoin internal byte order (as Falcon expects).
 */

import { sha256 } from '@noble/hashes/sha2.js'

function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/i, '').toLowerCase()
  if (h.length % 2) throw new Error('Odd hex length')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
}

function reverseBytes(b: Uint8Array): Uint8Array {
  const o = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) o[i] = b[b.length - 1 - i]
  return o
}

function hash256(data: Uint8Array): Uint8Array {
  return sha256(sha256(data))
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const o = new Uint8Array(a.length + b.length)
  o.set(a, 0)
  o.set(b, a.length)
  return o
}

/**
 * @param txidDisplay - explorer/display txid (big-endian hex)
 * @param merkleProofHex - concatenated 32-byte siblings in **internal** order
 * @param txIndex - leaf index in block
 * @param merkleRootDisplay - block merkle root as shown by explorers (display order)
 */
export function verifyBitcoinMerkleProof(opts: {
  txidDisplay: string
  merkleProofHex: string
  txIndex: number
  merkleRootDisplay: string
}): { ok: boolean; computedRootDisplay?: string; error?: string } {
  try {
    const txid = opts.txidDisplay.replace(/^0x/i, '').toLowerCase()
    const rootDisp = opts.merkleRootDisplay.replace(/^0x/i, '').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(txid) || !/^[0-9a-f]{64}$/.test(rootDisp)) {
      return { ok: false, error: 'Invalid txid or merkle root hex' }
    }
    const proofHex = opts.merkleProofHex.replace(/^0x/i, '').toLowerCase()
    if (proofHex.length % 64 !== 0) {
      return { ok: false, error: 'Merkle proof length must be a multiple of 32 bytes' }
    }
    let idx = Math.floor(Number(opts.txIndex))
    if (!Number.isFinite(idx) || idx < 0) {
      return { ok: false, error: 'Invalid tx index' }
    }

    // Leaf hash in internal byte order
    let h = reverseBytes(hexToBytes(txid))
    for (let i = 0; i < proofHex.length; i += 64) {
      const sib = hexToBytes(proofHex.slice(i, i + 64))
      if (sib.length !== 32) return { ok: false, error: 'Bad sibling' }
      if (idx % 2 === 0) {
        h = hash256(concat(h, sib))
      } else {
        h = hash256(concat(sib, h))
      }
      idx = Math.floor(idx / 2)
    }
    const computedDisplay = bytesToHex(reverseBytes(h))
    if (computedDisplay !== rootDisp) {
      return {
        ok: false,
        computedRootDisplay: computedDisplay,
        error: 'Merkle proof does not match block merkle root',
      }
    }
    return { ok: true, computedRootDisplay: computedDisplay }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Merkle verify failed' }
  }
}
