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
  signPaymentSwapTx,
  signTrustSetTx,
  signOfferCreateTx,
  signOfferCancelTx,
  signAmmCreateTx,
  signAmmDepositTx,
  signAmmWithdrawTx,
  signBridgeWithdrawTx,
  signFusdcPaymentTx,
  signClaimRewardTx,
  TF_TWO_ASSET,
  TF_LP_TOKEN,
  TF_WITHDRAW_ALL,
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
  networkId: number
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

export interface PaymentSwapParams {
  account: string
  destination: string
  amount: XrplAmount
  sendMax: XrplAmount
  deliverMin?: XrplAmount
  sequence: number
  lastLedgerSequence: number
  networkId: number
  fee?: string
}

/** Cross-currency self-payment — routes through on-ledger AMM (mainnet-style). */
export async function signPaymentSwap(
  params: PaymentSwapParams,
  falcon_secret: string,
): Promise<SignedTx> {
  const { tx_blob } = await signPaymentSwapTx(params, falcon_secret)
  return { tx_blob }
}

export interface TrustSetParams {
  account: string
  currency: string
  issuer: string
  limit: string
  sequence: number
  lastLedgerSequence: number
  networkId: number
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
  networkId: number
  fee?: string
  flags?: number
}

export const TF_IMMEDIATE_OR_CANCEL = 0x00020000
/** Maker-only: rest on the book without crossing existing bids/asks (opt-in). */
export const TF_PASSIVE = 0x00010000

export interface ClaimRewardParams {
  account: string
  consensusKeyHex: string
  sequence: number
  lastLedgerSequence: number
  networkId: number
  fee?: string
}

/** Falcon-512 consensus public key hex (898-byte blob) from falcon_secret. */
export function consensusKeyFromSecret(falcon_secret: string): string {
  const { publicKey } = keysFromFalconSecret(falcon_secret)
  return publicKey
}

export async function signClaimReward(
  params: ClaimRewardParams,
  falcon_secret: string,
): Promise<SignedTx> {
  const { tx_blob } = await signClaimRewardTx(params, falcon_secret)
  return { tx_blob }
}

export async function signOfferCreate(
  params: OfferCreateParams,
  falcon_secret: string,
): Promise<SignedTx> {
  const { tx_blob } = await signOfferCreateTx(params, falcon_secret)
  return { tx_blob }
}

export interface OfferCancelParams {
  account: string
  offerSequence: number
  sequence: number
  lastLedgerSequence: number
  networkId: number
  fee?: string
}

export async function signOfferCancel(
  params: OfferCancelParams,
  falcon_secret: string,
): Promise<SignedTx> {
  const { tx_blob } = await signOfferCancelTx(params, falcon_secret)
  return { tx_blob }
}

export { TF_TWO_ASSET }

export interface AmmCreateParams {
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
}

export async function signAmmCreate(
  params: AmmCreateParams,
  falcon_secret: string,
): Promise<SignedTx> {
  const { tx_blob } = await signAmmCreateTx(params, falcon_secret)
  return { tx_blob }
}

export interface AmmDepositParams {
  account: string
  currency: string
  issuer: string
  amountXrpDrops: string
  amountToken: string
  sequence: number
  lastLedgerSequence: number
  networkId: number
  fee?: string
}

export async function signAmmDeposit(
  params: AmmDepositParams,
  falcon_secret: string,
): Promise<SignedTx> {
  const { tx_blob } = await signAmmDepositTx(params, falcon_secret)
  return { tx_blob }
}

export { TF_LP_TOKEN, TF_WITHDRAW_ALL }

export interface AmmWithdrawParams {
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
}

export async function signAmmWithdraw(
  params: AmmWithdrawParams,
  falcon_secret: string,
): Promise<SignedTx> {
  const { tx_blob } = await signAmmWithdrawTx(params, falcon_secret)
  return { tx_blob }
}

export interface BridgeWithdrawParams {
  account: string
  issuer: string
  currency: string
  amount: string
  sepoliaRecipient: string
  sequence: number
  lastLedgerSequence: number
  networkId: number
  fee?: string
}

export async function signBridgeWithdraw(
  params: BridgeWithdrawParams,
  falcon_secret: string,
): Promise<SignedTx> {
  const { tx_blob } = await signBridgeWithdrawTx(params, falcon_secret)
  return { tx_blob }
}

export interface FusdcPaymentParams {
  account: string
  destination: string
  issuer: string
  currency: string
  amount: string
  sequence: number
  lastLedgerSequence: number
  networkId: number
  fee?: string
}

export async function signFusdcPayment(
  params: FusdcPaymentParams,
  falcon_secret: string,
): Promise<SignedTx> {
  const { tx_blob } = await signFusdcPaymentTx(params, falcon_secret)
  return { tx_blob }
}

export const WALLET_BASE_FEE = BASE_FEE