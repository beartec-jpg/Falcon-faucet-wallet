#!/usr/bin/env node
/**
 * Verify client-side Falcon signing matches xrpld acceptance.
 * Run: node scripts/verify-falcon-sign.mjs
 */
import { createFalcon512 } from '@openforge-sh/liboqs/sig'
import { encodeForSigning, encode } from 'ripple-binary-codec'
import { createHash } from 'crypto'
import { encodeAccountID } from 'ripple-address-codec'

const FALCON512_PREFIX = 0xfb
const RPC = process.env.XRPLD_RPC_URL ?? 'http://46.224.0.140:6005'

function addrFromPub(pubBlob) {
  const sha = createHash('sha256').update(pubBlob).digest()
  const accountId = createHash('ripemd160').update(sha).digest()
  return encodeAccountID(accountId)
}

const sig = await createFalcon512()
const { publicKey, secretKey } = sig.generateKeyPair()
const pubBlob = Buffer.alloc(898)
pubBlob[0] = FALCON512_PREFIX
pubBlob.set(publicKey, 1)
const address = addrFromPub(pubBlob)
const signingPubKeyHex = pubBlob.toString('hex').toUpperCase()

const sig2 = await createFalcon512()
const kp2 = sig2.generateKeyPair()
const pub2 = Buffer.alloc(898)
pub2[0] = FALCON512_PREFIX
pub2.set(kp2.publicKey, 1)
const dest = addrFromPub(pub2)
sig2.destroy()

const tx = {
  TransactionType: 'Payment',
  Account: address,
  Destination: dest,
  Amount: '1',
  Fee: '12',
  Sequence: 1,
  LastLedgerSequence: 9_999_999,
  SigningPubKey: signingPubKeyHex,
  Flags: 0,
}

const signingBytes = Buffer.from(encodeForSigning(tx), 'hex')
const signature = sig.sign(new Uint8Array(signingBytes), secretKey)
const ok = sig.verify(signingBytes, signature, publicKey)
const blob = encode({ ...tx, TxnSignature: Buffer.from(signature).toString('hex').toUpperCase() })

const res = await fetch(RPC, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ method: 'submit', params: [{ tx_blob: blob }] }),
})
const out = await res.json()
const result = out.result?.engine_result

console.log(JSON.stringify({ verify: ok, submit: result, address }, null, 2))
if (!ok) process.exit(1)
if (result !== 'terNO_ACCOUNT') {
  console.error('Expected terNO_ACCOUNT (valid sig, unfunded account)')
  process.exit(1)
}
sig.destroy()