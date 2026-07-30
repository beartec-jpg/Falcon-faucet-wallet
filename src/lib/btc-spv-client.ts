/**
 * Bitcoin SPV light-client bridge (Falcon BitcoinSPVBridge).
 *
 * Peg-in: send BTC testnet → watch script + OP_RETURN `FALC‖AccountID20`,
 * wait confirmations, submit BTCDepositClaim with Merkle proof.
 *
 * No custody keys. Headers must already be on Falcon (ops header submitter).
 */

import { Wallet, hexlify, getBytes } from 'ethers'
import { sha256 } from '@noble/hashes/sha2.js'
import { decodeAccountID } from 'ripple-address-codec'
import {
  broadcastBtcTx,
  decodeP2pkhAddress,
  fetchBtcUtxos,
  type BtcNetwork,
} from '@/lib/btc-client'
import { btcP2pkhFromCompressedPub } from '@/lib/create-btc-wallet'
import { signTxJson } from '@/lib/falcon-tx-sign'
import { submitWithSequenceRetry, fetchSequenceInfo } from '@/lib/wallet-submit'
import type { NetworkKey } from '@/lib/networks'
import { networkIdForTx } from '@/lib/networks'

const EXPLORERS: Record<BtcNetwork, string[]> = {
  testnet: [
    'https://blockstream.info/testnet/api',
    'https://mempool.space/testnet/api',
  ],
  mainnet: ['https://blockstream.info/api', 'https://mempool.space/api'],
}

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

function compactSize(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n])
  if (n <= 0xffff) {
    const b = new Uint8Array(3)
    b[0] = 0xfd
    b[1] = n & 0xff
    b[2] = (n >>> 8) & 0xff
    return b
  }
  return concatBytes(new Uint8Array([0xfe]), u32LE(n))
}

function reverseHex(txid: string): Uint8Array {
  const b = hexToBytes(txid)
  const out = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) out[i] = b[b.length - 1 - i]
  return out
}

function hash256(data: Uint8Array): Uint8Array {
  return sha256(sha256(data))
}

