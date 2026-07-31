/**
 * BitVM-class vault helpers (CSV + hashlock + user CHECKSIG).
 * Matches scripts/btc-spv/bitvm/vault.py and Falcon btcParseBitvmVaultScript.
 *
 * Peg-in: fund P2WSH(vault) + OP_RETURN FALC‖AccountID
 * Peg-out: after Falcon finalize + CSV blocks, user spends vault with preimage + sig
 */

import { Wallet, hexlify, getBytes } from 'ethers'
import { sha256 } from '@noble/hashes/sha2.js'

export const VAULT_CSV_BLOCKS = 6

function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/i, '')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export function randomPreimageHex(n = 32): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(n)))
}

export function commitOfPreimage(preimageHex: string): string {
  return bytesToHex(sha256(hexToBytes(preimageHex)))
}

/** Build vault witness script (must match C++ btcParseBitvmVaultScript / vault.py). */
export function buildBitvmVaultScript(opts: {
  csvBlocks?: number
  burnCommitHex: string // 32-byte SHA256(preimage)
  userPubKeyHex: string // compressed 33-byte
}): Uint8Array {
  const csv = opts.csvBlocks ?? VAULT_CSV_BLOCKS
  const commit = hexToBytes(opts.burnCommitHex)
  const pub = hexToBytes(opts.userPubKeyHex)
  if (commit.length !== 32) throw new Error('burn commit must be 32 bytes')
  if (pub.length !== 33 && pub.length !== 65) throw new Error('user pubkey length')

  const fraud = new Uint8Array(32) // dead IF branch
  const parts: number[] = []
  parts.push(0x63) // OP_IF
  parts.push(0xa8, 0x20, ...fraud)
  parts.push(0x88) // EQUALVERIFY
  parts.push(0x51) // OP_TRUE
  parts.push(0x67) // OP_ELSE
  if (csv < 1 || csv > 16) throw new Error('CSV blocks must be 1..16 for OP_N encoding')
  parts.push(0x50 + csv) // OP_1..OP_16
  parts.push(0xb2) // OP_CSV
  parts.push(0x75) // OP_DROP
  parts.push(0xa8, 0x20, ...commit)
  parts.push(0x88) // EQUALVERIFY
  parts.push(pub.length, ...pub)
  parts.push(0xac) // CHECKSIG
  parts.push(0x68) // OP_ENDIF
  return new Uint8Array(parts)
}

/** P2WSH scriptPubKey: OP_0 OP_PUSH32 sha256(witnessScript) */
export function p2wshScriptPubKey(witnessScript: Uint8Array): Uint8Array {
  const h = sha256(witnessScript)
  return concatBytes(new Uint8Array([0x00, 0x20]), h)
}

/** Persist vault peg-in material for later claim (localStorage). */
export interface VaultDepositRecord {
  v: 1
  falconAccount: string
  fundingTxid: string
  fundingVout: number
  amountSats: number
  vaultScriptHex: string
  preimageHex: string
  commitHex: string
  userPubKeyHex: string
  csvBlocks: number
  createdAt: number
}

const VAULT_KEY = 'falcon-spv-vault-deposits-v1'

export function saveVaultDeposit(rec: VaultDepositRecord): void {
  if (typeof window === 'undefined') return
  try {
    const all = listVaultDeposits()
    all[`${rec.fundingTxid}:${rec.fundingVout}`] = rec
    localStorage.setItem(VAULT_KEY, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}

export function listVaultDeposits(): Record<string, VaultDepositRecord> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(VAULT_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, VaultDepositRecord>
  } catch {
    return {}
  }
}

export function findVaultDepositForBurn(
  falconAccount: string,
  amountSats: number,
): VaultDepositRecord | null {
  const all = listVaultDeposits()
  const matches = Object.values(all).filter(
    (r) => r.falconAccount === falconAccount && r.amountSats === amountSats,
  )
  // Prefer newest
  matches.sort((a, b) => b.createdAt - a.createdAt)
  return matches[0] ?? null
}

export function compressedPubFromBtcPriv(privateKeyHex: string): string {
  const w = new Wallet(`0x${privateKeyHex.replace(/^0x/i, '')}`)
  return w.signingKey.compressedPublicKey.replace(/^0x/i, '')
}

export { bytesToHex, hexToBytes, concatBytes, hexlify, getBytes }
