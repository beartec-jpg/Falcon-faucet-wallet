/**
 * Browser Falcon-512 signing for Falcon PL (2300) Pay txs.
 * falcon_secret never leaves the device. No Node builtins — wallet is a client component.
 */

import { decodeFalconSecret, bytesToHex, zeroize } from './falcon-keys'
import { getFalcon512 } from './falcon-wasm'

export type SignedPlTx = {
  account: string
  sequence: number
  destination: string
  amount: number
  fee: number
  network_id: number
  public_key: string
  signature: string
  tx_id: string
  body: Record<string, unknown>
}

export type SignedPlPay = SignedPlTx

const DEFAULT_NETWORK_ID = 2300

async function sha256HexBrowser(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Matches Rust `serde_json::{tag:kind, rename_all:snake_case}` for TxBody::Pay. */
const PAY_BODY_JSON = '{"kind":"pay"}'

export function plPayPayload(opts: {
  account: string
  sequence: number
  destination: string
  amount: number
  fee: number
  networkId: number
}): string {
  return `pl-tx:v2|${opts.account}|${opts.sequence}|${opts.destination}|${opts.amount}|${opts.fee}|${opts.networkId}|${PAY_BODY_JSON}`
}

async function signPlBody(opts: {
  account: string
  destination: string
  amount: number
  sequence: number
  fee: number
  networkId: number
  body: Record<string, unknown>
  falconSecret: string
}): Promise<SignedPlTx> {
  const decoded = decodeFalconSecret(opts.falconSecret)
  const bodyJson = JSON.stringify(opts.body)
  const payload = `pl-tx:v2|${opts.account}|${opts.sequence}|${opts.destination}|${opts.amount}|${opts.fee}|${opts.networkId}|${bodyJson}`
  const publicKey = bytesToHex(decoded.pubBlob.slice(1))
  const falcon = await getFalcon512()
  const msg = new TextEncoder().encode(payload)
  let signature: Uint8Array
  try {
    signature = falcon.sign(msg, decoded.secretKey)
  } finally {
    zeroize(decoded.secretKey)
  }
  return {
    account: opts.account,
    sequence: opts.sequence,
    destination: opts.destination,
    amount: opts.amount,
    fee: opts.fee,
    network_id: opts.networkId,
    public_key: publicKey,
    signature: bytesToHex(signature),
    tx_id: await sha256HexBrowser(payload),
    body: opts.body,
  }
}

export async function signPlPay(opts: {
  account: string
  destination: string
  amount: number
  sequence: number
  fee?: number
  networkId?: number
  falconSecret: string
}): Promise<SignedPlPay> {
  return signPlBody({
    account: opts.account,
    destination: opts.destination,
    amount: Math.floor(opts.amount),
    sequence: opts.sequence,
    fee: opts.fee ?? 2,
    networkId: opts.networkId ?? DEFAULT_NETWORK_ID,
    body: { kind: 'pay' },
    falconSecret: opts.falconSecret,
  })
}

/** Convert this account to a vault locked to `destination`. */
export async function signVaultOpen(opts: {
  account: string
  destination: string
  sequence: number
  fee?: number
  networkId?: number
  falconSecret: string
}): Promise<SignedPlTx> {
  return signPlBody({
    account: opts.account,
    destination: opts.destination,
    amount: 0,
    sequence: opts.sequence,
    fee: opts.fee ?? 2,
    networkId: opts.networkId ?? DEFAULT_NETWORK_ID,
    body: { kind: 'vault_open', destination: opts.destination },
    falconSecret: opts.falconSecret,
  })
}

export async function signVaultLock(opts: {
  account: string
  sequence: number
  fee?: number
  networkId?: number
  falconSecret: string
}): Promise<SignedPlTx> {
  return signPlBody({
    account: opts.account,
    destination: '',
    amount: 0,
    sequence: opts.sequence,
    fee: opts.fee ?? 2,
    networkId: opts.networkId ?? DEFAULT_NETWORK_ID,
    body: { kind: 'vault_lock' },
    falconSecret: opts.falconSecret,
  })
}

export type PlBridgeProof = {
  external_txid: string
  block_hash: string
  height: number
  merkle_path: string[]
  merkle_index: number
  lock_id: string
  parent_hash: string
  merkle_root: string
  external_to: string
  raw_tx?: string
}

export async function signRailHeader(opts: {
  account: string
  sequence: number
  asset: string
  height: number
  hash: string
  parentHash: string
  merkleRoot: string
  /** 80-byte Bitcoin header hex. Required on 2.9.35+ BTC rail. */
  raw?: string
  fee?: number
  networkId?: number
  falconSecret: string
}): Promise<SignedPlTx> {
  const body: Record<string, unknown> = {
    kind: 'rail_header',
    asset: opts.asset,
    height: opts.height,
    hash: opts.hash,
    parent_hash: opts.parentHash,
    merkle_root: opts.merkleRoot,
  }
  if (opts.raw) body.raw = opts.raw.replace(/^0x/i, '').toLowerCase()
  return signPlBody({
    account: opts.account,
    destination: '',
    amount: 0,
    sequence: opts.sequence,
    fee: opts.fee ?? 2,
    networkId: opts.networkId ?? DEFAULT_NETWORK_ID,
    body,
    falconSecret: opts.falconSecret,
  })
}

export async function signRailDeposit(opts: {
  account: string
  sequence: number
  asset: string
  to: string
  amount: number
  proof: PlBridgeProof
  fee?: number
  networkId?: number
  falconSecret: string
}): Promise<SignedPlTx> {
  return signPlBody({
    account: opts.account,
    destination: opts.to,
    amount: Math.floor(opts.amount),
    sequence: opts.sequence,
    fee: opts.fee ?? 2,
    networkId: opts.networkId ?? DEFAULT_NETWORK_ID,
    body: {
      kind: 'rail_deposit',
      asset: opts.asset,
      to: opts.to,
      amount: Math.floor(opts.amount),
      proof: {
        external_txid: opts.proof.external_txid,
        block_hash: opts.proof.block_hash,
        height: opts.proof.height,
        merkle_path: opts.proof.merkle_path,
        merkle_index: opts.proof.merkle_index,
        lock_id: opts.proof.lock_id,
        parent_hash: opts.proof.parent_hash,
        merkle_root: opts.proof.merkle_root,
        external_to: opts.proof.external_to,
        ...(opts.proof.raw_tx
          ? { raw_tx: opts.proof.raw_tx.replace(/^0x/i, '').toLowerCase() }
          : {}),
      },
    },
    falconSecret: opts.falconSecret,
  })
}

export async function signRailWithdraw(opts: {
  account: string
  sequence: number
  asset: string
  amount: number
  externalTo: string
  fee?: number
  networkId?: number
  falconSecret: string
}): Promise<SignedPlTx> {
  return signPlBody({
    account: opts.account,
    destination: opts.externalTo,
    amount: Math.floor(opts.amount),
    sequence: opts.sequence,
    fee: opts.fee ?? 2,
    networkId: opts.networkId ?? DEFAULT_NETWORK_ID,
    body: {
      kind: 'rail_withdraw',
      asset: opts.asset,
      amount: Math.floor(opts.amount),
      external_to: opts.externalTo,
    },
    falconSecret: opts.falconSecret,
  })
}