function derEncodeSig(r: Uint8Array, s: Uint8Array): Uint8Array {
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

/** OP_RETURN payload: ASCII `FALC` + 20-byte Falcon AccountID. */
export function falcOpReturnPayload(falconAddress: string): Uint8Array {
  const id = decodeAccountID(falconAddress)
  if (id.length !== 20) throw new Error('Invalid Falcon account id length')
  return concatBytes(new TextEncoder().encode('FALC'), id)
}

/** OP_RETURN script: OP_RETURN <push payload>. */
export function opReturnScript(payload: Uint8Array): Uint8Array {
  if (payload.length > 80) throw new Error('OP_RETURN payload too long')
  return concatBytes(new Uint8Array([0x6a]), pushData(payload))
}

/**
 * SHA256(scriptPubKey) as 32-byte hex (Falcon BtcWatchScriptHash / script hash).
 * Matches e2e `falcon_script_hash_hex`.
 */
export function btcWatchScriptHashHex(scriptPubKeyHex: string): string {
  return bytesToHex(sha256(hexToBytes(scriptPubKeyHex))).toUpperCase()
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

export interface SpvStatus {
  amendment: {
    name: string
    hash?: string
    supported: boolean
    enabled: boolean
    vetoed?: boolean | null
  }
  activated: boolean
  bridge?: {
    tipHeight?: number
    tipHash?: string
    minConfirmations?: number
    watchScriptHash?: string
    mintCap?: string
    totalMinted?: string
    chainId?: number
  }
  /** Deposit destination for live test (P2PKH/P2WSH watch). From config until on-chain maps to address. */
  watchAddress?: string | null
  btcNetwork: BtcNetwork
  ready: boolean
  message: string
}

export async function fetchSpvStatus(): Promise<SpvStatus> {
  const r = await fetch('/api/bridge/btc-spv', { cache: 'no-store' })
  const j = (await r.json()) as SpvStatus & { error?: string }
  if (!r.ok) throw new Error(j.error || `SPV status ${r.status}`)
  return j
}

export interface SpvDepositResult {
  txid: string
  rawHex: string
  feeSats: number
  amountSats: number
  watchVout: number
  explorerUrl: string
}

/**
 * Build+broadcast a BTC deposit to the SPV watch address with OP_RETURN FALC‖AccountID.
 * Uses a simple two-payment path: amount → watch, OP_RETURN memo, change back.
 *
 * Note: for P2PKH watch only. P2WSH vault addresses need a separate builder (ops vault).
 */
export async function sendSpvDeposit(opts: {
  privateKeyHex: string
  watchAddress: string
  falconAccount: string
  amountBtc: string
  network?: BtcNetwork
  feeRateSatPerVb?: number
}): Promise<SpvDepositResult> {
  const network = opts.network ?? 'testnet'
  const pk = opts.privateKeyHex.replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(pk)) throw new Error('Invalid Bitcoin private key')

  // Prefer multi-output builder; fall back path uses payment then notes claim needs OP_RETURN.
  // Full path: custom sign with OP_RETURN.
  const wallet = new Wallet(`0x${pk}`)
  const pubHex = wallet.signingKey.compressedPublicKey
  const fromAddr = btcP2pkhFromCompressedPub(pubHex, network)
  const utxos = await fetchBtcUtxos(fromAddr, network)
  if (utxos.length === 0) {
    throw new Error(
      network === 'testnet'
        ? 'No testnet BTC UTXOs. Fund this multi-chain BTC address from a faucet first.'
        : 'No BTC UTXOs on this address.',
    )
  }

  const amountSats = Math.round(parseFloat(opts.amountBtc) * 1e8)
  if (!Number.isFinite(amountSats) || amountSats < 546) {
    throw new Error('Amount too small (dust)')
  }

  const opRet = falcOpReturnPayload(opts.falconAccount)
  const opScript = opReturnScript(opRet)

  // Build via extended raw sign (P2PKH in → watch P2PKH + OP_RETURN + change)
  const built = await buildSpvDepositTx({
    privateKeyHex: pk,
    utxos,
    watchAddress: opts.watchAddress.trim(),
    amountSats,
    opReturnScript: opScript,
    network,
    feeRateSatPerVb: opts.feeRateSatPerVb ?? 2,
  })

  const txid = await broadcastBtcTx(built.rawHex, network)
  const explorerUrl =
    network === 'testnet'
      ? `https://mempool.space/testnet/tx/${txid}`
      : `https://mempool.space/tx/${txid}`

  return {
    txid: txid || built.txid,
    rawHex: built.rawHex,
    feeSats: built.feeSats,
    amountSats,
    watchVout: built.watchVout,
    explorerUrl,
  }
}

// ─── Deposit tx builder (P2PKH + OP_RETURN) ─────────────────────────────────

function p2pkhScript(hash160: Uint8Array): Uint8Array {
  return concatBytes(new Uint8Array([0x76, 0xa9, 0x14]), hash160, new Uint8Array([0x88, 0xac]))
}

function serializeTx(
  version: number,
  inputs: Array<{ txid: string; vout: number; script: Uint8Array; sequence: number }>,
  outputs: Array<{ value: number; script: Uint8Array }>,
  locktime: number,
): Uint8Array {
  const parts: Uint8Array[] = [u32LE(version), compactSize(inputs.length)]
  for (const inp of inputs) {
    parts.push(reverseHex(inp.txid), u32LE(inp.vout), compactSize(inp.script.length), inp.script, u32LE(inp.sequence))
  }
  parts.push(compactSize(outputs.length))
  for (const out of outputs) {
    parts.push(u64LE(out.value), compactSize(out.script.length), out.script)
  }
  parts.push(u32LE(locktime))
  return concatBytes(...parts)
}

const IN_VBYTES = 148
const OUT_VBYTES = 34
const OP_RET_VBYTES = 20 // rough
const OVERHEAD = 10

async function buildSpvDepositTx(opts: {
  privateKeyHex: string
  utxos: Array<{ txid: string; vout: number; value: number }>
  watchAddress: string
  amountSats: number
  opReturnScript: Uint8Array
  network: BtcNetwork
  feeRateSatPerVb: number
}): Promise<{ rawHex: string; feeSats: number; txid: string; watchVout: number }> {
  const wallet = new Wallet(`0x${opts.privateKeyHex}`)
  const pubHex = wallet.signingKey.compressedPublicKey
  const fromAddr = btcP2pkhFromCompressedPub(pubHex, opts.network)
  const fromHash = decodeP2pkhAddress(fromAddr, opts.network)
  const toHash = decodeP2pkhAddress(opts.watchAddress, opts.network)
  const scriptFrom = p2pkhScript(fromHash)
  const scriptTo = p2pkhScript(toHash)

  const sorted = [...opts.utxos].sort((a, b) => b.value - a.value)
  const selected: typeof sorted = []
  let totalIn = 0
  const feeRate = opts.feeRateSatPerVb

  const estimate = (nIn: number, nOut: number) =>
    Math.ceil((OVERHEAD + nIn * IN_VBYTES + nOut * OUT_VBYTES + OP_RET_VBYTES) * feeRate)

  for (const u of sorted) {
    selected.push(u)
    totalIn += u.value
    // watch + opreturn + change = 3 outs
    if (totalIn >= opts.amountSats + estimate(selected.length, 3)) break
  }
  if (selected.length === 0) throw new Error('Insufficient funds')

  let feeSats = estimate(selected.length, 3)
  let changeSats = totalIn - opts.amountSats - feeSats
  if (changeSats < 0) {
    feeSats = estimate(selected.length, 2) // no change
    changeSats = totalIn - opts.amountSats - feeSats
    if (changeSats < 0) throw new Error('Insufficient BTC for amount + fee + OP_RETURN')
  }
  if (changeSats > 0 && changeSats < 546) {
    feeSats += changeSats
    changeSats = 0
  }

  const outputs: Array<{ value: number; script: Uint8Array }> = [
    { value: opts.amountSats, script: scriptTo },
    { value: 0, script: opts.opReturnScript },
  ]
  if (changeSats >= 546) outputs.push({ value: changeSats, script: scriptFrom })

  const version = 2
  const locktime = 0
  const sequence = 0xfffffffe
  const signedInputs: Array<{ txid: string; vout: number; script: Uint8Array; sequence: number }> = []

  for (let i = 0; i < selected.length; i++) {
    const scriptsForSighash = selected.map((_, j) => (j === i ? scriptFrom : new Uint8Array(0)))
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
      u32LE(1),
    )
    const digest = hash256(preimage)
    const sig = wallet.signingKey.sign(hexlify(digest))
    const r = getBytes('0x' + sig.r.slice(2).padStart(64, '0'))
    const s = getBytes('0x' + sig.s.slice(2).padStart(64, '0'))
    const der = derEncodeSig(r, s)
    const sigWithType = concatBytes(der, new Uint8Array([0x01]))
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

  return {
    rawHex,
    feeSats,
    txid: bytesToHex(txidBytes),
    watchVout: 0, // first output is always the watch payment
  }
}

// ─── Claim materials from explorer ──────────────────────────────────────────

export interface SpvClaimMaterials {
  rawTxHex: string
  merkleProofHex: string
  txIndex: number
  blockHash: string
  vout: number
  confirmations: number
  blockHeight: number
}

export async function fetchSpvClaimMaterials(
  txid: string,
  network: BtcNetwork = 'testnet',
  watchVout = 0,
): Promise<SpvClaimMaterials> {
  // Prefer same-origin API (CSP-safe)
  try {
    const r = await fetch('/api/bridge/btc-spv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'proof', btc_txid: txid, network, vout: watchVout }),
    })
    const j = (await r.json().catch(() => ({}))) as SpvClaimMaterials & {
      error?: string
      confirmed?: boolean
      confirmations?: number
    }
    if (r.ok && j.rawTxHex && j.merkleProofHex) return j
    // Waiting states — never surface as a hard "Failed to fetch" to the user
    if (r.status === 404 || r.status === 409) {
      throw new Error(j.error || 'BTC tx not confirmed yet — wait for a block')
    }
    if (!r.ok && j.error) throw new Error(j.error)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Re-throw wait/engine messages; only swallow pure transport for explorer fallback
    if (
      e instanceof Error &&
      !/^(TypeError|Failed to fetch|NetworkError|Load failed)/i.test(msg) &&
      !/failed to fetch/i.test(msg)
    ) {
      throw e
    }
  }

  const txidClean = txid.toLowerCase()
  const rawR = await explorerGet(`/tx/${txidClean}/hex`, network)
  if (!rawR.ok) throw new Error('Could not fetch raw BTC tx — wait for broadcast')
  const rawTxHex = (await rawR.text()).trim()

  const statusR = await explorerGet(`/tx/${txidClean}`, network)
  if (!statusR.ok) throw new Error('Could not fetch BTC tx status')
  const status = (await statusR.json()) as {
    status?: { confirmed?: boolean; block_height?: number; block_hash?: string }
  }
  if (!status.status?.confirmed || !status.status.block_hash) {
    throw new Error('BTC tx not confirmed yet — wait for a block')
  }
  const blockHash = status.status.block_hash
  const blockHeight = status.status.block_height ?? 0

  const proofR = await explorerGet(`/tx/${txidClean}/merkle-proof`, network)
  if (!proofR.ok) throw new Error('Could not fetch merkle proof')
  const proof = (await proofR.json()) as { merkle?: string[]; pos?: number }
  const siblings = proof.merkle ?? []
  // Esplora display-order siblings → Bitcoin internal (byte-reversed) for Falcon
  const merkleProofHex = siblings
    .map((h) => {
      const hex = h.toLowerCase().replace(/^0x/i, '')
      if (!/^[0-9a-f]{64}$/.test(hex)) return hex
      return hex.match(/.{2}/g)!.reverse().join('')
    })
    .join('')
  const txIndex = proof.pos ?? 0

  // tip height for confs
  let confirmations = 1
  try {
    const tipR = await explorerGet('/blocks/tip/height', network)
    if (tipR.ok) {
      const tip = parseInt(await tipR.text(), 10)
      if (Number.isFinite(tip) && blockHeight > 0) confirmations = Math.max(1, tip - blockHeight + 1)
    }
  } catch {
    /* ignore */
  }

  return {
    rawTxHex: rawTxHex.replace(/^0x/i, ''),
    merkleProofHex,
    txIndex,
    blockHash: blockHash.replace(/^0x/i, ''),
    vout: watchVout,
    confirmations,
    blockHeight,
  }
}

