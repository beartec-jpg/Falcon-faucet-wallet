/**
 * Client-side Falcon transaction signing for Falcon Ledger.
 * falcon_secret never leaves the device.
 */

import { encode, encodeForSigning } from 'ripple-binary-codec'
import {
  decodeFalconSecret,
  hexToBytes,
  bytesToHex,
  zeroize,
  type DecodedFalconSecret,
} from './falcon-keys'
import { getFalcon512 } from './falcon-wasm'
import type { XrplAmount } from './wallet-sign-client'
import { BRIDGE_WITHDRAW_MEMO_TYPE, utf8ToMemoHex } from './bridge-memo'

import { networkIdForTx } from '@/lib/networks'

const BASE_FEE = '12'

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

async function signPrepared(
  tx: TxCore & Record<string, unknown>,
  decoded: DecodedFalconSecret,
): Promise<string> {
  const signingHex = encodeForSigning(tx)
  const signingBytes = hexToBytes(signingHex)

  const falcon = await getFalcon512()
  const signature = falcon.sign(signingBytes, decoded.secretKey)

  try {
    const signed = {
      ...tx,
      TxnSignature: bytesToHex(signature).toUpperCase(),
    }
    return encode(signed)
  } finally {
    zeroize(decoded.secretKey)
  }
}

function baseTx(
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
    Destination: params.destination,
    Amount: params.amountDrops,
  }
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
    Destination: params.destination,
    Amount: {
      currency: params.currency,
      issuer: params.issuer,
      value: params.amount,
    },
  }
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
  const tx = {
    ...baseTx(
      params.account,
      params.sequence,
      params.lastLedgerSequence,
      decoded.publicKeyHex,
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
    Flags: params.flags ?? 0x00020000,
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

export async function signAmmCreateTx(
  params: {
    account: string
    currency: string
    issuer: string
    amountXrpDrops: string
    amountToken: string
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
    params.fee,
  )
  const tx = {
    ...core,
    TransactionType: 'AMMCreate',
    Amount: params.amountXrpDrops,
    Amount2: { currency: params.currency, issuer: params.issuer, value: params.amountToken },
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
  const tx = {
    ...core,
    TransactionType: 'AMMDeposit',
    Asset: { currency: 'XRP' },
    Asset2: { currency: params.currency, issuer: params.issuer },
    Amount: params.amountXrpDrops,
    Amount2: { currency: params.currency, issuer: params.issuer, value: params.amountToken },
    Flags: TF_TWO_ASSET,
  }
  return { tx_blob: await signPrepared(tx, decoded) }
}

export async function signAmmWithdrawTx(
  params: {
    account: string
    currency: string
    issuer: string
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
  const tx = {
    ...core,
    TransactionType: 'AMMWithdraw',
    Asset: { currency: 'XRP' },
    Asset2: { currency: params.currency, issuer: params.issuer },
    LPTokenIn: {
      currency: params.lpTokenCurrency,
      issuer: params.lpTokenIssuer,
      value: params.lpTokenAmount,
    },
    Flags: flags,
  }
  return { tx_blob: await signPrepared(tx, decoded) }
}
