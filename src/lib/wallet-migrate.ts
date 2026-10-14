/**
 * Audit H-1 migration: find every blob on this device that is still wrapped with the
 * credential-rawId key for a given passkey, re-wrap it under a strong WalletKey, and overwrite
 * the stored record so the weak copy is gone.
 */

import { isLegacyWeakBlob, reencryptLegacyBlob, type EncryptedSeed } from '@/lib/wallet-crypto'
import type { WalletKey } from '@/lib/wallet-key'
import { loadWallets, saveWallet, type StoredWallet } from '@/lib/wallet-store'
import { loadVaults, saveVaultPublic } from '@/lib/vault-store'
import { loadValidatorCredentials, saveValidatorCredentials } from '@/lib/validator-credentials-store'

const WALLET_FIELDS = ['encrypted', 'evmEncrypted', 'btcEncrypted', 'xrplClassicEncrypted'] as const

async function rewrap(b: EncryptedSeed, rawId: Uint8Array, key: WalletKey): Promise<EncryptedSeed> {
  return reencryptLegacyBlob(b, rawId, key)
}

/** Does any record for this credential still hold a legacy rawId-wrapped blob? */
export async function hasLegacyBlobs(credentialId: string): Promise<boolean> {
  const wallets = (await loadWallets()).filter((w) => w.credentialId === credentialId)
  if (wallets.some((w) => WALLET_FIELDS.some((f) => isLegacyWeakBlob(w[f])))) return true
  const vaults = (await loadVaults()).filter((v) => v.credentialId === credentialId)
  if (vaults.some((v) => isLegacyWeakBlob(v.encrypted))) return true
  const vc = loadValidatorCredentials()
  return !!vc && vc.credentialId === credentialId && isLegacyWeakBlob(vc.encrypted)
}

/**
 * Re-wrap every legacy blob for `credentialId`. All new blobs are computed first, then written,
 * so a failure part-way leaves the records unchanged. Returns the number of blobs migrated.
 */
export async function migrateLegacyBlobs(credentialId: string, rawId: Uint8Array, key: WalletKey): Promise<number> {
  let n = 0
  const hasPrf = key.source === 'prf'

  const walletUpdates: StoredWallet[] = []
  for (const w of (await loadWallets()).filter((x) => x.credentialId === credentialId)) {
    const next: StoredWallet = { ...w, hasPrf }
    let changed = w.hasPrf !== hasPrf
    for (const f of WALLET_FIELDS) {
      const b = w[f]
      if (b && isLegacyWeakBlob(b)) {
        next[f] = await rewrap(b, rawId, key)
        n++
        changed = true
      }
    }
    if (changed) walletUpdates.push(next)
  }

  const vaultUpdates = []
  for (const v of (await loadVaults()).filter((x) => x.credentialId === credentialId)) {
    if (v.encrypted && isLegacyWeakBlob(v.encrypted)) {
      vaultUpdates.push({ ...v, encrypted: await rewrap(v.encrypted, rawId, key), hasPrf })
      n++
    }
  }

  const vc = loadValidatorCredentials()
  let vcUpdate = null
  if (vc && vc.credentialId === credentialId && isLegacyWeakBlob(vc.encrypted)) {
    vcUpdate = { ...vc, encrypted: await rewrap(vc.encrypted, rawId, key), hasPrf }
    n++
  }

  for (const w of walletUpdates) await saveWallet(w)
  for (const v of vaultUpdates) await saveVaultPublic(v)
  if (vcUpdate) saveValidatorCredentials(vcUpdate)
  return n
}
