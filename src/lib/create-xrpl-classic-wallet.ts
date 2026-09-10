/**
 * Classic XRPL multi-chain wallet (today’s XRP Ledger crypto).
 *
 * Separate from Falcon-512 keys:
 *  - secp256k1 / ed25519 family seed (s…)
 *  - own classic r… address (not the Falcon r…)
 *  - signs in-browser; balance/submit via same-origin API (CORS-safe)
 *
 * Stored encrypted under the same passkey vault as ETH/BTC keys.
 */

import { ed25519 } from '@noble/curves/ed25519'
import { secp256k1 } from '@noble/curves/secp256k1'
import { bytesToNumberBE, numberToBytesBE } from '@noble/curves/abstract/utils'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import * as classicAddressNs from '@/lib/classic-address'
import { authenticatePasskey } from '@/lib/passkey'
import { encryptSeed, type EncryptedSeed } from '@/lib/wallet-crypto'
import { loadPrimaryWallet, saveWallet, type StoredWallet } from '@/lib/wallet-store'
import {
  XRPL_CLASSIC_HTTP,
  XRPL_CLASSIC_WS,
  fetchXrplClassicXrpBalance,
  xrplClassicRpc,
  type XrplClassicNetwork,
} from '@/lib/xrpl-classic-rpc'

export type { XrplClassicNetwork }
export { XRPL_CLASSIC_HTTP, XRPL_CLASSIC_WS, fetchXrplClassicXrpBalance, xrplClassicRpc }

/** XLS-37 NetworkID (omit / 0 on mainnet). */
const XRPL_NETWORK_ID: Record<XrplClassicNetwork, number | undefined> = {
  testnet: 1,
  mainnet: undefined,
}

export function hasXrplClassicWallet(
  wallet: Pick<StoredWallet, 'xrplClassicAddress' | 'xrplClassicEncrypted'>,
): boolean {
  return !!(wallet.xrplClassicAddress && wallet.xrplClassicEncrypted)
}

async function xrplWallet() {
  const { Wallet } = await import('xrpl')
  return Wallet
}

type ClassicCodec = {
  encodeSeed: (entropy: Uint8Array, type?: 'ed25519' | 'secp256k1') => string
  decodeSeed: (seed: string) => { bytes: Uint8Array; type: 'ed25519' | 'secp256k1' }
  encodeAccountID: (bytes: Uint8Array) => string
}

function classicCodec(): ClassicCodec {
  const ns = classicAddressNs as typeof classicAddressNs & { default?: ClassicCodec }
  const src = (typeof ns.encodeSeed === 'function' ? ns : ns.default) as ClassicCodec | undefined
  if (
    !src ||
    typeof src.encodeSeed !== 'function' ||
    typeof src.decodeSeed !== 'function' ||
    typeof src.encodeAccountID !== 'function'
  ) {
    throw new Error('Classic XRP codec failed to load')
  }
  return src
}

function bytesToHexUpper(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

function randomClassicSeed(type: 'ed25519' | 'secp256k1' = 'ed25519'): string {
  const entropy = new Uint8Array(16)
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('Secure randomness is not available')
  }
  crypto.getRandomValues(entropy)
  return classicCodec().encodeSeed(entropy, type)
}

function sha512First256(bytes: Uint8Array, extra?: Uint8Array[]): Uint8Array {
  const h = sha512.create()
  h.update(bytes)
  if (extra) {
    for (const part of extra) h.update(part)
  }
  return h.digest().subarray(0, 32)
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n >>> 0)
  return b
}

