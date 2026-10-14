/**
 * Cold Signer transaction review (audit H-4).
 *
 * The cold device must show exactly what it signs. Everything shown and signed is derived
 * from tx_json; the hot-supplied `display` block is ignored. Only plain Payment and TrustSet
 * from the vault's own account are accepted, unknown or risky fields are refused, and the fee
 * is capped. The transaction that gets signed is rebuilt from the validated fields only.
 */
import { isValidClassicAddress } from './classic-address'
import { networkIdForTx } from './networks'

/** 0.01 FPL. The portal uses 12 drops; anything far above that is refused. */
export const MAX_FEE_DROPS = 10_000
/** Total FPL supply bound in drops (10^17); rejects absurd native amounts. */
const MAX_NATIVE_DROPS = 10n ** 17n

const COMMON = ['TransactionType', 'Account', 'Fee', 'Sequence', 'LastLedgerSequence', 'Flags', 'SigningPubKey', 'NetworkID']
const ALLOWED: Record<'Payment' | 'TrustSet', string[]> = {
  Payment: [...COMMON, 'Destination', 'Amount'],
  TrustSet: [...COMMON, 'LimitAmount'],
}

export interface IouAmount {
  currency: string
  issuer: string
  value: string
}

export type ReviewedTx =
  | {
      transactionType: 'Payment'
      account: string
      destination: string
      amount: { kind: 'native'; drops: string } | ({ kind: 'iou' } & IouAmount)
      fee: string
      sequence: number
      lastLedgerSequence: number
      networkId: number
      /** Canonical tx_json rebuilt from the validated fields: this is what is signed. */
      tx: Record<string, unknown>
    }
  | {
      transactionType: 'TrustSet'
      account: string
      limit: IouAmount
      fee: string
      sequence: number
      lastLedgerSequence: number
      networkId: number
      tx: Record<string, unknown>
    }

function fail(msg: string): never {
  throw new Error(`Refusing to sign: ${msg}`)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
}

function uint32(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0 || v > 0xffff_ffff) fail(`${name} must be a positive integer`)
  return v
}

function iou(v: unknown, name: string): IouAmount {
  if (!isPlainObject(v)) fail(`${name} must be an issued-currency amount`)
  const keys = Object.keys(v).sort().join(',')
  if (keys !== 'currency,issuer,value') fail(`${name} has unexpected fields`)
  const { currency, issuer, value } = v as Record<string, unknown>
  if (typeof currency !== 'string' || !/^([A-Z0-9]{3}|[0-9A-F]{40})$/.test(currency) || currency === 'XRP') {
    fail(`${name} currency is invalid`)
  }
  if (typeof issuer !== 'string' || !isValidClassicAddress(issuer)) fail(`${name} issuer is invalid`)
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,15})(\.\d{1,15})?$/.test(value) || Number(value) <= 0) {
    fail(`${name} value is invalid`)
  }
  return { currency, issuer, value }
}

/**
 * Validate an unsigned vault package against the vault address. Throws on anything that is not
 * a plain Payment/TrustSet from this vault. `display` is never trusted.
 */
export function reviewUnsignedTx(
  pkg: { networkId?: unknown; tx_json?: unknown },
  vaultAddress: string,
): ReviewedTx {
  const tx = pkg.tx_json
  if (!isPlainObject(tx)) fail('tx_json missing')
  const t = tx.TransactionType
  if (t !== 'Payment' && t !== 'TrustSet') fail(`transaction type ${String(t)} is not allowed`)
  const extra = Object.keys(tx).filter((k) => !ALLOWED[t].includes(k))
  if (extra.length) fail(`unexpected field(s): ${extra.join(', ')}`)

  if (tx.Account !== vaultAddress) fail('transaction account is not this vault')
  if (tx.Flags !== undefined && tx.Flags !== 0) fail('flags are not allowed')
  if (tx.SigningPubKey !== undefined && typeof tx.SigningPubKey !== 'string') fail('SigningPubKey is invalid')

  if (typeof tx.Fee !== 'string' || !/^\d{1,10}$/.test(tx.Fee)) fail('fee is invalid')
  if (Number(tx.Fee) > MAX_FEE_DROPS) fail(`fee ${tx.Fee} drops is above the ${MAX_FEE_DROPS}-drop cap`)
  const sequence = uint32(tx.Sequence, 'Sequence')
  const lastLedgerSequence = uint32(tx.LastLedgerSequence, 'LastLedgerSequence')

  if (typeof pkg.networkId !== 'number' || !Number.isInteger(pkg.networkId) || pkg.networkId < 0) fail('networkId is invalid')
  const wantNetId = networkIdForTx(pkg.networkId)
  if (tx.NetworkID !== wantNetId) fail('NetworkID does not match the package network')

  const base: Record<string, unknown> = {
    TransactionType: t,
    Account: vaultAddress,
    Fee: tx.Fee,
    Sequence: sequence,
    LastLedgerSequence: lastLedgerSequence,
    Flags: 0,
    ...(wantNetId !== undefined ? { NetworkID: wantNetId } : {}),
  }
  const common = { account: vaultAddress, fee: tx.Fee, sequence, lastLedgerSequence, networkId: pkg.networkId }

  if (t === 'Payment') {
    const dest = tx.Destination
    if (typeof dest !== 'string' || !isValidClassicAddress(dest)) fail('destination is not a valid address')
    if (dest === vaultAddress) fail('destination is the vault itself')
    let amount: Extract<ReviewedTx, { transactionType: 'Payment' }>['amount']
    let txAmount: unknown
    if (typeof tx.Amount === 'string') {
      if (!/^[1-9]\d{0,17}$/.test(tx.Amount) || BigInt(tx.Amount) > MAX_NATIVE_DROPS) fail('amount is invalid')
      amount = { kind: 'native', drops: tx.Amount }
      txAmount = tx.Amount
    } else {
      const a = iou(tx.Amount, 'Amount')
      amount = { kind: 'iou', ...a }
      txAmount = { ...a }
    }
    return {
      transactionType: 'Payment',
      ...common,
      destination: dest,
      amount,
      tx: { ...base, Destination: dest, Amount: txAmount },
    }
  }

  const limit = iou(tx.LimitAmount, 'LimitAmount')
  if (limit.issuer === vaultAddress) fail('trust line issuer is the vault itself')
  return { transactionType: 'TrustSet', ...common, limit, tx: { ...base, LimitAmount: { ...limit } } }
}

/** Human label for an issued currency (F-USDC is QUC on Falcon). */
export function currencyLabel(c: string): string {
  return c === 'QUC' ? 'F-USDC' : c
}