/** P2PKH scriptPubKey hex for BtcPayoutScript (SPV burn). */
export function btcP2pkhScriptHex(address: string, network: BtcNetwork = 'testnet'): string {
  const h160 = decodeP2pkhAddress(address, network)
  const script = concatBytes(new Uint8Array([0x76, 0xa9, 0x14]), h160, new Uint8Array([0x88, 0xac]))
  return bytesToHex(script)
}

export function randomBurnPreimageHex(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes))
  return bytesToHex(b)
}

/** Sign + submit BTCBridgeBurn (any sats ≤ MPT balance). */
export async function submitSpvBridgeBurn(opts: {
  falconSecret: string
  account: string
  networkKey: NetworkKey
  networkId: number
  /** Satoshis to burn / withdraw */
  amountSats: number
  /** Destination BTC P2PKH address (testnet m/n…) */
  btcPayoutAddress: string
  btcNetwork?: BtcNetwork
  burnPreimageHex?: string
  feeDrops?: string
}): Promise<{ hash?: string; result?: string; burnSeq: number; preimageHex: string }> {
  const fee = opts.feeDrops ?? '1000000'
  const netId = networkIdForTx(opts.networkId)
  const btcNet = opts.btcNetwork ?? 'testnet'
  const preimageHex = (opts.burnPreimageHex || randomBurnPreimageHex(32)).replace(/^0x/i, '')
  const payoutScript = btcP2pkhScriptHex(opts.btcPayoutAddress, btcNet)
  const amountSats = Math.floor(opts.amountSats)
  if (!Number.isFinite(amountSats) || amountSats < 546) {
    throw new Error('Withdraw amount too small (dust)')
  }

  let burnSeq = 0
  const res = await submitWithSequenceRetry({
    networkKey: opts.networkKey,
    fetchSequence: async () => {
      const s = await fetchSequenceInfo(opts.account, opts.networkKey)
      if (!s.exists) throw new Error('Falcon account not funded on ledger')
      return { sequence: s.sequence, currentLedger: s.currentLedger }
    },
    sign: async ({ sequence, lastLedgerSequence }) => {
      burnSeq = sequence
      const tx: Record<string, unknown> = {
        TransactionType: 'BTCBridgeBurn',
        Account: opts.account,
        Fee: fee,
        Sequence: sequence,
        LastLedgerSequence: lastLedgerSequence,
        Flags: 0,
        BtcWithdrawAmount: amountSats,
        BtcPayoutScript: payoutScript.toUpperCase(),
        BtcBurnPreimage: preimageHex.toUpperCase(),
      }
      if (netId !== undefined) tx.NetworkID = netId
      const tx_blob = await signTxJson(tx, opts.falconSecret)
      return { tx_blob }
    },
  })
  return { ...res, burnSeq, preimageHex }
}

