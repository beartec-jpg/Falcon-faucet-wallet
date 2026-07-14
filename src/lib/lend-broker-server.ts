/** Server-side broker owner signing + submission (testnet). */

import { proxySign } from '@/lib/signer-proxy'
import { loadLendingManifestServer } from '@/lib/lending-config'
import { getNetwork } from '@/lib/networks'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'
import type { LoanManageAction } from '@/lib/lend-loan-manage'
import { loanManageFlags } from '@/lib/lend-loan-manage'

export function brokerSecret(): string | null {
  return process.env.TESTNET_LENDING_BROKER_SECRET?.trim() || null
}

export async function brokerSequence(
  networkKey: ReturnType<typeof resolveNetworkKey>,
  brokerOwner: string,
): Promise<{ sequence: number; ledgerIndex: number }> {
  const info = await serverRpcCall<{ account_data: { Sequence: number } }>(
    networkKey,
    'account_info',
    { account: brokerOwner, ledger_index: 'validated' },
  )
  const ledger = await serverRpcCall<{ ledger_index: number }>(networkKey, 'ledger', {
    ledger_index: 'validated',
  })
  return { sequence: info.account_data.Sequence, ledgerIndex: ledger.ledger_index }
}

export async function signAndSubmitLoanManage(
  networkKey: ReturnType<typeof resolveNetworkKey>,
  loanId: string,
  action: LoanManageAction,
): Promise<{ success: boolean; hash?: string; result: string; message?: string }> {
  if (networkKey !== 'testnet') {
    throw new Error('LoanManage only available on testnet')
  }
  const secret = brokerSecret()
  if (!secret) {
    throw new Error('TESTNET_LENDING_BROKER_SECRET not configured')
  }
  const manifest = await loadLendingManifestServer()
  if (!manifest?.broker_owner) {
    throw new Error('Lending manifest broker_owner missing')
  }

  const { sequence, ledgerIndex } = await brokerSequence(networkKey, manifest.broker_owner)
  const network = getNetwork(networkKey)
  const tx_json: Record<string, unknown> = {
    TransactionType: 'LoanManage',
    Account: manifest.broker_owner,
    LoanID: loanId.toUpperCase(),
    Flags: loanManageFlags(action),
    Sequence: sequence,
    Fee: '12',
    LastLedgerSequence: ledgerIndex + 20,
  }

  const signed = await proxySign(tx_json, secret, { networkId: network.networkId })
  const result = await serverRpcCall<{
    engine_result: string
    engine_result_message?: string
    tx_json?: { hash?: string }
  }>(networkKey, 'submit', { tx_blob: signed.tx_blob })

  return {
    success: result.engine_result === 'tesSUCCESS',
    hash: result.tx_json?.hash,
    result: result.engine_result,
    message: result.engine_result_message,
  }
}