/** XRPL secp256k1 family-seed scalar (ripple-keypairs derivePrivateKey). */
function deriveSecp256k1Scalar(seed: Uint8Array): bigint {
  const order = secp256k1.CURVE.n
  const deriveScalar = (bytes: Uint8Array, discrim?: number): bigint => {
    for (let i = 0; i <= 0xffffffff; i++) {
      const extra = discrim === undefined ? [u32be(i)] : [u32be(discrim), u32be(i)]
      const key = bytesToNumberBE(sha512First256(bytes, extra))
      if (key > 0n && key < order) return key
    }
    throw new Error('secp256k1 scalar derivation failed')
  }
  const privateGen = deriveScalar(seed)
  const publicGen = secp256k1.ProjectivePoint.BASE.multiply(privateGen).toRawBytes(true)
  return (deriveScalar(publicGen, 0) + privateGen) % order
}

function addressFromPublicKeyBytes(pubBytes: Uint8Array): string {
  return classicCodec().encodeAccountID(ripemd160(sha256(pubBytes)))
}

/** Family seed → classic r-address. Does not import xrpl.js (encodeSeed alias is unsafe). */
function deriveClassicWallet(seed: string): {
  seed: string
  address: string
  publicKey: string
  privateKey: string
} {
  const trimmed = seed.trim()
  const decoded = classicCodec().decodeSeed(trimmed)
  if (decoded.type === 'ed25519') {
    const rawPrivateKey = sha512(decoded.bytes).subarray(0, 32)
    const rawPublicKey = ed25519.getPublicKey(rawPrivateKey)
    const pubBytes = new Uint8Array(33)
    pubBytes[0] = 0xed
    pubBytes.set(rawPublicKey, 1)
    return {
      seed: trimmed,
      address: addressFromPublicKeyBytes(pubBytes),
      publicKey: `ED${bytesToHexUpper(rawPublicKey)}`,
      privateKey: `ED${bytesToHexUpper(rawPrivateKey)}`,
    }
  }
  const scalar = deriveSecp256k1Scalar(decoded.bytes)
  const rawPublicKey = secp256k1.getPublicKey(scalar, true)
  return {
    seed: trimmed,
    address: addressFromPublicKeyBytes(rawPublicKey),
    publicKey: bytesToHexUpper(rawPublicKey),
    privateKey: `00${bytesToHexUpper(numberToBytesBE(scalar, 32))}`,
  }
}

export function createRandomXrplClassicWallet(): Promise<{
  seed: string
  address: string
  publicKey: string
}> {
  const seed = randomClassicSeed('ed25519')
  const w = deriveClassicWallet(seed)
  if (!w.seed || !w.address) throw new Error('Failed to generate classic XRPL seed')
  return Promise.resolve({ seed: w.seed, address: w.address, publicKey: w.publicKey })
}

export async function encryptXrplClassicSeedForPasskey(
  seed: string,
  keyBytes: Uint8Array,
  hasPrf: boolean,
): Promise<{ address: string; publicKey: string; xrplClassicEncrypted: EncryptedSeed }> {
  const trimmed = seed.trim()
  const w = deriveClassicWallet(trimmed)
  const xrplClassicEncrypted = await encryptSeed(trimmed, keyBytes, hasPrf)
  return {
    address: w.address,
    publicKey: w.publicKey,
    xrplClassicEncrypted,
  }
}

export async function createXrplClassicWalletForPasskey(
  keyBytes: Uint8Array,
  hasPrf: boolean,
): Promise<{
  seed: string
  address: string
  publicKey: string
  xrplClassicEncrypted: EncryptedSeed
}> {
  const { seed, address, publicKey } = await createRandomXrplClassicWallet()
  const xrplClassicEncrypted = await encryptSeed(seed, keyBytes, hasPrf)
  return { seed, address, publicKey, xrplClassicEncrypted }
}

/** Add classic XRPL keys to an existing Falcon wallet (passkey prompt). */
export async function provisionXrplClassicWalletForStoredWallet(
  wallet: StoredWallet,
): Promise<StoredWallet> {
  if (hasXrplClassicWallet(wallet)) return wallet
  const { keyBytes, hasPrf } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
  const classic = await createXrplClassicWalletForPasskey(keyBytes, hasPrf)
  const updated: StoredWallet = {
    ...wallet,
    xrplClassicAddress: classic.address,
    xrplClassicPublicKey: classic.publicKey,
    xrplClassicEncrypted: classic.xrplClassicEncrypted,
  }
  await saveWallet(updated)
  const reloaded = await loadPrimaryWallet()
  if (!reloaded || !hasXrplClassicWallet(reloaded)) {
    throw new Error('Classic XRPL wallet could not be saved — try again in this browser tab')
  }
  return reloaded
}