/** After challenge window: mark withdraw FINAL (user-signed). */
export async function submitSpvWithdrawFinalize(opts: {
  falconSecret: string
  account: string
  networkKey: NetworkKey
  networkId: number
  /** Sequence of the BTCBridgeBurn tx */
  burnSeq: number
  feeDrops?: string
}): Promise<{ hash?: string; result?: string }> {
  const fee = opts.feeDrops ?? '1000000'
  const netId = networkIdForTx(opts.networkId)
  try {
    return await submitWithSequenceRetry({
      networkKey: opts.networkKey,
      fetchSequence: async () => {
        const s = await fetchSequenceInfo(opts.account, opts.networkKey)
        if (!s.exists) throw new Error('Falcon account not funded on ledger')
        return { sequence: s.sequence, currentLedger: s.currentLedger }
      },
      sign: async ({ sequence, lastLedgerSequence }) => {
        const tx: Record<string, unknown> = {
          TransactionType: 'BTCWithdrawFinalize',
          Account: opts.account,
          Fee: fee,
          Sequence: sequence,
          LastLedgerSequence: lastLedgerSequence,
          Flags: 0,
          BtcWithdrawSeq: opts.burnSeq,
        }
        if (netId !== undefined) tx.NetworkID = netId
        const tx_blob = await signTxJson(tx, opts.falconSecret)
        return { tx_blob }
      },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/tecTOO_SOON/i.test(msg)) {
      throw new Error('Challenge window still open — wait a bit longer then finalize')
    }
    if (/tecDUPLICATE/i.test(msg)) {
      return { result: 'tecDUPLICATE' }
    }
    throw e instanceof Error ? e : new Error(msg)
  }
}

/** Poll withdraw object + ledger until challenge end (default 32 ledgers). */
export async function waitSpvChallengeWindow(opts: {
  account: string
  burnSeq: number
  onStep?: (msg: string) => void
  /** Max wait ~3 min */
  maxPolls?: number
  intervalMs?: number
}): Promise<{ challengeEnd: number; currentLedger: number; amountSats?: number }> {
  const maxPolls = opts.maxPolls ?? 90
  const intervalMs = opts.intervalMs ?? 2000
  for (let i = 0; i < maxPolls; i++) {
    const r = await fetch('/api/bridge/btc-spv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'withdraw_status',
        account: opts.account,
        seq: opts.burnSeq,
      }),
      cache: 'no-store',
    })
    const j = (await r.json().catch(() => ({}))) as {
      error?: string
      status?: number
      challengeEndLedger?: number
      currentLedger?: number
      amountSats?: number
      ready?: boolean
    }
    if (r.ok && j.ready) {
      return {
        challengeEnd: j.challengeEndLedger ?? 0,
        currentLedger: j.currentLedger ?? 0,
        amountSats: j.amountSats,
      }
    }
    if (r.ok && j.challengeEndLedger != null && j.currentLedger != null) {
      const left = Math.max(0, j.challengeEndLedger - j.currentLedger + 1)
      opts.onStep?.(
        `Challenge window: ~${left} Falcon ledger(s) left (${j.currentLedger}/${j.challengeEndLedger})…`,
      )
    } else {
      opts.onStep?.(j.error || 'Waiting for withdraw object…')
    }
    await new Promise((res) => setTimeout(res, intervalMs))
  }
  throw new Error('Timed out waiting for SPV challenge window — try Finalize again shortly')
}

