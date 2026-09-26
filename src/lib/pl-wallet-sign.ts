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
  /** Exact JSON with u64 amounts as JSON numbers (not JS Number). */
  rawJson?: string
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

/** Decimal string to exact base-unit digits. 0.02 ETH is 2×10^16 wei, which is not a safe JS integer. */
export function decimalToBaseUnits(raw: string, decimals: number): string {
  const s = raw.trim()
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Invalid amount')
  const [whole, frac = ''] = s.split('.')
  if (frac.length > decimals) throw new Error('Too many decimal places')
  const digits = (whole + (frac + '0'.repeat(decimals)).slice(0, decimals)).replace(/^0+/, '')
  if (!digits) throw new Error('Amount must be greater than zero')
  return digits
}

function u64Digits(s: string, label: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(s)) throw new Error(`${label} must be an integer`)
  return s
}

/** Sign a body whose u64 fields are already exact digit strings. serde field order is fixed. */
async function signPlExact(opts: {
  account: string
  destination: string
  amountDigits: string
  sequence: number
  fee: number
  networkId: number
  bodyJson: string
  body: Record<string, unknown>
  falconSecret: string
}): Promise<SignedPlTx> {
  const amountDigits = u64Digits(opts.amountDigits, 'amount')
  const decoded = decodeFalconSecret(opts.falconSecret)
  const payload = `pl-tx:v2|${opts.account}|${opts.sequence}|${opts.destination}|${amountDigits}|${opts.fee}|${opts.networkId}|${opts.bodyJson}`
  const publicKey = bytesToHex(decoded.pubBlob.slice(1))
  const falcon = await getFalcon512()
  const msg = new TextEncoder().encode(payload)
  let signature: Uint8Array
  try {
    signature = falcon.sign(msg, decoded.secretKey)
  } finally {
    zeroize(decoded.secretKey)
  }
  const sigHex = bytesToHex(signature)
  const txId = await sha256HexBrowser(payload)
  const rawJson =
    `{"account":${JSON.stringify(opts.account)},"sequence":${opts.sequence},` +
    `"destination":${JSON.stringify(opts.destination)},"amount":${amountDigits},"fee":${opts.fee},` +
    `"network_id":${opts.networkId},"public_key":${JSON.stringify(publicKey)},` +
    `"signature":${JSON.stringify(sigHex)},"tx_id":${JSON.stringify(txId)},"body":${opts.bodyJson}}`
  return {
    account: opts.account,
    sequence: opts.sequence,
    destination: opts.destination,
    amount: Number(amountDigits),
    fee: opts.fee,
    network_id: opts.networkId,
    public_key: publicKey,
    signature: sigHex,
    tx_id: txId,
    body: opts.body,
    rawJson,
  }
}

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

export async function signPlSwapRoute(opts: {
  account: string
  tokenIn: 'FPL' | 'BTC' | 'ETH' | 'USDC'
  tokenOut: 'FPL' | 'BTC' | 'ETH' | 'USDC'
  amountIn: string
  minOut: string
  sequence: number
  fee?: number
  networkId?: number
  falconSecret: string
}): Promise<SignedPlTx> {
  const amountIn = u64Digits(opts.amountIn, 'amount')
  const minOut = u64Digits(opts.minOut, 'min out')
  const bodyJson =
    `{"kind":"swap_route","token_in":${JSON.stringify(opts.tokenIn)},` +
    `"token_out":${JSON.stringify(opts.tokenOut)},"amount_in":${amountIn},"min_out":${minOut}}`
  return signPlExact({
    account: opts.account,
    destination: '',
    amountDigits: '0',
    sequence: opts.sequence,
    fee: opts.fee ?? 2,
    networkId: opts.networkId ?? DEFAULT_NETWORK_ID,
    bodyJson,
    body: {
      kind: 'swap_route',
      token_in: opts.tokenIn,
      token_out: opts.tokenOut,
      amount_in: amountIn,
      min_out: minOut,
    },
    falconSecret: opts.falconSecret,
  })
}

