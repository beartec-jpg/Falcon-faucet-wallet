/**
 * Lending transaction signing — isolated from wallet bundle (uses ripple-binary-codec decode).
 */

import { decode } from 'ripple-binary-codec'
import { getFalconCodecDefinitions } from './falcon-codec-definitions'
import { decodeFalconSecret } from './falcon-keys'
import { baseTx, signPrepared } from './falcon-tx-sign'

/** tfLoanOverpayment — allow early repayment without close fee. */
export const TF_LOAN_OVERPAYMENT = 0x00010000

export async function signVaultDepositTx(
  params: {
    account: string
    vaultId: string
    currency: string
    issuer: string
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
    TransactionType: 'VaultDeposit',
    VaultID: params.vaultId.toUpperCase(),
    Amount: { currency: params.currency, issuer: params.issuer, value: params.amount },
  }
  return { tx_blob: await signPrepared(tx, decoded) }
}

export async function signVaultWithdrawTx(
  params: {
    account: string
    vaultId: string
    currency: string
    issuer: string
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
    TransactionType: 'VaultWithdraw',
    VaultID: params.vaultId.toUpperCase(),
    Amount: { currency: params.currency, issuer: params.issuer, value: params.amount },
  }
  return { tx_blob: await signPrepared(tx, decoded) }
}

export async function signClaimLPRewardTx(
  params: {
    account: string
    vaultId: string
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
    TransactionType: 'ClaimLPReward',
    VaultID: params.vaultId.toUpperCase(),
  }
  return { tx_blob: await signPrepared(tx, decoded) }
}

export async function signLoanSetBorrowerTx(
  params: {
    account: string
    loanBrokerId: string
    principalRequested: string
    interestRateTenthBps: number
    paymentInterval: number
    paymentTotal: number
    gracePeriod: number
    sequence: number
    lastLedgerSequence: number
    networkId: number
    fee?: string
  },
  falcon_secret: string,
): Promise<{ tx_blob: string; tx_json: Record<string, unknown> }> {
  const decoded = decodeFalconSecret(falcon_secret)
  const tx = {
    ...baseTx(
      params.account,
      params.sequence,
      params.lastLedgerSequence,
      decoded.publicKeyHex,
      params.networkId,
      params.fee ?? '24',
    ),
    TransactionType: 'LoanSet',
    LoanBrokerID: params.loanBrokerId.toUpperCase(),
    PrincipalRequested: params.principalRequested,
    InterestRate: params.interestRateTenthBps,
    PaymentInterval: params.paymentInterval,
    PaymentTotal: params.paymentTotal,
    GracePeriod: params.gracePeriod,
    Flags: TF_LOAN_OVERPAYMENT,
  }
  const tx_blob = await signPrepared(tx, decoded)
  const tx_json = decode(tx_blob, getFalconCodecDefinitions()) as Record<string, unknown>
  return { tx_blob, tx_json }
}

export async function signLoanPayTx(
  params: {
    account: string
    loanId: string
    currency: string
    issuer: string
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
    TransactionType: 'LoanPay',
    LoanID: params.loanId.toUpperCase(),
    Amount: { currency: params.currency, issuer: params.issuer, value: params.amount },
  }
  return { tx_blob: await signPrepared(tx, decoded) }
}