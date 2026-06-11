/**
 * Falcon wallet client for the qXRP Falcon testnet.
 *
 * Falcon keys cannot be signed in the browser — wallet_propose and signing
 * are delegated to server routes that call the node1 signing proxy.
 */

const NETWORK_ID     = parseInt(process.env.NEXT_PUBLIC_NETWORK_ID ?? '1001', 10)
const DROPS_PER_QXRP = 1_000_000
const BASE_FEE       = '12'

export function qxrpToDrops(qxrp: number): string {
  return String(Math.round(qxrp * DROPS_PER_QXRP))
}

export interface WalletKeys {
  address:       string
  publicKey:     string
  falcon_secret: string
}

export interface PaymentParams {
  account:              string
  destination:          string
  amountDrops:          string
  sequence:             number
  lastLedgerSequence:   number
  fee?:                 string
}

export interface SignedTx {
  tx_blob: string
  hash?:   string
}

// ─── Wallet creation ──────────────────────────────────────────────────────────

export async function generateWallet(): Promise<WalletKeys> {
  const res = await fetch('/api/wallet/propose', { method: 'POST' })
  const data = await res.json()
  if (!res.ok || data.error) {
    throw new Error(data.error ?? 'Wallet creation failed')
  }
  return {
    address:       data.address,
    publicKey:     data.publicKey,
    falcon_secret: data.falcon_secret,
  }
}

/** Validate a stored falcon_secret by checking format (no local derivation). */
export function validateFalconSecret(secret: string): boolean {
  return /^[0-9A-Fa-f]{800,}$/.test(secret.trim())
}

/** Derive address + public key prefix from falcon_secret via server. */
export async function keysFromFalconSecret(
  falcon_secret: string,
): Promise<{ address: string; publicKey: string }> {
  const res = await fetch('/api/wallet/derive', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ falcon_secret }),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    throw new Error(data.error ?? 'Could not derive address from Falcon secret')
  }
  return { address: data.address, publicKey: data.publicKey }
}

// ─── TX signing (via server + signing proxy) ──────────────────────────────────

async function signTx(
  txFields: Record<string, unknown>,
  falcon_secret: string,
  sequence: number,
  lastLedgerSequence: number,
  fee = BASE_FEE,
): Promise<SignedTx> {
  const tx_json: Record<string, unknown> = {
    ...txFields,
    Fee:                fee,
    Sequence:           sequence,
    LastLedgerSequence: lastLedgerSequence,
    Flags:              txFields.Flags ?? 0,
  }
  if (NETWORK_ID > 1024) tx_json.NetworkID = NETWORK_ID

  const res = await fetch('/api/wallet/sign', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ tx_json, falcon_secret }),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    throw new Error(data.error ?? 'Signing failed')
  }
  return { tx_blob: data.tx_blob, hash: data.hash }
}

export async function signPayment(
  params: PaymentParams,
  falcon_secret: string,
): Promise<SignedTx> {
  const { fee = BASE_FEE, account, destination, amountDrops, sequence, lastLedgerSequence } = params
  return signTx(
    {
      TransactionType: 'Payment',
      Account:         account,
      Destination:     destination,
      Amount:          amountDrops,
    },
    falcon_secret,
    sequence,
    lastLedgerSequence,
    fee,
  )
}

// ─── TrustSet ─────────────────────────────────────────────────────────────────

export interface TrustSetParams {
  account:            string
  currency:           string
  issuer:             string
  limit:              string
  sequence:           number
  lastLedgerSequence: number
  fee?:               string
}

export async function signTrustSet(
  params: TrustSetParams,
  falcon_secret: string,
): Promise<SignedTx> {
  return signTx(
    {
      TransactionType: 'TrustSet',
      Account:         params.account,
      LimitAmount: {
        currency: params.currency,
        issuer:   params.issuer,
        value:    params.limit,
      },
    },
    falcon_secret,
    params.sequence,
    params.lastLedgerSequence,
    params.fee,
  )
}

// ─── OfferCreate ──────────────────────────────────────────────────────────────

export type XrpAmount  = string
export type IouAmount  = { currency: string; issuer: string; value: string }
export type XrplAmount = XrpAmount | IouAmount

export interface OfferCreateParams {
  account:            string
  takerGets:          XrplAmount
  takerPays:          XrplAmount
  sequence:           number
  lastLedgerSequence: number
  fee?:               string
  flags?:             number
}

export const TF_IMMEDIATE_OR_CANCEL = 0x00020000

export async function signOfferCreate(
  params: OfferCreateParams,
  falcon_secret: string,
): Promise<SignedTx> {
  return signTx(
    {
      TransactionType: 'OfferCreate',
      Account:         params.account,
      TakerGets:       params.takerGets,
      TakerPays:       params.takerPays,
      Flags:           params.flags ?? TF_IMMEDIATE_OR_CANCEL,
    },
    falcon_secret,
    params.sequence,
    params.lastLedgerSequence,
    params.fee,
  )
}