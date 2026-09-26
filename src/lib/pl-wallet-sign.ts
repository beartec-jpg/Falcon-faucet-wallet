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
  amountIn: number
  minOut: number
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
    body: {
      kind: 'swap_route',
      token_in: opts.tokenIn,
      token_out: opts.tokenOut,
      amount_in: Math.floor(opts.amountIn),
      min_out: Math.floor(opts.minOut),
    },
    falconSecret: opts.falconSecret,
  })
}

export async function signPlAddLiquidity(opts: {
  account: string
  poolId: string
  amtA: number
  amtB: number
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
    body: {
      kind: 'add_liquidity',
      pool_id: opts.poolId,
      amt_a: Math.floor(opts.amtA),
      amt_b: Math.floor(opts.amtB),
    },
    falconSecret: opts.falconSecret,
  })
}

export async function signPlRemoveLiquidity(opts: {
  account: string
  poolId: string
  lpBurn: number
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
    body: {
      kind: 'remove_liquidity',
      pool_id: opts.poolId,
      lp_burn: Math.floor(opts.lpBurn),
    },
    falconSecret: opts.falconSecret,
  })
}

export async function signPlLend(opts: {
  account: string
  kind: 'lend_supply' | 'lend_withdraw' | 'lend_borrow' | 'lend_repay'
  marketId: string
  amount: number
  collateralFpl?: number
  sequence: number
  fee?: number
  networkId?: number
  falconSecret: string
}): Promise<SignedPlTx> {
  const body: Record<string, unknown> =
    opts.kind === 'lend_withdraw'
      ? { kind: opts.kind, market_id: opts.marketId, shares: Math.floor(opts.amount) }
      : opts.kind === 'lend_borrow'
        ? {
            kind: opts.kind,
            market_id: opts.marketId,
            amount: Math.floor(opts.amount),
            collateral_fpl: Math.floor(opts.collateralFpl ?? 0),
          }
        : { kind: opts.kind, market_id: opts.marketId, amount: Math.floor(opts.amount) }
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