/** Sign in-browser + submit signed blob via same-origin proxy (testnet by default). */
export async function sendClassicXrpPayment(opts: {
  seed: string
  destination: string
  amountXrp: string
  network?: XrplClassicNetwork
}): Promise<{ hash: string; engine_result: string }> {
  const network = opts.network ?? 'testnet'
  const derived = deriveClassicWallet(opts.seed.trim())
  const Wallet = await xrplWallet()
  const wallet = new Wallet(derived.publicKey, derived.privateKey, {
    seed: derived.seed,
    masterAddress: derived.address,
  })
  const drops = String(Math.round(parseFloat(opts.amountXrp) * 1_000_000))
  if (!/^\d+$/.test(drops) || drops === '0') throw new Error('Invalid XRP amount')
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(opts.destination.trim())) {
    throw new Error('Invalid classic XRPL destination')
  }

  let info: { account_data?: { Sequence?: number }; error?: string }
  try {
    info = await xrplClassicRpc(network, 'account_info', {
      account: wallet.classicAddress,
      ledger_index: 'current',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('actNotFound') || msg.includes('Account not found')) {
      throw new Error(
        network === 'testnet'
          ? 'Classic XRPL testnet account not funded yet — use the XRPL testnet faucet'
          : 'Classic XRPL account not found / unfunded',
      )
    }
    throw e
  }
  if (info.error === 'actNotFound' || !info.account_data?.Sequence) {
    throw new Error(
      network === 'testnet'
        ? 'Classic XRPL testnet account not funded yet — use the XRPL testnet faucet'
        : 'Classic XRPL account not found / unfunded',
    )
  }

  const feeR = await xrplClassicRpc<{
    drops?: { open_ledger_fee?: string; median_fee?: string; minimum_fee?: string }
  }>(network, 'fee', {})
  const fee =
    feeR.drops?.open_ledger_fee ||
    feeR.drops?.median_fee ||
    feeR.drops?.minimum_fee ||
    '12'

  let lastLedger = 0
  try {
    const cur = await xrplClassicRpc<{ ledger_current_index?: number }>(
      network,
      'ledger_current',
      {},
    )
    lastLedger = (cur.ledger_current_index ?? 0) + 20
  } catch {
    lastLedger = 0
  }

  const networkId = XRPL_NETWORK_ID[network]
  const tx: Record<string, unknown> = {
    TransactionType: 'Payment',
    Account: wallet.classicAddress,
    Destination: opts.destination.trim(),
    Amount: drops,
    Sequence: info.account_data.Sequence,
    Fee: fee,
  }
  if (lastLedger > 0) tx.LastLedgerSequence = lastLedger
  if (networkId != null) tx.NetworkID = networkId

  // Sign via xrpl.Wallet (secp256k1 / ed25519 — not Falcon-512). Seed never leaves the device.
  const signed = wallet.sign(tx as never)
  const submit = await xrplClassicRpc<{
    engine_result?: string
    engine_result_message?: string
    tx_json?: { hash?: string }
  }>(network, 'submit', { tx_blob: signed.tx_blob })

  const eng = submit.engine_result || 'unknown'
  if (!eng.startsWith('tes') && !eng.startsWith('ter')) {
    throw new Error(
      `XRPL submit: ${eng}${submit.engine_result_message ? ` — ${submit.engine_result_message}` : ''}`,
    )
  }
  return {
    hash: signed.hash || submit.tx_json?.hash || '',
    engine_result: eng,
  }
}
