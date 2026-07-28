/**
 * Bitcoin testnet (and mainnet-ready helpers) balance + P2PKH send.
 * Uses public explorers (Blockstream / Mempool) — no server key material.
 * Keys stay in the browser; only signed raw txs are broadcast.
 */

import { Wallet, hexlify, getBytes } from 'ethers'
import { sha256 } from '@noble/hashes/sha2.js'
import { btcP2pkhFromCompressedPub } from '@/lib/create-btc-wallet'

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export type BtcNetwork = 'testnet' | 'mainnet'

export interface BtcUtxo {
  txid: string
  vout: number
  value: number // satoshis
  status?: { confirmed?: boolean }
}

export interface BtcBalance {
  confirmedSats: number
  unconfirmedSats: number
  /** Confirmed + unconfirmed spendable estimate */
  totalSats: number
  btc: string
}

const EXPLORERS: Record<BtcNetwork, string[]> = {
  testnet: [
    'https://blockstream.info/testnet/api',
    'https://mempool.space/testnet/api',
  ],
  mainnet: [
    'https://blockstream.info/api',
    'https://mempool.space/api',
  ],
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/i, '')
  if (h.length % 2) throw new Error('odd hex length')
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

function u32LE(n: number): Uint8Array {
  const b = new Uint8Array(4)
  const v = n >>> 0
  b[0] = v & 0xff
  b[1] = (v >>> 8) & 0xff
  b[2] = (v >>> 16) & 0xff
  b[3] = (v >>> 24) & 0xff
  return b
}

function u64LE(n: number | bigint): Uint8Array {
  let v = typeof n === 'bigint' ? n : BigInt(n)
  const b = new Uint8Array(8)
  for (let i = 0; i < 8; i++) {
    b[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return b
}

/** Bitcoin compact size (varint). */
function compactSize(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n])
  if (n <= 0xffff) {
    const b = new Uint8Array(3)
    b[0] = 0xfd
    b[1] = n & 0xff
    b[2] = (n >>> 8) & 0xff
    return b
  }
  if (n <= 0xffffffff) {
    return concatBytes(new Uint8Array([0xfe]), u32LE(n))
  }
  throw new Error('compact size too large')
}

function base58Decode(str: string): Uint8Array {
  const bytes = [0]
  for (const ch of str) {
    const val = B58.indexOf(ch)
    if (val < 0) throw new Error('Invalid base58 character')
    let carry = val
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  let zeros = 0
  for (const ch of str) {
    if (ch === '1') zeros++
    else break
  }
  const out = new Uint8Array(zeros + bytes.length)
  for (let i = 0; i < bytes.length; i++) {
    out[out.length - 1 - i] = bytes[i]
  }
  return out
}

/** Decode P2PKH address → 20-byte hash160. Throws if invalid. */
export function decodeP2pkhAddress(
  address: string,
  network: BtcNetwork,
): Uint8Array {
  const raw = base58Decode(address.trim())
  if (raw.length !== 25) throw new Error('Invalid Bitcoin address length')
  const payload = raw.slice(0, 21)
  const checksum = raw.slice(21)
  const expect = sha256(sha256(payload)).slice(0, 4)
  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expect[i]) throw new Error('Invalid Bitcoin address checksum')
  }
  const ver = payload[0]
  const want = network === 'testnet' ? 0x6f : 0x00
  if (ver !== want) {
    throw new Error(
      network === 'testnet'
        ? 'Expected a Bitcoin testnet address (starts with m or n)'
        : 'Expected a Bitcoin mainnet address (starts with 1)',
    )
  }
  return payload.slice(1)
}

export function isValidBtcP2pkh(address: string, network: BtcNetwork): boolean {
  try {
    decodeP2pkhAddress(address, network)
    return true
  } catch {
    return false
  }
}

function p2pkhScript(hash160: Uint8Array): Uint8Array {
  // OP_DUP OP_HASH160 <20> <h160> OP_EQUALVERIFY OP_CHECKSIG
  return concatBytes(
    new Uint8Array([0x76, 0xa9, 0x14]),
    hash160,
    new Uint8Array([0x88, 0xac]),
  )
}

