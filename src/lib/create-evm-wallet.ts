import { Wallet } from 'ethers'
import { encryptSeed, type EncryptedSeed } from '@/lib/wallet-crypto'

export interface CreatedEvmWallet {
  address: string
  evmEncrypted: EncryptedSeed
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