/**
 * BitVM-class vault helpers (CSV + hashlock + user CHECKSIG).
 * Matches scripts/btc-spv/bitvm/vault.py and Falcon btcParseBitvmVaultScript.
 *
 * Peg-in: fund P2WSH(vault) + OP_RETURN FALC‖AccountID
 * Peg-out: after Falcon finalize + CSV blocks, user spends vault with preimage + sig
 */

import { Wallet, hexlify, getBytes } from 'ethers'
import { sha256 } from '@noble/hashes/sha2.js'
import {
  broadcastBtcTx,
  decodeP2pkhAddress,
  type BtcNetwork,
} from '@/lib/btc-client'

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

function p2pkhScript(hash160: Uint8Array): Uint8Array {
  return concatBytes(new Uint8Array([0x76, 0xa9, 0x14]), hash160, new Uint8Array([0x88, 0xac]))
}

const EXPLORERS: Record<BtcNetwork, string[]> = {
  testnet: [
    'https://blockstream.info/testnet/api',
    'https://mempool.space/testnet/api',
  ],
  mainnet: ['https://blockstream.info/api', 'https://mempool.space/api'],
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
  /** Set after successful vault claim spend */
  claimedTxid?: string
  claimedAt?: number
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

export function markVaultDepositClaimed(
  fundingTxid: string,
  fundingVout: number,
  claimTxid: string,
): void {
  const all = listVaultDeposits()
  const key = `${fundingTxid}:${fundingVout}`
  const rec = all[key]
  if (!rec) return
  rec.claimedTxid = claimTxid
  rec.claimedAt = Date.now()
  saveVaultDeposit(rec)
}

/** Unclaimed vaults for an account, newest first. */
export function listUnclaimedVaults(falconAccount: string): VaultDepositRecord[] {
  const mine = Object.values(listVaultDeposits()).filter(
    (r) => r.falconAccount === falconAccount && !r.claimedTxid,
  )
  mine.sort((a, b) => b.createdAt - a.createdAt)
  return mine
}

/**
 * Pick vault(s) to cover a withdraw of any amount ≤ total vault liquidity.
 * - Prefer single vault (exact, then smallest that covers)
 * - Else greedily take largest vaults until amount filled (multi-leg out)
 */
export function planVaultWithdraw(
  falconAccount: string,
  amountSats: number,
): Array<{ vault: VaultDepositRecord; takeSats: number }> {
  const want = Math.floor(amountSats)
  if (!Number.isFinite(want) || want < 546) {
    throw new Error('Withdraw amount too small (dust)')
  }
  const mine = listUnclaimedVaults(falconAccount)
  if (mine.length === 0) {
    throw new Error(
      'No vault peg-ins on this device. Bridge In first (same browser) so BTC is in your vault.',
    )
  }
  const total = mine.reduce((s, v) => s + v.amountSats, 0)
  if (want > total) {
    throw new Error(
      `Not enough vault BTC on this device (${total} sats available, need ${want}). ` +
        'Only vault-backed FBTC can exit non-custodially.',
    )
  }

  // Exact / near single vault
  const exact = mine.find((v) => Math.abs(v.amountSats - want) <= 1)
  if (exact) return [{ vault: exact, takeSats: Math.min(want, exact.amountSats) }]

  // Smallest single vault that fully covers (partial claim + change vault)
  const covering = mine
    .filter((v) => v.amountSats >= want)
    .sort((a, b) => a.amountSats - b.amountSats)
  if (covering[0]) return [{ vault: covering[0], takeSats: want }]

  // Multi-vault: largest first
  const sorted = [...mine].sort((a, b) => b.amountSats - a.amountSats)
  let left = want
  const plan: Array<{ vault: VaultDepositRecord; takeSats: number }> = []
  for (const v of sorted) {
    if (left <= 0) break
    const take = Math.min(left, v.amountSats)
    if (take < 546 && left > take) continue // skip dust legs if possible
    if (take >= 546) {
      plan.push({ vault: v, takeSats: take })
      left -= take
    }
  }
  if (left > 0) {
    throw new Error(
      `Could not cover ${want} sats from vaults (short ${left}). Try a slightly different amount.`,
    )
  }
  return plan
}

/** @deprecated use planVaultWithdraw — kept for callers expecting one vault */
export function findVaultDepositForBurn(
  falconAccount: string,
  amountSats: number,
): VaultDepositRecord | null {
  try {
    const plan = planVaultWithdraw(falconAccount, amountSats)
    return plan[0]?.vault ?? null
  } catch {
    return null
  }
}

/** Newest unclaimed vault for account (any amount) — for claim retry / hints. */
export function findAnyUnclaimedVault(falconAccount: string): VaultDepositRecord | null {
  return listUnclaimedVaults(falconAccount)[0] ?? null
}

/** Total unclaimed vault sats on this device for account. */
export function totalUnclaimedVaultSats(falconAccount: string): number {
  return listUnclaimedVaults(falconAccount).reduce((s, v) => s + v.amountSats, 0)
}

export function compressedPubFromBtcPriv(privateKeyHex: string): string {
  const w = new Wallet(`0x${privateKeyHex.replace(/^0x/i, '')}`)
  return w.signingKey.compressedPublicKey.replace(/^0x/i, '')
}

export interface VaultUtxoStatus {
  valueSats: number
  confirmations: number
  spent: boolean
  blockHeight?: number
}

/** Fetch vault funding outpoint status from explorer. */
export async function fetchVaultUtxoStatus(
  fundingTxid: string,
  fundingVout: number,
  network: BtcNetwork = 'testnet',
): Promise<VaultUtxoStatus> {
  const txid = fundingTxid.toLowerCase().replace(/^0x/i, '')
  const r = await explorerGet(`/tx/${txid}`, network)
  if (!r.ok) throw new Error('Could not fetch vault funding tx — wait for broadcast')
  const j = (await r.json()) as {
    vout?: Array<{ value?: number; scriptpubkey?: string }>
    status?: { confirmed?: boolean; block_height?: number }
  }
  const out = j.vout?.[fundingVout]
  if (!out || out.value == null) throw new Error(`Vault vout ${fundingVout} missing on funding tx`)

  // value may be BTC float (blockstream) or already sats on some APIs — Esplora uses sats as number of BTC*1e8? 
  // Esplora: "value": number of satoshis
  const valueSats = Math.round(Number(out.value))

  let confirmations = 0
  let blockHeight: number | undefined
  if (j.status?.confirmed && j.status.block_height) {
    blockHeight = j.status.block_height
    try {
      const tipR = await explorerGet('/blocks/tip/height', network)
      if (tipR.ok) {
        const tip = parseInt(await tipR.text(), 10)
        if (Number.isFinite(tip)) confirmations = Math.max(0, tip - blockHeight + 1)
      }
    } catch {
      confirmations = 1
    }
  }

  // spent?
  let spent = false
  try {
    const outR = await explorerGet(`/tx/${txid}/outspend/${fundingVout}`, network)
    if (outR.ok) {
      const os = (await outR.json()) as { spent?: boolean }
      spent = Boolean(os.spent)
    }
  } catch {
    /* ignore */
  }

  return { valueSats, confirmations, spent, blockHeight }
}

/**
 * BIP143 sighash for single-input P2WSH (SIGHASH_ALL).
 * scriptCode = CompactSize(len) || witnessScript
 */
function bip143SighashP2wsh(opts: {
  version: number
  fundingTxid: string
  fundingVout: number
  amountSats: number
  sequence: number
  witnessScript: Uint8Array
  outputs: Array<{ value: number; script: Uint8Array }>
  locktime: number
  hashType?: number
}): Uint8Array {
  const hashType = opts.hashType ?? 1 // SIGHASH_ALL
  const prevouts = concatBytes(reverseHex(opts.fundingTxid), u32LE(opts.fundingVout))
  const hashPrevouts = hash256(prevouts)
  const hashSequence = hash256(u32LE(opts.sequence))

  const outParts: Uint8Array[] = []
  for (const o of opts.outputs) {
    outParts.push(u64LE(o.value), compactSize(o.script.length), o.script)
  }
  const hashOutputs = hash256(concatBytes(...outParts))

  const scriptCode = concatBytes(compactSize(opts.witnessScript.length), opts.witnessScript)

  return hash256(
    concatBytes(
      u32LE(opts.version),
      hashPrevouts,
      hashSequence,
      reverseHex(opts.fundingTxid),
      u32LE(opts.fundingVout),
      scriptCode,
      u64LE(opts.amountSats),
      u32LE(opts.sequence),
      hashOutputs,
      u32LE(opts.locktime),
      u32LE(hashType),
    ),
  )
}

/** Serialize segwit tx (marker/flag + witness). */
function serializeSegwitTx(opts: {
  version: number
  inputs: Array<{
    txid: string
    vout: number
    sequence: number
    /** witness stack items (not including empty scriptSig) */
    witness: Uint8Array[]
  }>
  outputs: Array<{ value: number; script: Uint8Array }>
  locktime: number
}): { rawHex: string; txid: string } {
  const parts: Uint8Array[] = [
    u32LE(opts.version),
    new Uint8Array([0x00, 0x01]), // marker + flag
    compactSize(opts.inputs.length),
  ]
  for (const inp of opts.inputs) {
    parts.push(
      reverseHex(inp.txid),
      u32LE(inp.vout),
      compactSize(0), // empty scriptSig
      new Uint8Array(0),
      u32LE(inp.sequence),
    )
  }
  parts.push(compactSize(opts.outputs.length))
  for (const o of opts.outputs) {
    parts.push(u64LE(o.value), compactSize(o.script.length), o.script)
  }
  for (const inp of opts.inputs) {
    parts.push(compactSize(inp.witness.length))
    for (const item of inp.witness) {
      parts.push(compactSize(item.length), item)
    }
  }
  parts.push(u32LE(opts.locktime))
  const raw = concatBytes(...parts)
  const rawHex = bytesToHex(raw)

  // txid = reverse(hash256(non-witness serialization))
  const nw: Uint8Array[] = [u32LE(opts.version), compactSize(opts.inputs.length)]
  for (const inp of opts.inputs) {
    nw.push(reverseHex(inp.txid), u32LE(inp.vout), compactSize(0), u32LE(inp.sequence))
  }
  nw.push(compactSize(opts.outputs.length))
  for (const o of opts.outputs) {
    nw.push(u64LE(o.value), compactSize(o.script.length), o.script)
  }
  nw.push(u32LE(opts.locktime))
  const dig = hash256(concatBytes(...nw))
  const txidBytes = new Uint8Array(dig.length)
  for (let i = 0; i < dig.length; i++) txidBytes[i] = dig[dig.length - 1 - i]

  return { rawHex, txid: bytesToHex(txidBytes) }
}

/**
 * Build + broadcast user claim of vault UTXO (ELSE path: CSV + preimage + CHECKSIG).
 * Witness stack: [sig, preimage, empty, witnessScript]
 *
 * Partial withdraw: set withdrawSats < vault value → payout that amount (minus fee
 * share) and lock remainder in a **new** vault (new preimage) so you can withdraw
 * again later for any amount ≤ remaining.
 */
export async function claimVaultBtc(opts: {
  privateKeyHex: string
  vault: VaultDepositRecord
  payoutAddress: string
  /**
   * How many sats of the vault to take out to the user address.
   * Default = full vault (minus fee). May be less for partial withdraw.
   */
  withdrawSats?: number
  network?: BtcNetwork
  feeRateSatPerVb?: number
  onStep?: (msg: string) => void
}): Promise<{
  txid: string
  feeSats: number
  payoutSats: number
  explorerUrl: string
  /** New vault holding change (partial withdraw only) */
  changeVault?: VaultDepositRecord
}> {
  const network = opts.network ?? 'testnet'
  const feeRate = opts.feeRateSatPerVb ?? 2
  const vault = opts.vault
  const csv = vault.csvBlocks || VAULT_CSV_BLOCKS
  const pk = opts.privateKeyHex.replace(/^0x/i, '').toLowerCase()
  const wallet = new Wallet(`0x${pk}`)
  const pubHex = wallet.signingKey.compressedPublicKey.replace(/^0x/i, '')

  if (pubHex.toLowerCase() !== vault.userPubKeyHex.replace(/^0x/i, '').toLowerCase()) {
    throw new Error(
      'BTC key does not match vault pubkey — use the same multi-chain key that funded the vault',
    )
  }

  opts.onStep?.('Checking vault UTXO confirmations (CSV)…')
  let status: VaultUtxoStatus | null = null
  for (let i = 0; i < 120; i++) {
    status = await fetchVaultUtxoStatus(vault.fundingTxid, vault.fundingVout, network)
    if (status.spent) {
      throw new Error('Vault UTXO already spent — claim may already be complete')
    }
    if (status.confirmations >= csv) break
    opts.onStep?.(
      `Vault CSV: ${status.confirmations}/${csv} confirmations — waiting for Bitcoin blocks…`,
    )
    await new Promise((r) => setTimeout(r, 15_000))
  }
  if (!status || status.confirmations < csv) {
    throw new Error(
      `Vault needs ${csv} BTC confirmations for claim (have ${status?.confirmations ?? 0}). Keep this device; retry Bridge Out claim later.`,
    )
  }

  const valueSats = status.valueSats > 0 ? status.valueSats : vault.amountSats
  const wantWithdraw = Math.min(
    valueSats,
    Math.floor(opts.withdrawSats ?? valueSats),
  )
  if (wantWithdraw < 546) throw new Error('Withdraw amount too small (dust)')

  const fullExit = wantWithdraw >= valueSats - 1
  // 1-in, 1-out full ~160 vB; partial 1-in 2-out (payout + change vault) ~200 vB
  const vsizeEst = fullExit ? 160 : 200
  let feeSats = Math.max(200, Math.ceil(vsizeEst * feeRate))

  let payoutSats: number
  let changeSats = 0
  let changeVaultScript: Uint8Array | null = null
  let changePreimageHex = ''
  let changeCommitHex = ''
  let changeVaultScriptHex = ''

  if (fullExit) {
    payoutSats = valueSats - feeSats
    if (payoutSats < 546) {
      feeSats = Math.max(148, valueSats - 546)
      payoutSats = valueSats - feeSats
    }
  } else {
    // Fee comes from the withdrawn slice; change stays in new vault
    payoutSats = wantWithdraw - feeSats
    changeSats = valueSats - wantWithdraw
    if (payoutSats < 546) {
      // take fee from change if possible
      const need = 546 - payoutSats
      if (changeSats - need >= 546) {
        changeSats -= need
        payoutSats = 546
        feeSats = valueSats - payoutSats - changeSats
      } else {
        throw new Error(
          `Partial withdraw too small after fee (want ${wantWithdraw} sats, fee ~${feeSats}). Try a larger amount or full vault.`,
        )
      }
    }
    if (changeSats > 0 && changeSats < 546) {
      // fold dust change into fee
      feeSats += changeSats
      changeSats = 0
    }
    if (changeSats >= 546) {
      // New vault for remainder (preimage revealed on this spend → must rotate)
      changePreimageHex = randomPreimageHex(32)
      changeCommitHex = commitOfPreimage(changePreimageHex)
      changeVaultScript = buildBitvmVaultScript({
        csvBlocks: csv,
        burnCommitHex: changeCommitHex,
        userPubKeyHex: pubHex,
      })
      changeVaultScriptHex = bytesToHex(changeVaultScript)
      opts.onStep?.(
        `Partial exit: ${payoutSats} sats to you, ${changeSats} sats re-vaulted for later…`,
      )
    }
  }

  if (payoutSats < 546) {
    throw new Error(`Vault too small to claim after fee (${valueSats} sats)`)
  }

  const payoutScript = p2pkhScript(decodeP2pkhAddress(opts.payoutAddress, network))
  const outputs: Array<{ value: number; script: Uint8Array }> = [
    { value: payoutSats, script: payoutScript },
  ]
  let changeVout: number | undefined
  if (changeSats >= 546 && changeVaultScript) {
    changeVout = outputs.length
    outputs.push({ value: changeSats, script: p2wshScriptPubKey(changeVaultScript) })
  }

  const version = 2
  const locktime = 0
  const sequence = csv & 0xffff
  const witnessScript = hexToBytes(vault.vaultScriptHex)
  const preimage = hexToBytes(vault.preimageHex)

  const commitCheck = bytesToHex(sha256(preimage))
  if (commitCheck.toLowerCase() !== vault.commitHex.replace(/^0x/i, '').toLowerCase()) {
    throw new Error('Vault preimage does not match stored commit — storage corrupted')
  }

  opts.onStep?.('Signing vault claim (BIP143 P2WSH)…')
  const digest = bip143SighashP2wsh({
    version,
    fundingTxid: vault.fundingTxid,
    fundingVout: vault.fundingVout,
    amountSats: valueSats,
    sequence,
    witnessScript,
    outputs,
    locktime,
    hashType: 1,
  })

  const sig = wallet.signingKey.sign(hexlify(digest))
  const r = getBytes('0x' + sig.r.slice(2).padStart(64, '0'))
  const s = getBytes('0x' + sig.s.slice(2).padStart(64, '0'))
  const der = derEncodeSig(r, s)
  const sigWithType = concatBytes(der, new Uint8Array([0x01]))

  const witness: Uint8Array[] = [
    sigWithType,
    preimage,
    new Uint8Array(0),
    witnessScript,
  ]

  const { rawHex, txid } = serializeSegwitTx({
    version,
    inputs: [
      {
        txid: vault.fundingTxid,
        vout: vault.fundingVout,
        sequence,
        witness,
      },
    ],
    outputs,
    locktime,
  })

  opts.onStep?.('Broadcasting vault claim to Bitcoin…')
  let broadcastId: string
  try {
    broadcastId = await broadcastBtcTx(rawHex, network)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/already|txn-already|exists/i.test(msg)) {
      broadcastId = txid
    } else {
      throw new Error(`Vault claim broadcast failed: ${msg}`)
    }
  }

  const claimTxid = (broadcastId || txid).replace(/[^0-9a-f]/gi, '').toLowerCase() || txid
  markVaultDepositClaimed(vault.fundingTxid, vault.fundingVout, claimTxid)

  let changeVault: VaultDepositRecord | undefined
  if (changeSats >= 546 && changeVout != null && changeVaultScriptHex) {
    changeVault = {
      v: 1,
      falconAccount: vault.falconAccount,
      fundingTxid: claimTxid,
      fundingVout: changeVout,
      amountSats: changeSats,
      vaultScriptHex: changeVaultScriptHex,
      preimageHex: changePreimageHex,
      commitHex: changeCommitHex,
      userPubKeyHex: pubHex,
      csvBlocks: csv,
      createdAt: Date.now(),
    }
    saveVaultDeposit(changeVault)
    // Also keep script key used by claim UI
    try {
      localStorage.setItem(`falcon-spv-vault-script-${claimTxid}`, changeVaultScriptHex)
    } catch {
      /* ignore */
    }
  }

  const explorerUrl =
    network === 'testnet'
      ? `https://mempool.space/testnet/tx/${claimTxid}`
      : `https://mempool.space/tx/${claimTxid}`

  return { txid: claimTxid, feeSats, payoutSats, explorerUrl, changeVault }
}

/**
 * Wait until vault UTXO has enough confs for CSV (or already spent).
 */
export async function waitVaultCsvReady(opts: {
  vault: VaultDepositRecord
  network?: BtcNetwork
  onStep?: (msg: string) => void
  maxPolls?: number
  intervalMs?: number
}): Promise<VaultUtxoStatus> {
  const network = opts.network ?? 'testnet'
  const csv = opts.vault.csvBlocks || VAULT_CSV_BLOCKS
  const maxPolls = opts.maxPolls ?? 120
  const intervalMs = opts.intervalMs ?? 15_000
  for (let i = 0; i < maxPolls; i++) {
    const st = await fetchVaultUtxoStatus(
      opts.vault.fundingTxid,
      opts.vault.fundingVout,
      network,
    )
    if (st.spent) return st
    if (st.confirmations >= csv) return st
    opts.onStep?.(
      `Waiting vault CSV: ${st.confirmations}/${csv} BTC confs (txid ${opts.vault.fundingTxid.slice(0, 10)}…)`,
    )
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`Timed out waiting for ${csv} BTC confirmations on vault UTXO`)
}

export { bytesToHex, hexToBytes, concatBytes, hexlify, getBytes }