async function explorerGet(path: string, network: BtcNetwork): Promise<Response> {
  let lastErr: unknown
  for (const base of EXPLORERS[network]) {
    try {
      const r = await fetch(`${base}${path}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      if (r.ok || r.status === 404) return r
      lastErr = new Error(`${base}: HTTP ${r.status}`)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Bitcoin explorer unavailable')
}

async function explorerPostText(path: string, body: string, network: BtcNetwork): Promise<string> {
  let lastErr: unknown
  for (const base of EXPLORERS[network]) {
    try {
      const r = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body,
      })
      const text = await r.text()
      if (!r.ok) {
        lastErr = new Error(text || `HTTP ${r.status}`)
        continue
      }
      return text.trim()
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Broadcast failed')
}

export async function fetchBtcBalance(
  address: string,
  network: BtcNetwork = 'testnet',
): Promise<BtcBalance | null> {
  try {
    decodeP2pkhAddress(address, network)
  } catch {
    return null
  }

  // Prefer same-origin API proxy (avoids CSP / flaky browser CORS).
  try {
    const q = new URLSearchParams({ address, network })
    const r = await fetch(`/api/wallet/btc-balance?${q}`, { cache: 'no-store' })
    if (r.ok) {
      const j = (await r.json()) as BtcBalance & { error?: string }
      if (typeof j.totalSats === 'number' && j.btc) {
        return {
          confirmedSats: j.confirmedSats,
          unconfirmedSats: j.unconfirmedSats,
          totalSats: j.totalSats,
          btc: j.btc,
        }
      }
    }
  } catch {
    /* fall through to direct explorers */
  }

  try {
    const r = await explorerGet(`/address/${encodeURIComponent(address)}`, network)
    if (!r.ok) return null
    const j = (await r.json()) as {
      chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number }
      mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number }
    }
    const chainFunded = j.chain_stats?.funded_txo_sum ?? 0
    const chainSpent = j.chain_stats?.spent_txo_sum ?? 0
    const memFunded = j.mempool_stats?.funded_txo_sum ?? 0
    const memSpent = j.mempool_stats?.spent_txo_sum ?? 0
    const confirmedSats = chainFunded - chainSpent
    const unconfirmedSats = memFunded - memSpent
    const totalSats = confirmedSats + unconfirmedSats
    return {
      confirmedSats,
      unconfirmedSats,
      totalSats,
      btc: (totalSats / 1e8).toFixed(8),
    }
  } catch {
    return null
  }
}

export async function fetchBtcUtxos(
  address: string,
  network: BtcNetwork = 'testnet',
): Promise<BtcUtxo[]> {
  const r = await explorerGet(`/address/${encodeURIComponent(address)}/utxo`, network)
  if (!r.ok) throw new Error('Could not fetch UTXOs')
  const list = (await r.json()) as BtcUtxo[]
  return (list || []).filter((u) => u.value > 0)
}

/** Default fee rate (sat/vB) — testnet can be low. */
const DEFAULT_FEE_RATE = 2
/** Dust threshold for P2PKH change. */
const DUST_SATS = 546
/** Rough P2PKH input/output sizes (vbytes). */
const IN_VBYTES = 148
const OUT_VBYTES = 34
const OVERHEAD_VBYTES = 10

function estimateFeeSats(nIn: number, nOut: number, feeRate: number): number {
  const vbytes = OVERHEAD_VBYTES + nIn * IN_VBYTES + nOut * OUT_VBYTES
  return Math.ceil(vbytes * feeRate)
}

function derEncodeSig(r: Uint8Array, s: Uint8Array): Uint8Array {
  // Strip leading zeros but keep one if high bit set
  const trim = (x: Uint8Array) => {
    let i = 0
    while (i < x.length - 1 && x[i] === 0) i++
    if (x[i] & 0x80) {
      const out = new Uint8Array(x.length - i + 1)
      out[0] = 0
      out.set(x.slice(i), 1)
      return out
    }
    return x.slice(i)
  }
  const R = trim(r)
  const S = trim(s)
  const len = 2 + R.length + 2 + S.length
  const out = new Uint8Array(2 + len)
  out[0] = 0x30
  out[1] = len
  out[2] = 0x02
  out[3] = R.length
  out.set(R, 4)
  out[4 + R.length] = 0x02
  out[5 + R.length] = S.length
  out.set(S, 6 + R.length)
  return out
}

function pushData(data: Uint8Array): Uint8Array {
  if (data.length < 0x4c) return concatBytes(new Uint8Array([data.length]), data)
  if (data.length <= 0xff) return concatBytes(new Uint8Array([0x4c, data.length]), data)
  throw new Error('push data too large')
}

function hash256(data: Uint8Array): Uint8Array {
  return sha256(sha256(data))
}

function reverseHex(txid: string): Uint8Array {
  const b = hexToBytes(txid)
  const out = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) out[i] = b[b.length - 1 - i]
  return out
}

interface BuiltInput {
  txid: string
  vout: number
  value: number
  scriptPubKey: Uint8Array
}

function serializeTx(
  version: number,
  inputs: Array<{ txid: string; vout: number; script: Uint8Array; sequence: number }>,
  outputs: Array<{ value: number; script: Uint8Array }>,
  locktime: number,
): Uint8Array {
  const parts: Uint8Array[] = [u32LE(version), compactSize(inputs.length)]
  for (const inp of inputs) {
    parts.push(reverseHex(inp.txid))
    parts.push(u32LE(inp.vout))
    parts.push(compactSize(inp.script.length), inp.script)
    parts.push(u32LE(inp.sequence))
  }
  parts.push(compactSize(outputs.length))
  for (const out of outputs) {
    parts.push(u64LE(out.value))
    parts.push(compactSize(out.script.length), out.script)
  }
  parts.push(u32LE(locktime))
  return concatBytes(...parts)
}

/**
 * Build + sign a legacy P2PKH tx. Returns raw hex.
 * amountSats is the amount sent to `toAddress` (not including fee).
 */
export async function buildSignedP2pkhTx(opts: {
  privateKeyHex: string
  utxos: BtcUtxo[]
  toAddress: string
  amountSats: number
  network?: BtcNetwork
  feeRateSatPerVb?: number
  /** If true, send (total - fee) to destination (no change output). */
  sendMax?: boolean
}): Promise<{ rawHex: string; feeSats: number; changeSats: number; txid: string }> {
  const network = opts.network ?? 'testnet'
  const feeRate = opts.feeRateSatPerVb ?? DEFAULT_FEE_RATE
  const pk = opts.privateKeyHex.replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(pk)) throw new Error('Invalid Bitcoin private key')

  const wallet = new Wallet(`0x${pk}`)
  const pubHex = wallet.signingKey.compressedPublicKey
  const fromAddr = btcP2pkhFromCompressedPub(pubHex, network)
  const fromHash = decodeP2pkhAddress(fromAddr, network)
  const toHash = decodeP2pkhAddress(opts.toAddress, network)
  const scriptFrom = p2pkhScript(fromHash)
  const scriptTo = p2pkhScript(toHash)

  // Select UTXOs (largest first)
  const sorted = [...opts.utxos].sort((a, b) => b.value - a.value)
  if (sorted.length === 0) throw new Error('No UTXOs to spend')

  const selected: BuiltInput[] = []
  let totalIn = 0

  for (const u of sorted) {
    selected.push({
      txid: u.txid,
      vout: u.vout,
      value: u.value,
      scriptPubKey: scriptFrom,
    })
    totalIn += u.value
    const fee1 = estimateFeeSats(selected.length, 1, feeRate)
    const fee2 = estimateFeeSats(selected.length, 2, feeRate)
    if (opts.sendMax) {
      if (totalIn > fee1 + DUST_SATS) break
    } else if (totalIn >= opts.amountSats + fee2) {
      break
    } else if (totalIn >= opts.amountSats + fee1) {
      // might work with no change
      break
    }
  }

  if (selected.length === 0) throw new Error('Insufficient funds')

  let amountSats = opts.amountSats
  let feeSats = estimateFeeSats(selected.length, 2, feeRate)
  let changeSats = totalIn - amountSats - feeSats

  if (opts.sendMax) {
    feeSats = estimateFeeSats(selected.length, 1, feeRate)
    amountSats = totalIn - feeSats
    changeSats = 0
    if (amountSats < DUST_SATS) throw new Error('Balance too low after fee')
  } else if (changeSats < 0) {
    // try without change
    feeSats = estimateFeeSats(selected.length, 1, feeRate)
    changeSats = totalIn - amountSats - feeSats
    if (changeSats < 0) {
      throw new Error(
        `Insufficient BTC (need ~${((amountSats + feeSats) / 1e8).toFixed(8)}, have ${(totalIn / 1e8).toFixed(8)})`,
      )
    }
    // leftover becomes fee bump if below dust
    if (changeSats > 0 && changeSats < DUST_SATS) {
      feeSats += changeSats
      changeSats = 0
    }
  } else if (changeSats > 0 && changeSats < DUST_SATS) {
    feeSats += changeSats
    changeSats = 0
  }

  // If change still positive, recompute fee with 2 outputs
  if (changeSats >= DUST_SATS) {
    feeSats = estimateFeeSats(selected.length, 2, feeRate)
    changeSats = totalIn - amountSats - feeSats
    if (changeSats < DUST_SATS) {
      feeSats = totalIn - amountSats
      changeSats = 0
    }
  }

  if (amountSats < DUST_SATS) throw new Error('Amount below dust threshold')
  if (totalIn < amountSats + feeSats) throw new Error('Insufficient funds for amount + fee')

  const outputs: Array<{ value: number; script: Uint8Array }> = [
    { value: amountSats, script: scriptTo },
  ]
  if (changeSats >= DUST_SATS) {
    outputs.push({ value: changeSats, script: scriptFrom })
  }

  const version = 2
  const locktime = 0
  const sequence = 0xfffffffe

  // Sign each input (legacy SIGHASH_ALL)
  const signedInputs: Array<{ txid: string; vout: number; script: Uint8Array; sequence: number }> = []

  for (let i = 0; i < selected.length; i++) {
    const scriptsForSighash = selected.map((inp, j) =>
      j === i ? inp.scriptPubKey : new Uint8Array(0),
    )
    const preimage = concatBytes(
      serializeTx(
        version,
        selected.map((inp, j) => ({
          txid: inp.txid,
          vout: inp.vout,
          script: scriptsForSighash[j],
          sequence,
        })),
        outputs,
        locktime,
      ),
      u32LE(1), // SIGHASH_ALL
    )
    const digest = hash256(preimage)
    const sig = wallet.signingKey.sign(hexlify(digest))
    // low-S is default in ethers; pack r,s as 32-byte big-endian
    const r = getBytes('0x' + sig.r.slice(2).padStart(64, '0'))
    const s = getBytes('0x' + sig.s.slice(2).padStart(64, '0'))
    const der = derEncodeSig(r, s)
    const sigWithType = concatBytes(der, new Uint8Array([0x01])) // SIGHASH_ALL
    const pub = hexToBytes(pubHex)
    const scriptSig = concatBytes(pushData(sigWithType), pushData(pub))
    signedInputs.push({
      txid: selected[i].txid,
      vout: selected[i].vout,
      script: scriptSig,
      sequence,
    })
  }

  const raw = serializeTx(version, signedInputs, outputs, locktime)
  const rawHex = bytesToHex(raw)
  const dig = hash256(raw)
  const txidBytes = new Uint8Array(dig.length)
  for (let i = 0; i < dig.length; i++) txidBytes[i] = dig[dig.length - 1 - i]
  const txid = bytesToHex(txidBytes)

  return { rawHex, feeSats, changeSats: changeSats >= DUST_SATS ? changeSats : 0, txid }
}

export async function broadcastBtcTx(
  rawHex: string,
  network: BtcNetwork = 'testnet',
): Promise<string> {
  return explorerPostText('/tx', rawHex, network)
}

export async function sendBtcP2pkh(opts: {
  privateKeyHex: string
  toAddress: string
  amountBtc: string
  network?: BtcNetwork
  feeRateSatPerVb?: number
  sendMax?: boolean
}): Promise<{ txid: string; feeSats: number; explorerUrl: string }> {
  const network = opts.network ?? 'testnet'
  const pk = opts.privateKeyHex.replace(/^0x/i, '')
  const wallet = new Wallet(`0x${pk}`)
  const fromAddr = btcP2pkhFromCompressedPub(wallet.signingKey.compressedPublicKey, network)

  const utxos = await fetchBtcUtxos(fromAddr, network)
  if (utxos.length === 0) {
    throw new Error(
      network === 'testnet'
        ? 'No testnet BTC UTXOs. Fund this address from a faucet first.'
        : 'No BTC UTXOs on this address.',
    )
  }

  const amountSats = opts.sendMax
    ? 0
    : Math.round(parseFloat(opts.amountBtc) * 1e8)
  if (!opts.sendMax && (!Number.isFinite(amountSats) || amountSats <= 0)) {
    throw new Error('Invalid amount')
  }

  const built = await buildSignedP2pkhTx({
    privateKeyHex: pk,
    utxos,
    toAddress: opts.toAddress.trim(),
    amountSats,
    network,
    feeRateSatPerVb: opts.feeRateSatPerVb,
    sendMax: opts.sendMax,
  })

  const txid = await broadcastBtcTx(built.rawHex, network)
  const explorerUrl =
    network === 'testnet'
      ? `https://mempool.space/testnet/tx/${txid}`
      : `https://mempool.space/tx/${txid}`
  return { txid: txid || built.txid, feeSats: built.feeSats, explorerUrl }
}

/** Format sats as BTC string without scientific notation. */
export function satsToBtcString(sats: number): string {
  return (sats / 1e8).toFixed(8).replace(/\.?0+$/, (m) => (m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m)) || '0'
}
