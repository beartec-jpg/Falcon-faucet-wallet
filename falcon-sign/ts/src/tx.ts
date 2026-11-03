// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 BEARTEC
//
// Falcon PL transaction format, as implemented by the Rust node
// (falcon-pl-rs/crates/fd-pl `Tx::payload`, `Tx::sign_body`, `Tx::verify`):
//
//   payload = "pl-tx:v2|{account}|{sequence}|{destination}|{amount}|{fee}|{network_id}|{body_json}"
//   signature = Falcon-512 detached signature over UTF-8(payload)
//   tx_id = lowercase hex SHA-256(UTF-8(payload))
//
// body_json must be byte-identical to `serde_json::to_string(&TxBody)` (internally
// tagged with "kind", snake_case, declared field order) because the node
// re-serialises the body it parsed before checking tx_id and signature.

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8 } from './hex.js'
import { keyPairFromFalconSecret, sign, verify, type FalconKeyPair } from './keys.js'

/** Falcon PL testnet network id. */
export const FPL_TESTNET_NETWORK_ID = 2300
/** Default fee in base units, as the wallet uses. */
export const DEFAULT_FEE = 2
export const TX_DOMAIN = 'pl-tx:v2'

/** u64 input: bigint, safe integer number, or decimal digit string. */
export type U64 = bigint | number | string

const U64_MAX = (1n << 64n) - 1n

export function u64(v: U64, label = 'value'): string {
  let n: bigint
  if (typeof v === 'bigint') n = v
  else if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new Error(`${label} must be a safe integer (use bigint or string)`)
    n = BigInt(v)
  } else {
    if (!/^(0|[1-9][0-9]*)$/.test(v)) throw new Error(`${label} must be an unsigned integer`)
    n = BigInt(v)
  }
  if (n < 0n || n > U64_MAX) throw new Error(`${label} out of u64 range`)
  return n.toString()
}

function u32(v: number, label: string): string {
  if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new Error(`${label} must be a u32`)
  return String(v)
}

// ─── Body kinds ──────────────────────────────────────────────────────────────

type F = 's' | 'u' | 'u32' | 'skip_empty_s' | 'opt_u_skip' | 'opt_s'

/** Field order and types mirror `enum TxBody` in fd-pl. */
export const BODY_SPEC = {
  pay: [],
  asset_pay: [['asset', 's']],
  pay_to_key: [['key_hash', 's']],
  bond: [['validator', 's']],
  unbond: [['validator', 's'], ['amount', 'u']],
  complete_unbond: [['validator', 's']],
  unjail: [['validator', 's']],
  vault_open: [['destination', 's']],
  vault_lock: [],
  claim: [],
  watcher_heartbeat: [],
  add_liquidity: [['pool_id', 's'], ['amt_a', 'u'], ['amt_b', 'u']],
  remove_liquidity: [['pool_id', 's'], ['lp_burn', 'u']],
  swap: [['pool_id', 's'], ['token_in', 's'], ['amount_in', 'u'], ['min_out', 'u']],
  swap_route: [['token_in', 's'], ['token_out', 's'], ['amount_in', 'u'], ['min_out', 'u']],
  lend_supply: [['market_id', 's'], ['amount', 'u']],
  lend_withdraw: [['market_id', 's'], ['shares', 'u']],
  lend_borrow: [['market_id', 's'], ['amount', 'u'], ['collateral_fpl', 'u']],
  lend_repay: [['market_id', 's'], ['amount', 'u']],
  rail_withdraw: [['asset', 's'], ['amount', 'u'], ['external_to', 's'], ['vault_sig', 'skip_empty_s'], ['signed_btc_tx', 'skip_empty_s']],
  set_external_addrs: [['chain', 's'], ['address', 's']],
  place_limit_order: [['pair', 's'], ['side', 's'], ['price', 'u'], ['amount', 'u'], ['expiry_height', 'opt_u_skip']],
  cancel_order: [['order_id', 'u']],
} as const satisfies Record<string, readonly (readonly [string, F])[]>

export type BodyKind = keyof typeof BODY_SPEC