/**
 * Full peg-out: burn MPT FBTC → wait challenge → finalize.
 * BTC payout is completed by ops relay once status is FINAL.
 */
export async function spvPegOut(opts: {
  falconSecret: string
  account: string
  networkKey: NetworkKey
  networkId: number
  amountSats: number
  btcPayoutAddress: string
  btcNetwork?: BtcNetwork
  onStep?: (msg: string) => void
}): Promise<{
  burnHash?: string
  burnSeq: number
  finalizeHash?: string
  preimageHex: string
  amountSats: number
}> {
  opts.onStep?.('Burning FBTC (SPV peg-out)…')
  const burn = await submitSpvBridgeBurn({
    falconSecret: opts.falconSecret,
    account: opts.account,
    networkKey: opts.networkKey,
    networkId: opts.networkId,
    amountSats: opts.amountSats,
    btcPayoutAddress: opts.btcPayoutAddress,
    btcNetwork: opts.btcNetwork,
  })
  opts.onStep?.(`Burn submitted (seq ${burn.burnSeq}) — waiting challenge window…`)
  await waitSpvChallengeWindow({
    account: opts.account,
    burnSeq: burn.burnSeq,
    onStep: opts.onStep,
  })
  opts.onStep?.('Finalizing withdraw on Falcon…')
  const fin = await submitSpvWithdrawFinalize({
    falconSecret: opts.falconSecret,
    account: opts.account,
    networkKey: opts.networkKey,
    networkId: opts.networkId,
    burnSeq: burn.burnSeq,
  })
  opts.onStep?.('Finalize OK — BTC payout relay will send testnet BTC shortly…')
  return {
    burnHash: burn.hash,
    burnSeq: burn.burnSeq,
    finalizeHash: fin.hash,
    preimageHex: burn.preimageHex,
    amountSats: opts.amountSats,
  }
}

