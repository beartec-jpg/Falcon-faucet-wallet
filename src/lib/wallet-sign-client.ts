/**
 * Falcon wallet client for the Falcon Ledger testnet.
 *
 * Key generation and signing run entirely in the browser via WASM (liboqs).
 * falcon_secret is never sent to any server.
 */

import {
  buildPubBlob,
  encodeFalconSecret,
  addressFromPubBlob,
  bytesToHex,
  keysFromFalconSecret,
  validateFalconSecret,
  zeroize,
} from './falcon-keys'
import { getFalcon512 } from './falcon-wasm'
import {
  signPaymentTx,
  signTrustSetTx,
  signOfferCreateTx,
} from './falcon-tx-sign'

export { validateFalconSecret, keysFromFalconSecret }

const DROPS_PER_QXRP = 1_000_000
const BASE_FEE = '12'

export function qxrpToDrops(qxrp: number): string {
  return String(Math.round(qxrp * DROPS_PER_QXRP))
}

export interface WalletKeys {
  address: string
  publicKey: string
  falcon_secret: string
}

export interface PaymentParams {
  account: string
  destination: string
  amountDrops: string
  sequence: number
  lastLedgerSequence: number
  fee?: string
}

export interface SignedTx {
  tx_blob: string
  hash?: string
}

// ─── Wallet creation (client-side WASM) ───────────────────────────────────────

export async function generateWallet(): Promise<WalletKeys> {
  const falcon = await getFalcon512()
  const { publicKey, secretKey } = falcon.generateKeyPair()

  const pubBlob = buildPubBlob(publicKey)
  const falcon_secret = encodeFalconSecret(pubBlob, secretKey)
  zeroize(secretKey)

  return {
    address: addressFromPubBlob(pubBlob),
    publicKey: bytesToHex(pubBlob).toUpperCase(),
    falcon_secret,
  }
}

// ─── TX signing (client-side WASM) ──────────────────────────────────────────

export async function signPayment(
  params: PaymentParams,
  falcon_secret: string,
): Promise<SignedTx> {
  const { tx_blob } = await signPaymentTx(params, falcon_secret)
  return { tx_blob }
}

export interface TrustSetParams {
  account: string
  currency: string
  issuer: string
  limit: string
  sequence: number
  lastLedgerSequence: number
  fee?: string
}

export async function signTrustSet(
  params: TrustSetParams,
  falcon_secret: string,
): Promise<SignedTx> {
  const { tx_blob } = await signTrustSetTx(params, falcon_secret)
  return { tx_blob }
}

export type XrpAmount = string
export type IouAmount = { currency: string; issuer: string; value: string }
export type XrplAmount = XrpAmount | IouAmount

export interface OfferCreateParams {
  account: string
  takerGets: XrplAmount
  takerPays: XrplAmount
  sequence: number
  lastLedgerSequence: number
  fee?: string
  flags?: number
}

export const TF_IMMEDIATE_OR_CANCEL = 0x00020000

export async function signOfferCreate(
  params: OfferCreateParams,
  falcon_secret: string,
): Promise<SignedTx> {
  const { tx_blob } = await signOfferCreateTx(params, falcon_secret)
  return { tx_blob }
}

export const WALLET_BASE_FEE = BASE_FEE