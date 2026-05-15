// Offline transaction signing for qXRP payments using xrpl.js
// No WebSocket connection needed — signs locally and submits via HTTP RPC.

import { Wallet } from 'xrpl'
import type { Payment, Transaction } from 'xrpl'

const DROPS_PER_QXRP = 1_000_000
const NETWORK_ID = parseInt(process.env.NEXT_PUBLIC_NETWORK_ID ?? '999', 10)

export function dropsFromQxrp(qxrp: number): string {
  return (Math.round(qxrp) * DROPS_PER_QXRP).toString()
}

export interface SignedPayment {
  tx_blob: string
  hash: string
}

export function signPayment(opts: {
  from: string
  secret: string
  to: string
  amountDrops: string
  sequence: number
  lastLedgerSequence: number
  fee?: string
}): SignedPayment {
  const { from, secret, to, amountDrops, sequence, lastLedgerSequence, fee = '12' } = opts

  const wallet = Wallet.fromSeed(secret)

  const tx: Payment & { NetworkID?: number } = {
    TransactionType: 'Payment',
    Account: from,
    Destination: to,
    Amount: amountDrops,
    Fee: fee,
    Sequence: sequence,
    LastLedgerSequence: lastLedgerSequence,
    Flags: 0,
  }

  // NetworkID in transaction (for chains where NetworkID > 1024 xrpl.js adds
  // it to the signing hash; for ID ≤ 1024 it is informational only but still
  // valid to include so nodes can reject cross-network replays).
  if (NETWORK_ID > 1024) {
    tx.NetworkID = NETWORK_ID
  }

  const { tx_blob, hash } = wallet.sign(tx as Transaction)
  return { tx_blob, hash }
}