export type TxBody =
  | { kind: 'pay' }
  | { kind: 'asset_pay'; asset: string }
  | { kind: 'pay_to_key'; key_hash: string }
  | { kind: 'bond'; validator: string }
  | { kind: 'unbond'; validator: string; amount: U64 }
  | { kind: 'complete_unbond'; validator: string }
  | { kind: 'unjail'; validator: string }
  | { kind: 'vault_open'; destination: string }
  | { kind: 'vault_lock' }
  | { kind: 'claim' }
  | { kind: 'watcher_heartbeat' }
  | { kind: 'add_liquidity'; pool_id: string; amt_a: U64; amt_b: U64 }
  | { kind: 'remove_liquidity'; pool_id: string; lp_burn: U64 }
  | { kind: 'swap'; pool_id: string; token_in: string; amount_in: U64; min_out: U64 }
  | { kind: 'swap_route'; token_in: string; token_out: string; amount_in: U64; min_out: U64 }
  | { kind: 'lend_supply'; market_id: string; amount: U64 }
  | { kind: 'lend_withdraw'; market_id: string; shares: U64 }
  | { kind: 'lend_borrow'; market_id: string; amount: U64; collateral_fpl: U64 }
  | { kind: 'lend_repay'; market_id: string; amount: U64 }
  | { kind: 'rail_withdraw'; asset: string; amount: U64; external_to: string; vault_sig?: string; signed_btc_tx?: string }
  | { kind: 'set_external_addrs'; chain: string; address: string }
  | { kind: 'place_limit_order'; pair: string; side: 'buy' | 'sell' | string; price: U64; amount: U64; expiry_height?: U64 | null }
  | { kind: 'cancel_order'; order_id: U64 }

/** Exact serde_json encoding of a body (see module comment). */
export function serializeBody(body: TxBody): string {
  const kind = body.kind === ('set_external_addr' as string) ? 'set_external_addrs' : body.kind
  const spec = (BODY_SPEC as Record<string, readonly (readonly [string, F])[]>)[kind]
  if (!spec) throw new Error(`unsupported body kind: ${body.kind}`)
  const b = body as unknown as Record<string, unknown>
  let out = `{"kind":${JSON.stringify(kind)}`
  for (const [name, t] of spec) {
    const v = b[name]
    switch (t) {
      case 's':
        if (typeof v !== 'string') throw new Error(`${kind}.${name} must be a string`)
        out += `,"${name}":${JSON.stringify(v)}`
        break
      case 'skip_empty_s':
        if (v === undefined || v === null || v === '') break
        if (typeof v !== 'string') throw new Error(`${kind}.${name} must be a string`)
        out += `,"${name}":${JSON.stringify(v)}`
        break
      case 'opt_s':
        out += `,"${name}":${v === undefined || v === null ? 'null' : JSON.stringify(String(v))}`
        break
      case 'u':
        out += `,"${name}":${u64(v as U64, `${kind}.${name}`)}`
        break
      case 'u32':
        out += `,"${name}":${u32(v as number, `${kind}.${name}`)}`
        break
      case 'opt_u_skip':
        if (v === undefined || v === null) break
        out += `,"${name}":${u64(v as U64, `${kind}.${name}`)}`
        break
    }
  }
  return out + '}'
}

// ─── Unsigned / signed tx ────────────────────────────────────────────────────

export interface UnsignedTx {
  account: string
  sequence: U64
  destination: string
  amount: U64
  fee: U64
  networkId: number
  body: TxBody
}

export interface SignedTx {
  /** Exact wire JSON (u64s as JSON numbers). Submit this. */
  json: string
  txId: string
  /** Same data with u64 fields as decimal strings (safe for JS). */
  tx: {
    account: string
    sequence: string
    destination: string
    amount: string
    fee: string
    network_id: number
    public_key: string
    signature: string
    tx_id: string
    body: TxBody
  }
}

export function txPayload(t: UnsignedTx): string {
  if (t.account.includes('|') || t.destination.includes('|')) throw new Error('account/destination must not contain "|"')
  return (
    `${TX_DOMAIN}|${t.account}|${u64(t.sequence, 'sequence')}|${t.destination}|${u64(t.amount, 'amount')}|` +
    `${u64(t.fee, 'fee')}|${u32(t.networkId, 'networkId')}|${serializeBody(t.body)}`
  )
}