/** Sign + submit BTCDepositClaim on Falcon. */
export async function submitSpvDepositClaim(opts: {
  falconSecret: string
  account: string
  networkKey: NetworkKey
  networkId: number
  materials: SpvClaimMaterials
  feeDrops?: string
}): Promise<{ hash?: string; result?: string }> {
  const fee = opts.feeDrops ?? '1000000'
  const netId = networkIdForTx(opts.networkId)

  try {
    return await submitWithSequenceRetry({
      networkKey: opts.networkKey,
      fetchSequence: async () => {
        const s = await fetchSequenceInfo(opts.account, opts.networkKey)
        if (!s.exists) throw new Error('Falcon account not funded on ledger')
        return { sequence: s.sequence, currentLedger: s.currentLedger }
      },
      sign: async ({ sequence, lastLedgerSequence }) => {
        const tx: Record<string, unknown> = {
          TransactionType: 'BTCDepositClaim',
          Account: opts.account,
          Destination: opts.account,
          Fee: fee,
          Sequence: sequence,
          LastLedgerSequence: lastLedgerSequence,
          Flags: 0,
          BtcRawTx: opts.materials.rawTxHex.toUpperCase(),
          BtcMerkleProof: opts.materials.merkleProofHex.toUpperCase(),
          BtcTxIndex: opts.materials.txIndex,
          BtcBlockHash: opts.materials.blockHash.toUpperCase(),
          BtcVout: opts.materials.vout,
        }
        if (netId !== undefined) tx.NetworkID = netId
        const tx_blob = await signTxJson(tx, opts.falconSecret)
        return { tx_blob }
      },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    // Engine often returns bare codes with no human text
    if (/tecDUPLICATE/i.test(msg)) {
      // Deposit already claimed / tombstone exists — treat as success upstream
      throw new Error('tecDUPLICATE — Ledger object already exists.')
    }
    if (/^temMALFORMED/i.test(msg) || msg === 'temMALFORMED') {
      throw new Error(
        'temMALFORMED — SPV proof rejected (merkle/raw tx/OP_RETURN). Hard-refresh and retry claim.',
      )
    }
    if (/^tecTOO_SOON/i.test(msg)) {
      throw new Error('tecTOO_SOON — need more Falcon-side confirmations (headers still catching up)')
    }
    throw e instanceof Error ? e : new Error(msg)
  }
}

/** Full live peg-in: deposit BTC then (after confs) claim. Claim may need retry. */
export async function spvPegIn(opts: {
  btcPrivateKeyHex: string
  falconSecret: string
  falconAccount: string
  watchAddress: string
  amountBtc: string
  networkKey: NetworkKey
  networkId: number
  btcNetwork?: BtcNetwork
  minConfirmations?: number
  onStep?: (msg: string) => void
  /** Fired as soon as BTC is broadcast — UI can show success before claim. */
  onDepositBroadcast?: (dep: {
    txid: string
    explorerUrl: string
    amountSats: number
  }) => void
}): Promise<{ depositTxid: string; claimHash?: string; explorerUrl: string }> {
  const btcNet = opts.btcNetwork ?? 'testnet'
  const minConf = opts.minConfirmations ?? 1
  opts.onStep?.('Broadcasting BTC deposit (watch + OP_RETURN)…')
  const dep = await sendSpvDeposit({
    privateKeyHex: opts.btcPrivateKeyHex,
    watchAddress: opts.watchAddress,
    falconAccount: opts.falconAccount,
    amountBtc: opts.amountBtc,
    network: btcNet,
  })

  // Persist txid immediately (localStorage + session) so claim UI survives refresh
  try {
    const { createSpvPending } = await import('@/lib/btc-spv-pending')
    createSpvPending({
      falconAccount: opts.falconAccount,
      txid: dep.txid,
      watchVout: dep.watchVout,
      watchAddress: opts.watchAddress,
      amountSats: dep.amountSats,
      minConfirmations: minConf,
      btcNetwork: btcNet,
      status: 'waiting_confs',
    })
  } catch {
    /* non-browser / storage blocked */
  }

  opts.onDepositBroadcast?.({
    txid: dep.txid,
    explorerUrl: dep.explorerUrl,
    amountSats: dep.amountSats,
  })
  opts.onStep?.(
    `BTC sent ${dep.txid.slice(0, 12)}… waiting for ${minConf} confirmations (auto-saved on this device)…`,
  )

  let materials: SpvClaimMaterials | null = null
  let lastWaitErr = ''
  // ~30 min max (120 × 15s) for slow testnet
  for (let i = 0; i < 120; i++) {
    try {
      materials = await fetchSpvClaimMaterials(dep.txid, btcNet, dep.watchVout)
      if (materials.confirmations >= minConf) break
      opts.onStep?.(
        `BTC ${dep.txid.slice(0, 10)}… confs ${materials.confirmations}/${minConf}`,
      )
      lastWaitErr = ''
    } catch (e) {
      lastWaitErr = e instanceof Error ? e.message : String(e)
      opts.onStep?.(
        `BTC ${dep.txid.slice(0, 10)}… waiting for confirmation (${lastWaitErr.slice(0, 80)})`,
      )
    }
    await new Promise((r) => setTimeout(r, 15_000))
  }
  if (!materials || materials.confirmations < minConf) {
    throw new Error(
      `BTC deposit is on-chain (or in mempool): ${dep.txid} — ${dep.explorerUrl}. ` +
        `Not claimed yet (need ${minConf} confs). Keep the txid; claim can be retried after confirmations. ` +
        (lastWaitErr ? `Last poll: ${lastWaitErr}` : ''),
    )
  }

  opts.onStep?.('Submitting BTCDepositClaim on Falcon…')
  try {
    const claim = await submitSpvDepositClaim({
      falconSecret: opts.falconSecret,
      account: opts.falconAccount,
      networkKey: opts.networkKey,
      networkId: opts.networkId,
      materials,
    })
    return {
      depositTxid: dep.txid,
      claimHash: claim.hash,
      explorerUrl: dep.explorerUrl,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      `BTC deposit OK: ${dep.txid} (${dep.explorerUrl}) but Falcon claim failed: ${msg}. ` +
        `Your BTC is at the bridge watch address — do not re-send. Retry claim with this txid.`,
    )
  }
}
