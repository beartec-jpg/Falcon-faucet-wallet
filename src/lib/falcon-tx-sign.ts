/**
 * Client-side Falcon transaction signing for Falcon Ledger.
 * falcon_secret never leaves the device.
 */

import { encode, encodeForSigning } from 'ripple-binary-codec'
import { getFalconCodecDefinitions } from './falcon-codec-definitions'
import {
  decodeFalconSecret,
  hexToBytes,
  bytesToHex,
  zeroize,
  type DecodedFalconSecret,
} from './falcon-keys'
import { getFalcon512 } from './falcon-wasm'
import type { XrplAmount } from './xrpl-amount'
import {
  BRIDGE_BTC_WITHDRAW_MEMO_TYPE,
  BRIDGE_WITHDRAW_MEMO_TYPE,
  utf8ToMemoHex,
} from './bridge-memo'

import { networkIdForTx } from '@/lib/networks'

const BASE_FEE = '12'
/** AMMCreate base fee = one owner reserve (not the normal 12-drop increment). */
export const AMM_CREATE_FEE_DROPS = '2000000'

interface TxCore {
  TransactionType: string
  Account: string
  Fee: string
  Sequence: number
  LastLedgerSequence: number
  Flags: number
  SigningPubKey: string
  NetworkID?: number
}

function withNetwork<T extends Record<string, unknown>>(
  tx: T,
  networkId: number,
): T & { NetworkID?: number } {
  const id = networkIdForTx(networkId)
  if (id !== undefined) return { ...tx, NetworkID: id }
  return tx
}

export async function signPrepared(
  tx: TxCore & Record<string, unknown>,
  decoded: DecodedFalconSecret,
): Promise<string> {
  const definitions = getFalconCodecDefinitions()
  const signingHex = encodeForSigning(tx, definitions)
  const signingBytes = hexToBytes(signingHex)

  const falcon = await getFalcon512()
  const signature = falcon.sign(signingBytes, decoded.secretKey)

  try {
    const signed = {
      ...tx,
      TxnSignature: bytesToHex(signature).toUpperCase(),
    }
    return encode(signed, definitions)
  } finally {
    zeroize(decoded.secretKey)
  }
}

export function baseTx(
  account: string,
  sequence: number,
  lastLedgerSequence: number,
  publicKeyHex: string,
  networkId: number,
  fee = BASE_FEE,
): TxCore {
  return withNetwork(
    {
      TransactionType: '',
      Account: account,
      Fee: fee,
      Sequence: sequence,
      LastLedgerSequence: lastLedgerSequence,
      Flags: 0,
      SigningPubKey: publicKeyHex,
    },
    networkId,
  ) as TxCore
}

/** Build unsigned native FALCON Payment tx_json (no secret). Hot + vault cold path. */
export function buildPaymentTxJson(params: {
  account: string
  destination: string
  amountDrops: string
  sequence: number
  lastLedgerSequence: number
  networkId: number
  /** Hex SigningPubKey (Falcon pub blob including 0xFB prefix). */
  publicKeyHex: string
  fee?: string
}): TxCore & Record<string, unknown> {
  return {
    ...baseTx(
      params.account,
      params.sequence,
      params.lastLedgerSequence,
      params.publicKeyHex,
      params.networkId,
      params.fee,
    ),
    TransactionType: 'Payment',
    Destination: params.destination,
    Amount: params.amountDrops,
  }
}

/** Build unsigned F-USDC (IOU) Payment tx_json (no secret). Hot + vault cold path. */
export function buildFusdcPaymentTxJson(params: {
  account: string
  destination: string
  issuer: string
  currency: string
  amount: string
  sequence: number
  lastLedgerSequence: number
  networkId: number
  publicKeyHex: string
  fee?: string
}): TxCore & Record<string, unknown> {
  return {
    ...baseTx(
      params.account,
      params.sequence,
      params.lastLedgerSequence,
      params.publicKeyHex,
      params.networkId,
      params.fee,
    ),
    TransactionType: 'Payment',
    Destination: params.destination,
    Amount: {
      currency: params.currency,
      issuer: params.issuer,
      value: params.amount,
    },
  }
}

