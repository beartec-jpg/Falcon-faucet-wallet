import { createHash } from 'crypto'
import { encodeAccountID } from 'ripple-address-codec'

const FALCON512_PUB_HEX_LEN = 1796 // 898-byte on-wire public key blob

/** Derive classic r-address from a falcon_secret hex bundle. */
export function addressFromFalconSecret(falconSecret: string): string {
  const hex = falconSecret.trim()
  if (hex.length < FALCON512_PUB_HEX_LEN) {
    throw new Error('falcon_secret too short')
  }
  const pubBlob = Buffer.from(hex.slice(0, FALCON512_PUB_HEX_LEN), 'hex')
  const sha = createHash('sha256').update(pubBlob).digest()
  const accountId = createHash('ripemd160').update(sha).digest()
  return encodeAccountID(accountId)
}