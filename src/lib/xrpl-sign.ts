// Falcon transaction signing via the node1 signing proxy.

import { proxySign } from '@/lib/signer-proxy'

const DROPS_PER_QXRP = 1_000_000n

export function dropsFromQxrp(qxrp: number): string {
  return (BigInt(Math.round(qxrp)) * DROPS_PER_QXRP).toString()
}

export interface SignedPayment {
  tx_blob: string
  hash: string
}

export async function signPayment(opts: {
  from: string
  secret: string
  to: string
  amountDrops: string
  sequence: number
  lastLedgerSequence: number
  fee?: string
}): Promise<SignedPayment> {
  const { from, secret, to, amountDrops, sequence, lastLedgerSequence, fee = '12' } = opts

  const signed = await proxySign(
    {
      TransactionType: 'Payment',
      Account: from,
      Destination: to,
      Amount: amountDrops,
      Fee: fee,
      Sequence: sequence,
      LastLedgerSequence: lastLedgerSequence,
      Flags: 0,
    },
    secret,
  )

  return { tx_blob: signed.tx_blob, hash: signed.hash ?? '' }
}