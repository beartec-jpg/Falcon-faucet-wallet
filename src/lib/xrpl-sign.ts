// Transaction signing via the node1 signing proxy (Falcon or classic seed).

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
  networkId: number
  fee?: string
  proxyUrl?: string
  proxyToken?: string
}): Promise<SignedPayment> {
  const { from, secret, to, amountDrops, sequence, lastLedgerSequence, networkId, fee = '12', proxyUrl, proxyToken } = opts

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
    { networkId, proxyUrl, proxyToken },
  )

  return { tx_blob: signed.tx_blob, hash: signed.hash ?? '' }
}