export function txIdOfPayload(payload: string): string {
  return bytesToHex(sha256(utf8(payload)))
}

/** tx id the node will compute for this tx. */
export function txId(t: UnsignedTx): string {
  return txIdOfPayload(txPayload(t))
}

function assembleJson(t: UnsignedTx, publicKey: string, signature: string, id: string): string {
  return (
    `{"account":${JSON.stringify(t.account)},"sequence":${u64(t.sequence)},` +
    `"destination":${JSON.stringify(t.destination)},"amount":${u64(t.amount)},"fee":${u64(t.fee)},` +
    `"network_id":${t.networkId},"public_key":${JSON.stringify(publicKey)},` +
    `"signature":${JSON.stringify(signature)},"tx_id":${JSON.stringify(id)},"body":${serializeBody(t.body)}}`
  )
}

/**
 * Sign a tx. `key` is a FalconKeyPair or a wallet `falcon_secret` hex string.
 * The secret never leaves this process.
 */
export async function signTx(t: UnsignedTx, key: FalconKeyPair | string): Promise<SignedTx> {
  const kp = typeof key === 'string' ? keyPairFromFalconSecret(key) : key
  try {
    const payload = txPayload(t)
    const sig = bytesToHex(await sign(payload, kp))
    const id = txIdOfPayload(payload)
    return {
      json: assembleJson(t, kp.publicKeyHex, sig, id),
      txId: id,
      tx: {
        account: t.account,
        sequence: u64(t.sequence),
        destination: t.destination,
        amount: u64(t.amount),
        fee: u64(t.fee),
        network_id: t.networkId,
        public_key: kp.publicKeyHex,
        signature: sig,
        tx_id: id,
        body: t.body,
      },
    }
  } finally {
    if (typeof key === 'string') kp.destroy()
  }
}

/** Quote every bare integer literal so JSON.parse keeps u64 precision. */
function quoteInts(json: string): string {
  let out = ''
  let inStr = false
  for (let i = 0; i < json.length; i++) {
    const c = json[i]
    if (inStr) {
      out += c
      if (c === '\\') out += json[++i]
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; out += c; continue }
    if (c === '-' || (c >= '0' && c <= '9')) {
      let j = i
      while (j < json.length && /[-+0-9.eE]/.test(json[j])) j++
      out += `"${json.slice(i, j)}"`
      i = j - 1
      continue
    }
    out += c
  }
  return out
}

/** Parse wire JSON losslessly (u64 fields become strings). */
export function parseTxJson(json: string): SignedTx['tx'] {
  const o = JSON.parse(quoteInts(json))
  return { ...o, network_id: Number(o.network_id) }
}

export type VerifyResult = { ok: true; txId: string } | { ok: false; error: string }

/**
 * Check a signed tx the way the node does (`Tx::verify`): recompute the
 * payload from the fields, require tx_id = sha256(payload) and a valid
 * Falcon-512 signature by `public_key`. (The node additionally requires that
 * `public_key` is the key registered for `account`.)
 */
export async function verifyTx(signed: SignedTx | string): Promise<VerifyResult> {
  let tx: SignedTx['tx']
  try {
    tx = typeof signed === 'string' ? parseTxJson(signed) : signed.tx
  } catch (e) {
    return { ok: false, error: `bad json: ${(e as Error).message}` }
  }
  let payload: string
  try {
    payload = txPayload({
      account: tx.account,
      sequence: tx.sequence,
      destination: tx.destination,
      amount: tx.amount,
      fee: tx.fee,
      networkId: tx.network_id,
      body: tx.body ?? { kind: 'pay' },
    })
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  const id = txIdOfPayload(payload)
  if (id !== tx.tx_id) return { ok: false, error: 'tx_id mismatch' }
  if (!(await verify(payload, tx.signature, tx.public_key))) return { ok: false, error: 'bad signature' }
  return { ok: true, txId: id }
}
