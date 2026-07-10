import { Wallet } from 'ethers'
import { authenticatePasskey } from '@/lib/passkey'
import { encryptSeed, type EncryptedSeed } from '@/lib/wallet-crypto'
import { saveWallet, type StoredWallet } from '@/lib/wallet-store'

export interface CreatedEvmWallet {
  address: string
  evmEncrypted: EncryptedSeed
}

/** True when a passkey-encrypted Sepolia bridge wallet is stored on this device. */
export function hasBridgeWallet(wallet: Pick<StoredWallet, 'evmAddress' | 'evmEncrypted'>): boolean {
  return !!(wallet.evmAddress && wallet.evmEncrypted)
}

/** Generate a fresh Sepolia EVM wallet encrypted with the same passkey key material as Falcon. */
export async function createEvmWalletForPasskey(
  keyBytes: Uint8Array,
  hasPrf: boolean,
): Promise<CreatedEvmWallet> {
  const evm = Wallet.createRandom()
  const pk = evm.privateKey.startsWith('0x') ? evm.privateKey.slice(2) : evm.privateKey
  const evmEncrypted = await encryptSeed(pk, keyBytes, hasPrf)
  return { address: evm.address, evmEncrypted }
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
  return updated
}