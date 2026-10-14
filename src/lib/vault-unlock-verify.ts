/**
 * Verify vault unlock responses on the hot portal (Falcon-512).
 */

import { getFalcon512 } from './falcon-wasm'
import { FALCON512_PREFIX, FALCON512_PUB_RAW, hexToBytes } from './falcon-keys'
import {
  buildUnlockMessage,
  type VaultUnlockChallenge,
  type VaultUnlockResponse,
  unlockResponseSigBytes,
} from './vault-protocol'

/** Extract raw 897-byte Falcon public key from hex pub blob (with 0xFB prefix). */
export function rawPubFromPublicKeyHex(publicKeyHex: string): Uint8Array {
  const blob = hexToBytes(publicKeyHex)
  if (blob.length === FALCON512_PUB_RAW) return blob
  if (blob.length === 1 + FALCON512_PUB_RAW && blob[0] === FALCON512_PREFIX) {
    return blob.slice(1)
  }
  throw new Error('Invalid vault public key length')
}

const USED_KEY = 'falcon-vault-used-challenges-v1'
const usedMem = new Set<string>()

function loadUsed(): Set<string> {
  const out = new Set(usedMem)
  try {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(USED_KEY) : null
    if (raw) for (const c of JSON.parse(raw) as string[]) out.add(c)
  } catch {
    /* ignore */
  }
  return out
}

function markUsed(challenge: string): void {
  usedMem.add(challenge)
  try {
    if (typeof sessionStorage === 'undefined') return
    const list = [...loadUsed()].slice(-200)
    sessionStorage.setItem(USED_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

export function isChallengeUsed(challenge: string): boolean {
  return loadUsed().has(challenge)
}

/**
 * Verify cold unlock response against the challenge we issued and the vault's public key.
 * Each challenge is single-use: once a response verifies, the same challenge is refused.
 */
export async function verifyUnlockResponse(
  challenge: VaultUnlockChallenge,
  response: VaultUnlockResponse,
  publicKeyHex: string,
): Promise<boolean> {
  if (response.address !== challenge.address) return false
  if (response.challenge !== challenge.challenge) return false
  if (response.expiresAt !== challenge.expiresAt) return false
  if (Date.now() > challenge.expiresAt) return false
  if (isChallengeUsed(challenge.challenge)) return false

  const msg = buildUnlockMessage({
    address: response.address,
    challenge: response.challenge,
    expiresAt: response.expiresAt,
  })
  const sig = unlockResponseSigBytes(response)
  const pub = rawPubFromPublicKeyHex(publicKeyHex)
  const falcon = await getFalcon512()
  // Re-check after the await so two concurrent verifications cannot both pass.
  if (isChallengeUsed(challenge.challenge)) return false
  const ok = falcon.verify(msg, sig, pub)
  if (ok) markUsed(challenge.challenge)
  return ok
}
