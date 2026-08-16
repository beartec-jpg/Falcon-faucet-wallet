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
  body: { kind: string; destination?: string }
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
  body: SignedPlTx['body']
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
