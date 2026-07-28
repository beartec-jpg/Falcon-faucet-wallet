/**
 * Native Bitcoin deposit keys for multi-chain wallet.
 * CSPRNG secp256k1 + P2PKH addresses (mainnet 1… / testnet m|n…).
 * Stored encrypted in the same passkey vault + falcon-backup JSON.
 */

import { Wallet, hexlify } from 'ethers'
import { sha256 } from '@noble/hashes/sha2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { authenticatePasskey } from '@/lib/passkey'
import { encryptSeed, type EncryptedSeed } from '@/lib/wallet-crypto'
import { loadPrimaryWallet, saveWallet, type StoredWallet } from '@/lib/wallet-store'

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/i, '')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

function base58Encode(bytes: Uint8Array): string {
  let zeros = 0
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++
  const digits = [0]
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8
      digits[j] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }
  let str = ''
  for (let i = 0; i < zeros; i++) str += '1'
  for (let i = digits.length - 1; i >= 0; i--) str += B58[digits[i]]
  return str
}

/** P2PKH from compressed pubkey hex (0x02/03…). */
export function btcP2pkhFromCompressedPub(compressedPubHex: string, network: 'mainnet' | 'testnet'): string {
  const pub = hexToBytes(compressedPubHex)
  const h160 = ripemd160(sha256(pub))
  const versioned = new Uint8Array(21)
  versioned[0] = network === 'testnet' ? 0x6f : 0x00
  versioned.set(h160, 1)
  const checksum = sha256(sha256(versioned)).slice(0, 4)
  const full = new Uint8Array(25)
  full.set(versioned)
  full.set(checksum, 21)
  return base58Encode(full)
}

export function createRandomBtcWallet(): {
  privateKeyHex: string
  addressMainnet: string
  addressTestnet: string
} {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const wallet = new Wallet(hexlify(bytes))
  const privateKeyHex = wallet.privateKey.startsWith('0x')
    ? wallet.privateKey.slice(2)
    : wallet.privateKey
  const pub = wallet.signingKey.compressedPublicKey
  return {
    privateKeyHex,
    addressMainnet: btcP2pkhFromCompressedPub(pub, 'mainnet'),
    addressTestnet: btcP2pkhFromCompressedPub(pub, 'testnet'),
  }
}

export function hasBtcWallet(wallet: Pick<StoredWallet, 'btcAddress' | 'btcEncrypted'>): boolean {
  return !!(wallet.btcAddress && wallet.btcEncrypted)
}

export async function encryptBtcKeyForPasskey(
  privateKeyHex: string,
  keyBytes: Uint8Array,
  hasPrf: boolean,
): Promise<{ address: string; addressMainnet: string; btcEncrypted: EncryptedSeed }> {
  const pk = privateKeyHex.replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(pk)) throw new Error('Invalid Bitcoin private key')
  const wallet = new Wallet(`0x${pk}`)
  const pub = wallet.signingKey.compressedPublicKey
  const btcEncrypted = await encryptSeed(pk, keyBytes, hasPrf)
  return {
    address: btcP2pkhFromCompressedPub(pub, 'testnet'),
    addressMainnet: btcP2pkhFromCompressedPub(pub, 'mainnet'),
    btcEncrypted,
  }
}

export async function createBtcWalletForPasskey(
  keyBytes: Uint8Array,
  hasPrf: boolean,
): Promise<{ address: string; addressMainnet: string; privateKeyHex: string; btcEncrypted: EncryptedSeed }> {
  const { privateKeyHex, addressMainnet, addressTestnet } = createRandomBtcWallet()
  const btcEncrypted = await encryptSeed(privateKeyHex, keyBytes, hasPrf)
  return {
    address: addressTestnet,
    addressMainnet,
    privateKeyHex,
    btcEncrypted,
  }
}

/** Add BTC deposit keys to an existing Falcon wallet (passkey prompt). */
export async function provisionBtcWalletForStoredWallet(wallet: StoredWallet): Promise<StoredWallet> {
  if (hasBtcWallet(wallet)) return wallet
  const { keyBytes, hasPrf } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
  const btc = await createBtcWalletForPasskey(keyBytes, hasPrf)
  const updated: StoredWallet = {
    ...wallet,
    btcAddress: btc.address,
    btcAddressMainnet: btc.addressMainnet,
    btcEncrypted: btc.btcEncrypted,
  }
  await saveWallet(updated)
  const reloaded = await loadPrimaryWallet()
  if (!reloaded || !hasBtcWallet(reloaded)) {
    throw new Error('Bitcoin wallet could not be saved — try again in this browser tab')
  }
  return reloaded
}

/** Provision EVM + BTC for multi-chain (idempotent). */
export async function provisionMultiChainWallets(wallet: StoredWallet): Promise<StoredWallet> {
  let w = wallet
  if (!w.evmAddress || !w.evmEncrypted) {
    const { provisionBridgeWalletForStoredWallet } = await import('@/lib/create-evm-wallet')
    w = await provisionBridgeWalletForStoredWallet(w)
  }
  if (!hasBtcWallet(w)) {
    w = await provisionBtcWalletForStoredWallet(w)
  }
  return w
}
