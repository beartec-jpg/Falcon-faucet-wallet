import { createHash } from 'crypto'
import { createFalcon512 } from '@openforge-sh/liboqs/sig'
import { isValidClassicAddress } from 'ripple-address-codec'
import {
  FALCON512_PREFIX,
  FALCON512_PUB_RAW,
  addressFromPubBlob,
  hexToBytes,
} from './falcon-keys'
import { BOARD_MESSAGE_VERSION } from './board-constants'

export {
  BOARD_MESSAGE_VERSION,
  BOARD_BODY_MAX,
  BOARD_CHALLENGE_TTL_SEC,
  BOARD_POSTS_PER_HOUR,
} from './board-constants'

export function isValidBoardAddress(address: string): boolean {
  return isValidClassicAddress(address)
}

export function normalizeBoardBody(body: string): string {
  return body.replace(/\r\n/g, '\n').trim()
}

export function bodySha256(body: string): string {
  return createHash('sha256').update(normalizeBoardBody(body), 'utf8').digest('hex')
}

export function buildBoardSignMessage(opts: {
  author: string
  nonce: string
  expires: number
  parentId: string | null
  body: string
}): string {
  const parent = opts.parentId ?? ''
  return [
    BOARD_MESSAGE_VERSION,
    'action:post',
    `author:${opts.author}`,
    `parent_id:${parent}`,
    `body_sha256:${bodySha256(opts.body)}`,
    `expires:${opts.expires}`,
    `nonce:${opts.nonce}`,
  ].join('\n')
}

export async function verifyBoardSignature(
  message: string,
  signatureHex: string,
  publicKeyBlobHex: string,
  expectedAddress: string,
): Promise<boolean> {
  let pubBlob: Uint8Array
  let signature: Uint8Array
  try {
    pubBlob = hexToBytes(publicKeyBlobHex)
    signature = hexToBytes(signatureHex)
  } catch {
    return false
  }

  if (pubBlob.length !== 1 + FALCON512_PUB_RAW) return false
  if (pubBlob[0] !== FALCON512_PREFIX) return false

  const address = addressFromPubBlob(pubBlob)
  if (address !== expectedAddress) return false

  const rawPub = pubBlob.slice(1)
  const msgBytes = new TextEncoder().encode(message)

  const falcon = await createFalcon512()
  try {
    return falcon.verify(msgBytes, signature, rawPub)
  } finally {
    falcon.destroy()
  }
}