// Transaction signing for qXRP (XRPL fork with Falcon post-quantum signatures).
//
// qXRP requires FalconPublicKey + FalconSignature fields on every transaction
// (featureProofOfParticipation amendment). The only way to produce these from
// outside the node binary is via the signing proxy, which forwards to the
// node's admin RPC (127.0.0.1:5005) which adds the Falcon fields.
//
// SIGNER_PROXY_URL must be set; offline signing is kept as a build-time safety
// net but will produce invalidTransaction on qXRP mainnet/testnet.

import * as keypairs from 'ripple-keypairs'
import * as binary from 'ripple-binary-codec'
import { createHash } from 'crypto'

const DROPS_PER_QXRP = 1_000_000
const NETWORK_ID = parseInt(process.env.NEXT_PUBLIC_NETWORK_ID ?? '999', 10)
const HASH_PREFIX_SIGNED_TX = 0x54584e00 // 'TXN\x00'

// Signing proxy config (server-side env vars only)
const PROXY_URL   = process.env.SIGNER_PROXY_URL
const PROXY_TOKEN = process.env.SIGNER_PROXY_TOKEN

export function dropsFromQxrp(qxrp: number): string {
  return (Math.round(qxrp) * DROPS_PER_QXRP).toString()
}

export interface SignedPayment {
  tx_blob: string
  hash: string
}

/**
 * Sign a Payment transaction.
 * Prefers the signing proxy (required for Falcon fields on qXRP).
 * Falls back to offline ripple-keypairs signing only when proxy is unavailable.
 */
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

  // ── Proxy signing (adds FalconPublicKey + FalconSignature) ────────────────
  if (PROXY_URL) {
    const tx_json: Record<string, unknown> = {
      TransactionType: 'Payment',
      Account: from,
      Destination: to,
      Amount: amountDrops,
      Fee: fee,
      Flags: 0,
      Sequence: sequence,
      LastLedgerSequence: lastLedgerSequence,
      // NetworkID only required for networks with ID > 1024; qXRP is 999
      ...(NETWORK_ID > 1024 ? { NetworkID: NETWORK_ID } : {}),
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (PROXY_TOKEN) headers['Authorization'] = `Bearer ${PROXY_TOKEN}`

    const res = await fetch(`${PROXY_URL}/sign`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tx_json, secret }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Signing proxy error ${res.status}: ${text}`)
    }

    const data = await res.json() as { tx_blob: string; hash: string }
    return { tx_blob: data.tx_blob, hash: data.hash }
  }

  // ── Offline fallback (no Falcon fields — will fail on live qXRP) ──────────
  console.warn('[xrpl-sign] SIGNER_PROXY_URL not set — using offline signing (no Falcon fields)')

  const { privateKey, publicKey } = keypairs.deriveKeypair(secret)

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

  const encoded = binary.encodeForSigning(tx)
  const prefixBuf = Buffer.alloc(4)
  prefixBuf.writeUInt32BE(HASH_PREFIX_SIGNED_TX, 0)
  const toSign = Buffer.concat([prefixBuf, Buffer.from(encoded, 'hex')])

  const signature = keypairs.sign(toSign.toString('hex'), privateKey)
  tx.TxnSignature = signature

  const tx_blob = binary.encode(tx)

  const blobBuf = Buffer.from(tx_blob, 'hex')
  const hashInput = Buffer.concat([prefixBuf, blobBuf])
  const hash = createHash('sha512')
    .update(hashInput)
    .digest('hex')
    .slice(0, 64)
    .toUpperCase()

  return { tx_blob, hash }
}