export async function signPlAddLiquidity(opts: {
  account: string
  poolId: string
  amtA: string
  amtB: string
  sequence: number
  fee?: number
  networkId?: number
  falconSecret: string
}): Promise<SignedPlTx> {
  const amtA = u64Digits(opts.amtA, 'amount')
  const amtB = u64Digits(opts.amtB, 'amount')
  const bodyJson =
    `{"kind":"add_liquidity","pool_id":${JSON.stringify(opts.poolId)},"amt_a":${amtA},"amt_b":${amtB}}`
  return signPlExact({
    account: opts.account,
    destination: '',
    amountDigits: '0',
    sequence: opts.sequence,
    fee: opts.fee ?? 2,
    networkId: opts.networkId ?? DEFAULT_NETWORK_ID,
    bodyJson,
    body: { kind: 'add_liquidity', pool_id: opts.poolId, amt_a: amtA, amt_b: amtB },
    falconSecret: opts.falconSecret,
  })
}

export async function signPlRemoveLiquidity(opts: {
  account: string
  poolId: string
  lpBurn: string
  sequence: number
  fee?: number
  networkId?: number
  falconSecret: string
}): Promise<SignedPlTx> {
  const lpBurn = u64Digits(opts.lpBurn, 'LP')
  const bodyJson =
    `{"kind":"remove_liquidity","pool_id":${JSON.stringify(opts.poolId)},"lp_burn":${lpBurn}}`
  return signPlExact({
    account: opts.account,
    destination: '',
    amountDigits: '0',
    sequence: opts.sequence,
    fee: opts.fee ?? 2,
    networkId: opts.networkId ?? DEFAULT_NETWORK_ID,
    bodyJson,
    body: { kind: 'remove_liquidity', pool_id: opts.poolId, lp_burn: lpBurn },
    falconSecret: opts.falconSecret,
  })
}

export async function signPlLend(opts: {
  account: string
  kind: 'lend_supply' | 'lend_withdraw' | 'lend_borrow' | 'lend_repay'
  marketId: string
  amount: string
  collateralFpl?: string
  sequence: number
  fee?: number
  networkId?: number
  falconSecret: string
}): Promise<SignedPlTx> {
  const amount = u64Digits(opts.amount, 'amount')
  const id = JSON.stringify(opts.marketId)
  let bodyJson: string
  let body: Record<string, unknown>
  if (opts.kind === 'lend_withdraw') {
    bodyJson = `{"kind":"lend_withdraw","market_id":${id},"shares":${amount}}`
    body = { kind: opts.kind, market_id: opts.marketId, shares: amount }
  } else if (opts.kind === 'lend_borrow') {
    const col = u64Digits(opts.collateralFpl ?? '0', 'collateral')
    bodyJson = `{"kind":"lend_borrow","market_id":${id},"amount":${amount},"collateral_fpl":${col}}`
    body = { kind: opts.kind, market_id: opts.marketId, amount, collateral_fpl: col }
  } else {
    bodyJson = `{"kind":"${opts.kind}","market_id":${id},"amount":${amount}}`
    body = { kind: opts.kind, market_id: opts.marketId, amount }
  }
  return signPlExact({
    account: opts.account,
    destination: '',
    amountDigits: '0',
    sequence: opts.sequence,
    fee: opts.fee ?? 2,
    networkId: opts.networkId ?? DEFAULT_NETWORK_ID,
    bodyJson,
    body,
    falconSecret: opts.falconSecret,
  })
}

