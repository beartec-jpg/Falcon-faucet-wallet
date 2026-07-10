import { Wallet, hexlify } from 'ethers'
import { authenticatePasskey } from '@/lib/passkey'
import { encryptSeed, type EncryptedSeed } from '@/lib/wallet-crypto'
import { normalizeEvmPrivateKey } from '@/lib/evm-wallet-backup'
import { loadPrimaryWallet, saveWallet, type StoredWallet } from '@/lib/wallet-store'

export interface CreatedEvmWallet {
  address: string
  evmEncrypted: EncryptedSeed
}

/** True when a passkey-encrypted Sepolia bridge wallet is stored on this device. */
export function hasBridgeWallet(wallet: Pick<StoredWallet, 'evmAddress' | 'evmEncrypted'>): boolean {
  return !!(wallet.evmAddress && wallet.evmEncrypted)
}

/** CSPRNG secp256k1 key — avoids ethers HD/mnemonic path that can fail in some mobile browsers. */
export function createRandomEvmWallet(): { address: string; privateKeyHex: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const wallet = new Wallet(hexlify(bytes))
  const privateKeyHex = wallet.privateKey.startsWith('0x')
    ? wallet.privateKey.slice(2)
    : wallet.privateKey
  return { address: wallet.address, privateKeyHex }
}

/** Encrypt an existing Sepolia private key with passkey key material. */
export async function encryptEvmKeyForPasskey(
  privateKeyHex: string,
  keyBytes: Uint8Array,
  hasPrf: boolean,
): Promise<CreatedEvmWallet> {
  const pk = normalizeEvmPrivateKey(privateKeyHex)
  if (!pk) throw new Error('Invalid Sepolia private key')
  const wallet = new Wallet(`0x${pk}`)
  const evmEncrypted = await encryptSeed(pk, keyBytes, hasPrf)
  return { address: wallet.address, evmEncrypted }
}

/** Generate a fresh Sepolia EVM wallet encrypted with the same passkey key material as Falcon. */
export async function createEvmWalletForPasskey(
  keyBytes: Uint8Array,
  hasPrf: boolean,
): Promise<CreatedEvmWallet> {
  const { address, privateKeyHex } = createRandomEvmWallet()
  return encryptEvmKeyForPasskey(privateKeyHex, keyBytes, hasPrf)
}

/** Create and persist a Sepolia bridge wallet for an existing Falcon wallet record. */
export async function provisionBridgeWalletForStoredWallet(
  wallet: StoredWallet,
): Promise<StoredWallet> {
  const { keyBytes, hasPrf } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
  const evm = await createEvmWalletForPasskey(keyBytes, hasPrf)
  const updated: StoredWallet = {
    ...wallet,
    evmAddress: evm.address,
    evmEncrypted: evm.evmEncrypted,
  }
  await saveWallet(updated)
  const reloaded = await loadPrimaryWallet()
  if (!reloaded || !hasBridgeWallet(reloaded)) {
    throw new Error('Bridge wallet could not be saved on this device — try again in the same browser tab')
  }
  return reloaded
}