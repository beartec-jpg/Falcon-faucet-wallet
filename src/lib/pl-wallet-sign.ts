/**
 * Browser Falcon-512 signing for Falcon PL (2300) Pay txs.
 * falcon_secret never leaves the device. No Node builtins — wallet is a client component.
 */

import { decodeFalconSecret, bytesToHex, zeroize } from './falcon-keys'
import { getFalcon512 } from './falcon-wasm'

export type SignedPlPay = {
  account: string
  sequence: number
  destination: string
  amount: number
  fee: number
  network_id: number
  public_key: string
  signature: string
  tx_id: string
  body: 'Pay'
}

const DEFAULT_NETWORK_ID = 2300

async function sha256HexBrowser(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Matches Rust `serde_json::to_string(&TxBody::Pay)` — a JSON string `"Pay"`. */
const PAY_BODY_JSON = '"Pay"'

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

export async function signPlPay(opts: {
  account: string
  destination: string
  amount: number
  sequence: number
  fee?: number
  networkId?: number
  falconSecret: string
}): Promise<SignedPlPay> {
  const decoded = decodeFalconSecret(opts.falconSecret)
  const fee = opts.fee ?? 2
  const networkId = opts.networkId ?? DEFAULT_NETWORK_ID
  const amount = Math.floor(opts.amount)
  const payload = plPayPayload({
    account: opts.account,
    sequence: opts.sequence,
    destination: opts.destination,
    amount,
    fee,
    networkId,
  })
  const publicKey = bytesToHex(decoded.pubBlob.slice(1))
  const falcon = await getFalcon512()
  const msg = new TextEncoder().encode(payload)
  let signature: Uint8Array
  try {
    signature = falcon.sign(msg, decoded.secretKey)
  } finally {
    zeroize(decoded.secretKey)
  }
  const txId = await sha256HexBrowser(payload)
  return {
    account: opts.account,
    sequence: opts.sequence,
    destination: opts.destination,
    amount,
    fee,
    network_id: networkId,
    public_key: publicKey,
    signature: bytesToHex(signature),
    tx_id: txId,
    body: 'Pay',
  }
}