/** Send bridged BTC, ETH, or USDC. Amount is the exact ledger integer as digits (sats, wei, or 6-dp USDC). */
export async function signPlAssetPay(opts: {
  account: string
  destination: string
  asset: 'BTC' | 'ETH' | 'USDC'
  amount: string
  sequence: number
  fee?: number
  networkId?: number
  falconSecret: string
}): Promise<SignedPlTx> {
  const amountExact = opts.amount.trim()
  if (!/^[1-9][0-9]*$/.test(amountExact)) {
    throw new Error('Amount must be a positive integer')
  }
  const networkId = opts.networkId ?? DEFAULT_NETWORK_ID
  const fee = opts.fee ?? 2
  const dest = opts.destination
  const bodyJson = `{"kind":"asset_pay","asset":${JSON.stringify(opts.asset)}}`
  const payload = `pl-tx:v2|${opts.account}|${opts.sequence}|${dest}|${amountExact}|${fee}|${networkId}|${bodyJson}`
  const decoded = decodeFalconSecret(opts.falconSecret)
  const publicKey = bytesToHex(decoded.pubBlob.slice(1))
  const falcon = await getFalcon512()
  const msg = new TextEncoder().encode(payload)
  let signature: Uint8Array
  try {
    signature = falcon.sign(msg, decoded.secretKey)
  } finally {
    zeroize(decoded.secretKey)
  }
  const sigHex = bytesToHex(signature)
  const txId = await sha256HexBrowser(payload)
  const rawJson =
    `{"account":${JSON.stringify(opts.account)},"sequence":${opts.sequence},` +
    `"destination":${JSON.stringify(dest)},"amount":${amountExact},"fee":${fee},` +
    `"network_id":${networkId},"public_key":${JSON.stringify(publicKey)},` +
    `"signature":${JSON.stringify(sigHex)},"tx_id":${JSON.stringify(txId)},"body":${bodyJson}}`
  return {
    account: opts.account,
    sequence: opts.sequence,
    destination: dest,
    amount: Number(amountExact),
    fee,
    network_id: networkId,
    public_key: publicKey,
    signature: sigHex,
    tx_id: txId,
    body: { kind: 'asset_pay', asset: opts.asset },
    rawJson,
  }
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
  amount: number | bigint | string
  externalTo: string
  fee?: number
  networkId?: number
  falconSecret: string
  /** Watch/FROST Kickoff hex. Omit on BitVM2 — node rejects signed_btc_tx. */
  signedBtcTx?: string
}): Promise<SignedPlTx> {
  const amountExact = typeof opts.amount === 'bigint' ? opts.amount.toString() : String(opts.amount).split('.')[0]
  if (!/^[1-9][0-9]*$/.test(amountExact)) {
    throw new Error('withdraw amount must be a positive integer')
  }
  const networkId = opts.networkId ?? DEFAULT_NETWORK_ID
  const fee = opts.fee ?? 2
  const dest = opts.externalTo.trim()
  const kickoff = (opts.signedBtcTx || '').trim().toLowerCase()
  if (kickoff && !/^[0-9a-f]+$/.test(kickoff)) {
    throw new Error('signed_btc_tx must be hex')
  }
  const kickoffJson = kickoff ? `,"signed_btc_tx":${JSON.stringify(kickoff)}` : ''
  const bodyJson =
    `{"kind":"rail_withdraw","asset":${JSON.stringify(opts.asset)},` +
    `"amount":${amountExact},"external_to":${JSON.stringify(dest)}${kickoffJson}}`
  const payload = `pl-tx:v2|${opts.account}|${opts.sequence}|${dest}|${amountExact}|${fee}|${networkId}|${bodyJson}`
  const decoded = decodeFalconSecret(opts.falconSecret)
  const publicKey = bytesToHex(decoded.pubBlob.slice(1))
  const falcon = await getFalcon512()
  const msg = new TextEncoder().encode(payload)
  let signature: Uint8Array
  try {
    signature = falcon.sign(msg, decoded.secretKey)
  } finally {
    zeroize(decoded.secretKey)
  }
  const sigHex = bytesToHex(signature)
  const txId = await sha256HexBrowser(payload)
  const rawJson =
    `{"account":${JSON.stringify(opts.account)},"sequence":${opts.sequence},` +
    `"destination":${JSON.stringify(dest)},"amount":${amountExact},"fee":${fee},` +
    `"network_id":${networkId},"public_key":${JSON.stringify(publicKey)},` +
    `"signature":${JSON.stringify(sigHex)},"tx_id":${JSON.stringify(txId)},"body":${bodyJson}}`
  return {
    account: opts.account,
    sequence: opts.sequence,
    destination: dest,
    amount: Number(amountExact),
    fee,
    network_id: networkId,
    public_key: publicKey,
    signature: sigHex,
    tx_id: txId,
    body: {
      kind: 'rail_withdraw',
      asset: opts.asset,
      amount: amountExact,
      external_to: dest,
      ...(kickoff ? { signed_btc_tx: kickoff } : {}),
    },
    rawJson,
  }
}
