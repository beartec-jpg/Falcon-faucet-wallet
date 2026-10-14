import { describe, expect, it } from 'vitest'
import { checkLoanSet, cosignLimitsFromEnv, TF_LOAN_OVERPAYMENT } from '@/lib/lend-cosign-policy'
import manifest from '../public/config/lending.json'
import { TF_LOAN_OVERPAYMENT as CLIENT_FLAG } from '@/lib/falcon-lend-tx-sign'

const NID = 1001
const limits = cosignLimitsFromEnv({})
const good = () => ({
  TransactionType: 'LoanSet',
  Account: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
  Fee: '24',
  Sequence: 5,
  LastLedgerSequence: 100,
  NetworkID: NID,
  SigningPubKey: 'FB' + '00'.repeat(897),
  TxnSignature: 'AB'.repeat(600),
  LoanBrokerID: manifest.loan_broker_id,
  PrincipalRequested: '250',
  InterestRate: manifest.interest_rate_tenth_bps,
  PaymentInterval: manifest.payment_interval * 4,
  PaymentTotal: manifest.payment_total,
  GracePeriod: manifest.grace_period,
  Flags: TF_LOAN_OVERPAYMENT,
  Collateral: '1000000',
})
const check = (t: unknown) => checkLoanSet(t, manifest as any, NID, limits)

describe('M-2 LoanSet co-sign policy', () => {
  it('flag constant matches the client', () => expect(TF_LOAN_OVERPAYMENT).toBe(CLIENT_FLAG))
  it('accepts what the app builds', () => expect(check(good()).ok).toBe(true))
  it.each([
    ['principal over cap', { PrincipalRequested: '1000.01' }],
    ['zero principal', { PrincipalRequested: '0' }],
    ['negative principal', { PrincipalRequested: '-5' }],
    ['exponent principal', { PrincipalRequested: '1e9' }],
    ['interest rate below manifest', { InterestRate: 0 }],
    ['different installments', { PaymentTotal: 999 }],
    ['grace period changed', { GracePeriod: 10_000_000 }],
    ['interval not whole epochs', { PaymentInterval: 1000 }],
    ['interval over a year', { PaymentInterval: manifest.payment_interval * 53 }],
    ['unknown flag', { Flags: 0x1 }],
    ['wrong broker', { LoanBrokerID: 'A'.repeat(64) }],
    ['wrong network', { NetworkID: 2300 }],
    ['broker borrowing from itself', { Account: manifest.broker_owner }],
    ['huge fee', { Fee: '100000000' }],
    ['zero collateral', { Collateral: '0' }],
    ['extra field', { Destination: 'rXYZ' }],
    ['other tx type', { TransactionType: 'Payment' }],
  ])('rejects %s', (_n, patch) => {
    expect(check({ ...good(), ...patch }).ok).toBe(false)
  })
  it('principal cap is configurable', () => {
    const l = cosignLimitsFromEnv({ LEND_COSIGN_MAX_PRINCIPAL: '10' })
    expect(checkLoanSet(good(), manifest as any, NID, l).ok).toBe(false)
  })
})
