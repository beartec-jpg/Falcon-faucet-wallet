/**
 * Client-side Falcon message signing for the message board.
 * falcon_secret never leaves the device.
 */

import { decodeFalconSecret, bytesToHex, addressFromPubBlob } from './falcon-keys'
import { getFalcon512 } from './falcon-wasm'

export async function signBoardMessage(
  message: string,
  falcon_secret: string,
): Promise<{ signature: string; publicKey: string; address: string }> {
  const decoded = decodeFalconSecret(falcon_secret)
  const falcon = await getFalcon512()
  const msgBytes = new TextEncoder().encode(message)
  const signature = falcon.sign(msgBytes, decoded.secretKey)

  return {
    signature: bytesToHex(signature).toUpperCase(),
    publicKey: bytesToHex(decoded.pubBlob).toUpperCase(),
    address: addressFromPubBlob(decoded.pubBlob),
  }
}