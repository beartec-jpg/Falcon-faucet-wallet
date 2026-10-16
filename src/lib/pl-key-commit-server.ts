/**
 * Audit C-1 (Falcon PL 2.9.65): the PayToKey commitment is sha256 of the raw
 * 897-byte Falcon-512 public key, lowercase hex. A 0xFB-prefixed blob hashes
 * the same as the raw key (matches fd-pl `key_commit_hash`). Server only.
 */
import { createHash } from 'crypto'

export function plKeyCommitHash(publicKeyHex: string): string {
  let raw = Buffer.from(publicKeyHex.trim(), 'hex')
  if (raw.length === 898 && raw[0] === 0xfb) raw = raw.subarray(1)
  if (raw.length !== 897) throw new Error('Invalid Falcon public key')
  return createHash('sha256').update(raw).digest('hex')
}