/**
 * Sign a previously built tx_json (vault cold path).
 * Mutates a copy only — does not trust display fields from the package.
 */
export async function signTxJson(
  tx_json: Record<string, unknown>,
  falcon_secret: string,
): Promise<string> {
  const decoded = decodeFalconSecret(falcon_secret)
  try {
    const tx = { ...tx_json } as TxCore & Record<string, unknown>
    // Ensure SigningPubKey matches secret
    tx.SigningPubKey = decoded.publicKeyHex
    return await signPrepared(tx, decoded)
  } finally {
    // signPrepared zeroizes secretKey; decoded.secretKey already wiped
  }
}

export async function signPaymentTx(
  params: {
    account: string
    destination: string
    amountDrops: string
    sequence: number
    lastLedgerSequence: number
    networkId: number
    fee?: string
  },
  falcon_secret: string,
): Promise<{ tx_blob: string }> {
  const decoded = decodeFalconSecret(falcon_secret)
  const tx = buildPaymentTxJson({
    ...params,
    publicKeyHex: decoded.publicKeyHex,
  })
  return { tx_blob: await signPrepared(tx, decoded) }
}

/** Send F-USDC (IOU) to any Falcon address — no bridge memo. */
export async function signFusdcPaymentTx(
  params: {
    account: string
    destination: string
    issuer: string
    currency: string
    amount: string
    sequence: number
    lastLedgerSequence: number
    networkId: number
    fee?: string
  },
  falcon_secret: string,
): Promise<{ tx_blob: string }> {
  const decoded = decodeFalconSecret(falcon_secret)
  const tx = buildFusdcPaymentTxJson({
    ...params,
    publicKeyHex: decoded.publicKeyHex,
  })
  return { tx_blob: await signPrepared(tx, decoded) }
}

/** Return F-USDC to bridge issuer; memo tags Sepolia release recipient. */
export async function signBridgeWithdrawTx(
  params: {
    account: string
    issuer: string
    currency: string
    amount: string
    sepoliaRecipient: string
    sequence: number
    lastLedgerSequence: number
    networkId: number
    fee?: string
  },
  falcon_secret: string,
): Promise<{ tx_blob: string }> {
  const evm = params.sepoliaRecipient.trim().toLowerCase()
  if (!/^0x[a-f0-9]{40}$/.test(evm)) {
    throw new Error('Invalid Sepolia recipient address')
  }
  const decoded = decodeFalconSecret(falcon_secret)
  const tx = {
    ...baseTx(
      params.account,
      params.sequence,
      params.lastLedgerSequence,
      decoded.publicKeyHex,
      params.networkId,
      params.fee,
    ),
    TransactionType: 'Payment',
    Destination: params.issuer,
    Amount: {
      currency: params.currency,
      issuer: params.issuer,
      value: params.amount,
    },
    Memos: [
      {
        Memo: {
          MemoType: utf8ToMemoHex(BRIDGE_WITHDRAW_MEMO_TYPE),
          MemoData: utf8ToMemoHex(evm),
        },
      },
    ],
  }
  return { tx_blob: await signPrepared(tx, decoded) }
}

/**
 * Custodial FBTC bridge-out: return BTC IOU to issuer; memo tags multi-chain
 * BTC P2PKH address for custody payout (pre–SPV light-client path).
 */
