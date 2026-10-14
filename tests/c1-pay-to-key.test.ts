import { describe, expect, it } from 'vitest'
import vec from './fixtures/c1-key-vector.json'
import { plKeyCommitHash } from '../src/lib/pl-key-commit-server'
import { isKeyBindRefusal } from '../src/lib/pl-key-commit'
import { addressFromPubBlob, buildPubBlob, hexToBytes } from '../src/lib/falcon-keys'

// Vector produced by fd-pl key_commit_hash / falcon_classic_address (2.9.65).
describe('audit C-1 pay-to-key', () => {
  it('key hash matches the chain', () => {
    expect(plKeyCommitHash(vec.publicKey)).toBe(vec.keyHash)
    expect(plKeyCommitHash('fb' + vec.publicKey)).toBe(vec.keyHash)
    expect(() => plKeyCommitHash('abcd')).toThrow()
  })
  it('classic address matches the chain derivation', () => {
    expect(addressFromPubBlob(buildPubBlob(hexToBytes(vec.publicKey)))).toBe(vec.address)
  })
  it('recognises the node refusal', () => {
    expect(isKeyBindRefusal('key bind: account has no key and this key is not committed')).toBe(true)
    expect(isKeyBindRefusal('bad sequence')).toBe(false)
  })
})
