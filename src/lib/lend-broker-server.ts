/** Server-side broker owner signing (testnet) — retired with broker co-sign (audit).
 *
 * `/api/lend/cosign` and `TESTNET_LENDING_BROKER_SECRET` are no longer used.
 * Delete `TESTNET_LENDING_BROKER_SECRET` from Vercel (projects: Production – falconledger,
 * Production – wallet-val). Do not print the secret value.
 */

import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'
import type { LoanManageAction } from '@/lib/lend-loan-manage'

/** Always null — co-sign / broker-owner hot key retired from this app. */
export function brokerSecret(): string | null {
  return null
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
  _loanId: string,
  _action: LoanManageAction,
): Promise<{ success: boolean; hash?: string; result: string; message?: string }> {
  if (networkKey !== 'testnet') {
    throw new Error('LoanManage only available on testnet')
  }
  throw new Error(
    'Broker owner signing retired with co-sign. Delete TESTNET_LENDING_BROKER_SECRET from Vercel.',
  )
}
