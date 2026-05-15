// Offline transaction signing using ripple-keypairs + ripple-binary-codec.
// Avoids importing the full xrpl bundle which crashes in Vercel serverless.

import * as keypairs from 'ripple-keypairs'
import * as binary from 'ripple-binary-codec'
import { createHash } from 'crypto'

const DROPS_PER_QXRP = 1_000_000
const NETWORK_ID = parseInt(process.env.NEXT_PUBLIC_NETWORK_ID ?? '999', 10)
const HASH_PREFIX_SIGNED_TX = 0x54584e00 // 'TXN\x00'

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

  const { privateKey, publicKey } = keypairs.deriveKeypair(secret)

  // Build the transaction object (fields must be in canonical order for codec)
  const tx: Record<string, unknown> = {
    TransactionType: 'Payment',
    Account: from,
    Destination: to,
    Amount: amountDrops,
    Fee: fee,
    Flags: 0,
    Sequence: sequence,
    LastLedgerSequence: lastLedgerSequence,
    SigningPubKey: publicKey,
  }

  if (NETWORK_ID > 1024) {
    tx.NetworkID = NETWORK_ID
  }

  // Encode without signature to get signing payload
  const encoded = binary.encodeForSigning(tx)
  const prefixBuf = Buffer.alloc(4)
  prefixBuf.writeUInt32BE(HASH_PREFIX_SIGNED_TX, 0)
  const toSign = Buffer.concat([prefixBuf, Buffer.from(encoded, 'hex')])

  const signature = keypairs.sign(toSign.toString('hex'), privateKey)
  tx.TxnSignature = signature

  const tx_blob = binary.encode(tx)

  // Transaction hash = SHA512-half of prefix + encoded blob
  const blobBuf = Buffer.from(tx_blob, 'hex')
  const hashInput = Buffer.concat([prefixBuf, blobBuf])
  const hash = createHash('sha512')
    .update(hashInput)
    .digest('hex')
    .slice(0, 64)
    .toUpperCase()

  return { tx_blob, hash }
}
