/**
 * Client-side XRPL transaction signing using ripple-keypairs + ripple-binary-codec.
 *
 * These packages are pure JavaScript and browser-compatible, unlike the full
 * xrpl package which is server-only in this Next.js app.
 *
 * Sign flow:
 *  1. Build TX JSON with SigningPubKey set, TxnSignature empty
 *  2. encodeForSigning() → canonical bytes
 *  3. sign(bytes, privateKey) → DER/hex signature
 *  4. encode({ ...tx, TxnSignature: sig }) → final tx_blob hex
 */

const NETWORK_ID     = parseInt(process.env.NEXT_PUBLIC_NETWORK_ID ?? '999', 10)
const DROPS_PER_QXRP = 1_000_000
const BASE_FEE       = '12'

export function qxrpToDrops(qxrp: number): string {
  return String(Math.round(qxrp * DROPS_PER_QXRP))
}

export interface WalletKeys {
  address:    string
  publicKey:  string
  privateKey: string
}

export interface PaymentParams {
  account:              string
  destination:          string
  amountDrops:          string
  sequence:             number
  lastLedgerSequence:   number
  fee?:                 string
}

export interface SignedTx {
  tx_blob: string
}

// ─── Key derivation from seed ─────────────────────────────────────────────────

export async function keysFromSeed(seed: string): Promise<WalletKeys> {
  const keypairs = await import('ripple-keypairs')
  const { privateKey, publicKey } = keypairs.deriveKeypair(seed)
  const address = keypairs.deriveAddress(publicKey)
  return { address, publicKey, privateKey }
}

export async function generateWallet(): Promise<{ seed: string } & WalletKeys> {
  const keypairs = await import('ripple-keypairs')
  const seed     = keypairs.generateSeed()
  const keys     = await keysFromSeed(seed)
  return { seed, ...keys }
}

// ─── TX signing ───────────────────────────────────────────────────────────────

export async function signPayment(
  params: PaymentParams,
  seed: string
): Promise<SignedTx> {
  const [keypairs, codec] = await Promise.all([
    import('ripple-keypairs'),
    import('ripple-binary-codec'),
  ])

  const { privateKey, publicKey } = keypairs.deriveKeypair(seed)
  const { fee = BASE_FEE, account, destination, amountDrops, sequence, lastLedgerSequence } = params

  // Build the unsigned TX JSON
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx: Record<string, any> = {
    TransactionType:    'Payment',
    Account:            account,
    Destination:        destination,
    Amount:             amountDrops,
    Fee:                fee,
    Sequence:           sequence,
    LastLedgerSequence: lastLedgerSequence,
    Flags:              0,
    SigningPubKey:       publicKey,
    TxnSignature:       '',
  }

  // NetworkID only included when > 1024 (ripple signing hash prefix rule)
  if (NETWORK_ID > 1024) {
    tx.NetworkID = NETWORK_ID
  }

  // Sign: encodeForSigning produces the bytes the ledger hashes before signing
  const signingBytes = codec.encodeForSigning(tx)
  const signature    = keypairs.sign(signingBytes, privateKey)

  // Encode the complete signed transaction
  const tx_blob = codec.encode({ ...tx, TxnSignature: signature })

  return { tx_blob }
}