export async function signFbtcBridgeWithdrawTx(
  params: {
    account: string
    issuer: string
    /** IOU currency code on Falcon — usually "BTC" */
    currency: string
    amount: string
    btcRecipient: string
    sequence: number
    lastLedgerSequence: number
    networkId: number
    fee?: string
  },
  falcon_secret: string,
): Promise<{ tx_blob: string }> {
  const btc = params.btcRecipient.trim()
  // testnet m/n… or mainnet 1…
  if (!/^[mn2][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(btc) && !/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(btc)) {
    throw new Error('Invalid Bitcoin P2PKH address for bridge-out')
  }
  const decoded = decodeFalconSecret(falcon_secret)
  const tx = {
    ...baseTx(
      params.account,
      params.sequence,
      params.lastLedgerSequence,
      decoded.publicKeyHex,
      params.networkId,
      params.fee,
    ),
    TransactionType: 'Payment',
    Destination: params.issuer,
    Amount: {
      currency: params.currency,
      issuer: params.issuer,
      value: params.amount,
    },
    Memos: [
      {
        Memo: {
          MemoType: utf8ToMemoHex(BRIDGE_BTC_WITHDRAW_MEMO_TYPE),
          MemoData: utf8ToMemoHex(btc),
        },
      },
    ],
  }
  return { tx_blob: await signPrepared(tx, decoded) }
}

/** tfPartialPayment — allow cross-currency path through AMM with DeliverMin. */
export const TF_PARTIAL_PAYMENT = 0x00020000

export async function signPaymentSwapTx(
  params: {
    account: string
    destination: string
    amount: XrplAmount
    sendMax: XrplAmount
    deliverMin?: XrplAmount
    sequence: number
    lastLedgerSequence: number
    networkId: number
    fee?: string
  },
  falcon_secret: string,
): Promise<{ tx_blob: string }> {
  const decoded = decodeFalconSecret(falcon_secret)
  const core = baseTx(
    params.account,
    params.sequence,
    params.lastLedgerSequence,
    decoded.publicKeyHex,
    params.networkId,
    params.fee,
  )
  const tx: Record<string, unknown> = {
    ...core,
    TransactionType: 'Payment',
    Destination: params.destination,
    Amount: params.amount,
    SendMax: params.sendMax,
    Flags: params.deliverMin ? TF_PARTIAL_PAYMENT : 0,
  }
  if (params.deliverMin) tx.DeliverMin = params.deliverMin
  return { tx_blob: await signPrepared(tx as TxCore & Record<string, unknown>, decoded) }
}

/** Build unsigned TrustSet tx_json (no secret). Hot + vault cold path. */
export function buildTrustSetTxJson(params: {
  account: string
  currency: string
  issuer: string
  limit: string
  sequence: number
  lastLedgerSequence: number
  networkId: number
  publicKeyHex: string
  fee?: string
}): TxCore & Record<string, unknown> {
  return {
    ...baseTx(
      params.account,
      params.sequence,
      params.lastLedgerSequence,
      params.publicKeyHex,
      params.networkId,
      params.fee,
    ),
    TransactionType: 'TrustSet',
    LimitAmount: {
      currency: params.currency,
      issuer: params.issuer,
      value: params.limit,
    },
  }
}

export async function signTrustSetTx(
  params: {
    account: string
    currency: string
    issuer: string
    limit: string
    sequence: number
    lastLedgerSequence: number
    networkId: number
    fee?: string
  },
  falcon_secret: string,
): Promise<{ tx_blob: string }> {
  const decoded = decodeFalconSecret(falcon_secret)
  const tx = buildTrustSetTxJson({
    ...params,
    publicKeyHex: decoded.publicKeyHex,
  })
  return { tx_blob: await signPrepared(tx, decoded) }
}

export async function signClaimRewardTx(
  params: {
    account: string
    consensusKeyHex: string
    sequence: number
    lastLedgerSequence: number
    networkId: number
    fee?: string
  },
  falcon_secret: string,
): Promise<{ tx_blob: string }> {
  const decoded = decodeFalconSecret(falcon_secret)
  const tx = {
    ...baseTx(
      params.account,
      params.sequence,
      params.lastLedgerSequence,
      decoded.publicKeyHex,
      params.networkId,
      params.fee,
    ),
    TransactionType: 'ClaimReward',
    ConsensusKey: params.consensusKeyHex.toUpperCase(),
  }
  return { tx_blob: await signPrepared(tx, decoded) }
}

/** UTF-8 name → uppercase hex for VL/Blob sfName field. */
export function nameStringToHex(name: string): string {
  const bytes = new TextEncoder().encode(name)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/** Claim a human-readable name (locks 100 FALCON bond). Requires AccountNames amendment. */
export async function signNameSetTx(
  params: {
    account: string
    /** Already-normalized lowercase name (3–32, a-z0-9.) */
    name: string
    sequence: number
    lastLedgerSequence: number
    networkId: number
    fee?: string
  },
  falcon_secret: string,
): Promise<{ tx_blob: string }> {
  const decoded = decodeFalconSecret(falcon_secret)
  const tx = {
    ...baseTx(
      params.account,
      params.sequence,
      params.lastLedgerSequence,
      decoded.publicKeyHex,
      params.networkId,
      params.fee,
    ),
    TransactionType: 'NameSet',
    Name: nameStringToHex(params.name),
  }
  return { tx_blob: await signPrepared(tx, decoded) }
}

/** Start name release cooldown (1 epoch). */
export async function signNameUnbondTx(
  params: {
    account: string
    name?: string
    sequence: number
    lastLedgerSequence: number
    networkId: number
    fee?: string
  },
  falcon_secret: string,
): Promise<{ tx_blob: string }> {
  const decoded = decodeFalconSecret(falcon_secret)
  const tx: Record<string, unknown> = {
    ...baseTx(
      params.account,
      params.sequence,
      params.lastLedgerSequence,
      decoded.publicKeyHex,
      params.networkId,
      params.fee,
    ),
    TransactionType: 'NameUnbond',
  }
  if (params.name) tx.Name = nameStringToHex(params.name)
  return { tx_blob: await signPrepared(tx as TxCore & Record<string, unknown>, decoded) }
}

export async function signOfferCreateTx(
  params: {
    account: string
    takerGets: XrplAmount
    takerPays: XrplAmount
    sequence: number
    lastLedgerSequence: number
    networkId: number
    fee?: string
    flags?: number
  },
  falcon_secret: string,
): Promise<{ tx_blob: string }> {
  const decoded = decodeFalconSecret(falcon_secret)
  const core = baseTx(
    params.account,
    params.sequence,
    params.lastLedgerSequence,
    decoded.publicKeyHex,
    params.networkId,
    params.fee,
  )
  const tx = {
    ...core,
    TransactionType: 'OfferCreate',
    TakerGets: params.takerGets,
    TakerPays: params.takerPays,
    Flags: params.flags ?? 0,
  }
  return { tx_blob: await signPrepared(tx, decoded) }
}

export async function signOfferCancelTx(
  params: {
    account: string
    offerSequence: number
    sequence: number
    lastLedgerSequence: number
    networkId: number
    fee?: string
  },
  falcon_secret: string,
): Promise<{ tx_blob: string }> {
  const decoded = decodeFalconSecret(falcon_secret)
  const tx = {
    ...baseTx(
      params.account,
      params.sequence,
      params.lastLedgerSequence,
      decoded.publicKeyHex,
      params.networkId,
      params.fee,
    ),
    TransactionType: 'OfferCancel',
    OfferSequence: params.offerSequence,
  }
  return { tx_blob: await signPrepared(tx, decoded) }
}

/** tfTwoAsset — deposit both pool assets (XLS-30). */
export const TF_TWO_ASSET = 0x00100000
/** tfLPToken — burn LP tokens for proportional withdraw. */
export const TF_LP_TOKEN = 0x00010000
/** tfWithdrawAll — redeem entire LP balance. */
export const TF_WITHDRAW_ALL = 0x00020000

/** IOU or SPV-MPT side of an AMM pair (Amount2 / Asset2). */
function ammTokenSide(params: {
  currency: string
  issuer: string
  amountToken: string
  mptIssuanceId?: string
}): {
  asset2: Record<string, string>
  amount2: Record<string, string>
} {
  if (params.mptIssuanceId) {
    const id = params.mptIssuanceId.replace(/^0x/i, '').toUpperCase()
    // MPT amount is integer units (sats for SPV FBTC)
    return {
      asset2: { mpt_issuance_id: id },
      amount2: { mpt_issuance_id: id, value: params.amountToken },
    }
  }
  return {
    asset2: { currency: params.currency, issuer: params.issuer },
    amount2: { currency: params.currency, issuer: params.issuer, value: params.amountToken },
  }
}

export async function signAmmCreateTx(
  params: {
    account: string
    currency: string
    issuer: string
    amountXrpDrops: string
    amountToken: string
    /** SPV FBTC etc. — integer token units (sats), not human BTC */
    mptIssuanceId?: string
    tradingFee?: number
    sequence: number
    lastLedgerSequence: number
    networkId: number
    fee?: string
  },
  falcon_secret: string,
): Promise<{ tx_blob: string }> {
  const decoded = decodeFalconSecret(falcon_secret)
  const core = baseTx(
    params.account,
    params.sequence,
    params.lastLedgerSequence,
    decoded.publicKeyHex,
    params.networkId,
    params.fee ?? AMM_CREATE_FEE_DROPS,
  )
  const { amount2 } = ammTokenSide(params)
  const tx = {
    ...core,
    TransactionType: 'AMMCreate',
    Amount: params.amountXrpDrops,
    Amount2: amount2,
    TradingFee: params.tradingFee ?? 500,
  }
  return { tx_blob: await signPrepared(tx, decoded) }
}

export async function signAmmDepositTx(
  params: {
    account: string
    currency: string
    issuer: string
    amountXrpDrops: string
    amountToken: string
    mptIssuanceId?: string
    sequence: number
    lastLedgerSequence: number
    networkId: number
    fee?: string
  },
  falcon_secret: string,
): Promise<{ tx_blob: string }> {
  const decoded = decodeFalconSecret(falcon_secret)
  const core = baseTx(
    params.account,
    params.sequence,
    params.lastLedgerSequence,
    decoded.publicKeyHex,
    params.networkId,
    params.fee,
  )
  const { asset2, amount2 } = ammTokenSide(params)
  const tx = {
    ...core,
    TransactionType: 'AMMDeposit',
    Asset: { currency: 'XRP' },
    Asset2: asset2,
    Amount: params.amountXrpDrops,
    Amount2: amount2,
    Flags: TF_TWO_ASSET,
  }
  return { tx_blob: await signPrepared(tx, decoded) }
}

export async function signAmmWithdrawTx(
  params: {
    account: string
    currency: string
    issuer: string
    mptIssuanceId?: string
    lpTokenCurrency: string
    lpTokenIssuer: string
    lpTokenAmount: string
    withdrawAll?: boolean
    sequence: number
    lastLedgerSequence: number
    networkId: number
    fee?: string
  },
  falcon_secret: string,
): Promise<{ tx_blob: string }> {
  const decoded = decodeFalconSecret(falcon_secret)
  const core = baseTx(
    params.account,
    params.sequence,
    params.lastLedgerSequence,
    decoded.publicKeyHex,
    params.networkId,
    params.fee,
  )
  // tfLPToken and tfWithdrawAll are mutually exclusive on ledger — burn full balance via LPTokenIn.
  const flags = TF_LP_TOKEN
  const asset2 = params.mptIssuanceId
    ? { mpt_issuance_id: params.mptIssuanceId.replace(/^0x/i, '').toUpperCase() }
    : { currency: params.currency, issuer: params.issuer }
  const tx = {
    ...core,
    TransactionType: 'AMMWithdraw',
    Asset: { currency: 'XRP' },
    Asset2: asset2,
    LPTokenIn: {
      currency: params.lpTokenCurrency,
      issuer: params.lpTokenIssuer,
      value: params.lpTokenAmount,
    },
    Flags: flags,
  }
  return { tx_blob: await signPrepared(tx, decoded) }
}
