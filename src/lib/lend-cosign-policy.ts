/**
 * Server-side policy for the testnet broker co-sign of LoanSet (audit M-2).
 * The broker key only signs loans whose terms match the published lending manifest and
 * stay under an operator-set principal cap.
 */

import type { LendingManifest } from '@/lib/lending-config'

export const TF_LOAN_OVERPAYMENT = 0x00010000
const ALLOWED_FLAGS = TF_LOAN_OVERPAYMENT

/** Exactly the fields signLoanSetBorrowerTx produces (plus the borrower's signature). */
export const LOANSET_FIELDS = new Set([
  'TransactionType', 'Account', 'Fee', 'Sequence', 'LastLedgerSequence', 'NetworkID',
  'SigningPubKey', 'TxnSignature', 'LoanBrokerID', 'PrincipalRequested', 'InterestRate',
  'PaymentInterval', 'PaymentTotal', 'GracePeriod', 'Flags', 'Collateral',
])

export interface CosignLimits {
  /** Max principal per loan, in the lending asset's units. */
  maxPrincipal: number
  /** Max fee the borrower can attach, in drops. */
  maxFeeDrops: number
}

export function cosignLimitsFromEnv(env: Record<string, string | undefined>): CosignLimits {
  const p = Number(env.LEND_COSIGN_MAX_PRINCIPAL ?? '1000')
  const f = Number(env.LEND_COSIGN_MAX_FEE_DROPS ?? '1000')
  return {
    maxPrincipal: Number.isFinite(p) && p > 0 ? p : 1000,
    maxFeeDrops: Number.isFinite(f) && f > 0 ? f : 1000,
  }
}

export type PolicyResult = { ok: true; tx: Record<string, unknown> } | { ok: false; error: string }

const DECIMAL = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,15})?$/
const UINT = /^(?:0|[1-9]\d{0,18})$/
const HEX64 = /^[0-9A-F]{64}$/
const R_ADDR = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/

function intField(v: unknown): number | null {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return v
  if (typeof v === 'string' && UINT.test(v) && Number.isSafeInteger(Number(v))) return Number(v)
  return null
}

export function checkLoanSet(
  raw: unknown,
  manifest: LendingManifest,
  networkId: number,
  limits: CosignLimits,
): PolicyResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'tx_json required' }
  const t = raw as Record<string, unknown>
  if (t.TransactionType !== 'LoanSet') return { ok: false, error: 'Only LoanSet co-sign supported' }
  for (const k of Object.keys(t)) {
    if (!LOANSET_FIELDS.has(k)) return { ok: false, error: `Field not allowed: ${k}` }
  }
  if (typeof t.Account !== 'string' || !R_ADDR.test(t.Account)) return { ok: false, error: 'Invalid Account' }
  if (t.Account === manifest.broker_owner) return { ok: false, error: 'Broker cannot borrow from itself' }
  if (String(t.LoanBrokerID ?? '').toUpperCase() !== manifest.loan_broker_id.toUpperCase() || !HEX64.test(String(t.LoanBrokerID).toUpperCase())) {
    return { ok: false, error: 'LoanBrokerID does not match testnet manifest' }
  }
  if (intField(t.NetworkID) !== networkId) return { ok: false, error: 'NetworkID mismatch' }

  const principal = typeof t.PrincipalRequested === 'string' || typeof t.PrincipalRequested === 'number' ? String(t.PrincipalRequested) : ''
  if (!DECIMAL.test(principal) || !(Number(principal) > 0)) return { ok: false, error: 'Invalid PrincipalRequested' }
  if (Number(principal) > limits.maxPrincipal) return { ok: false, error: `Principal above co-sign limit (${limits.maxPrincipal})` }

  if (intField(t.InterestRate) !== manifest.interest_rate_tenth_bps) return { ok: false, error: 'InterestRate must match the manifest' }
  if (intField(t.PaymentTotal) !== manifest.payment_total) return { ok: false, error: 'PaymentTotal must match the manifest' }
  if (intField(t.GracePeriod) !== manifest.grace_period) return { ok: false, error: 'GracePeriod must match the manifest' }

  const epoch = manifest.epoch_duration_seconds ?? manifest.payment_interval
  const maxEpochs = manifest.epochs_per_year ?? 52
  const interval = intField(t.PaymentInterval)
  if (interval === null || interval < epoch || interval % epoch !== 0 || interval / epoch > maxEpochs) {
    return { ok: false, error: 'PaymentInterval must be 1..N whole epochs' }
  }

  const flags = intField(t.Flags ?? 0)
  if (flags === null || (flags & ~ALLOWED_FLAGS) !== 0) return { ok: false, error: 'Flags not allowed' }

  if (t.Collateral !== undefined) {
    const c = intField(t.Collateral)
    if (c === null || c <= 0) return { ok: false, error: 'Invalid Collateral' }
  }
  const fee = intField(t.Fee)
  if (fee === null || fee > limits.maxFeeDrops) return { ok: false, error: 'Invalid Fee' }
  if (intField(t.Sequence) === null || intField(t.LastLedgerSequence) === null) return { ok: false, error: 'Invalid Sequence' }
  if (typeof t.SigningPubKey !== 'string' || !/^[0-9A-Fa-f]{66,1800}$/.test(t.SigningPubKey)) {
    return { ok: false, error: 'Invalid SigningPubKey' }
  }
  if (t.TxnSignature !== undefined && (typeof t.TxnSignature !== 'string' || !/^[0-9A-Fa-f]{2,4000}$/.test(t.TxnSignature))) {
    return { ok: false, error: 'Invalid TxnSignature' }
  }
  return { ok: true, tx: { ...t } }
}
