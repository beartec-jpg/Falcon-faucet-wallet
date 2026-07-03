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
