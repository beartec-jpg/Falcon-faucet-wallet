/** Optional two-factor KEK: HKDF(PRF || Argon2id(password)). Both factors are required. */
import { beforeEach, describe, expect, it } from 'vitest'
import { authenticator, setAuthenticator } from './setup-browser'
import {
  registerPasskey, authenticatePasskey, addWalletPassword, removeWalletPassword, changeWalletPassword,
  PrfUnavailableError, toBase64Url,
} from '@/lib/passkey'
import { decryptSeed, encryptSeed } from '@/lib/wallet-crypto'
import { newPasswordKdfParams, walletKeyFromPassword, walletKeyFromPrf, walletKeyFromPrfAndPassword } from '@/lib/wallet-key'
import { setWalletPasswordPrompter, PasswordPromptCancelled } from '@/lib/password-prompt'
import { loadKekRecord, deleteKekRecord } from '@/lib/kek-store'
import { saveWallet, loadWallets, deleteAllWallets, type StoredWallet } from '@/lib/wallet-store'

const PW = 'Correct-Horse-9-Battery'
const PW2 = 'Second-Staple-7-Lamp'
const PRF = new Uint8Array(32).fill(8)
let prompts: string[] = []
function promptWith(...answers: string[]) {
  prompts = []
  setWalletPasswordPrompter(async (req) => {
    prompts.push(req.mode)
    const a = answers.shift()
    if (a === undefined) throw new PasswordPromptCancelled()
    return a
  })
}
const prfKeyFromSecret = async () => {
  const k = await crypto.subtle.importKey('raw', PRF, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return walletKeyFromPrf(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('qxrp-wallet-v1')))
}
async function storeWallet(cid: string, key: any) {
  const w = { credentialId: cid, address: 'rT', publicKey: 'ab', label: 't', createdAt: 1, hasPrf: true,
    encrypted: await encryptSeed('falcon-secret', key), evmEncrypted: await encryptSeed('evm-key', key) } as StoredWallet
  await saveWallet(w)
}
const stored = async () => (await loadWallets())[0]

beforeEach(async () => {
  await deleteAllWallets()
  setAuthenticator({ rawId: crypto.getRandomValues(new Uint8Array(32)), prfSecret: PRF })
  await deleteKekRecord(toBase64Url(authenticator.rawId))
})

describe('passkey + password KEK', () => {
  it('creation with the optional password: both factors needed', async () => {
    promptWith(PW)
    const reg = await registerPasskey('a', { offerPassword: true })
    expect(prompts).toEqual(['add-optional'])
    expect(reg.keyBytes.source).toBe('prf+password')
    const rec = await loadKekRecord(reg.credentialId)
    expect(rec?.mode).toBe('prf+password')
    expect(JSON.stringify(rec)).not.toContain(PW)
    const blob = await encryptSeed('falcon-secret', reg.keyBytes)
    expect(blob.kek).toBe('prf+password')

    // PRF alone fails
    await expect(decryptSeed(blob, await prfKeyFromSecret())).rejects.toThrow()
    // password alone fails (same KDF params, right password, no PRF)
    await expect(decryptSeed(blob, await walletKeyFromPassword(PW, rec!.kdf!))).rejects.toThrow()
    // a forged kek tag doesn't help either
    await expect(decryptSeed({ ...blob, kek: 'prf' }, await prfKeyFromSecret())).rejects.toThrow()
    // wrong PRF + right password fails
    const wrongPrf = walletKeyFromPrf(new Uint8Array(32).fill(1))
    await expect(decryptSeed(blob, await walletKeyFromPrfAndPassword(wrongPrf, await walletKeyFromPassword(PW, rec!.kdf!)))).rejects.toThrow()
    // both factors succeed
    const both = await walletKeyFromPrfAndPassword(await prfKeyFromSecret(), await walletKeyFromPassword(PW, rec!.kdf!))
    expect(await decryptSeed(blob, both)).toBe('falcon-secret')

    // unlock: passkey then password
    promptWith(PW)
    const a = await authenticatePasskey(reg.credentialId, true)
    expect(prompts).toEqual(['enter'])
    expect(await decryptSeed(blob, a.keyBytes)).toBe('falcon-secret')
  })

  it('creation: unticking the password keeps PRF-only', async () => {
    promptWith('')
    const reg = await registerPasskey('b', { offerPassword: true })
    expect(reg.keyBytes.source).toBe('prf')
    expect((await loadKekRecord(reg.credentialId))?.mode).toBe('prf')
  })

  it('unlock fails closed without PRF even with the right password', async () => {
    promptWith(PW)
    const reg = await registerPasskey('c', { offerPassword: true })
    setAuthenticator({ rawId: authenticator.rawId, prfSecret: null })
    promptWith(PW)
    await expect(authenticatePasskey(reg.credentialId, true)).rejects.toBeInstanceOf(PrfUnavailableError)
    expect(prompts).toEqual([])
  })

  it('wrong password errors cleanly and unlocks nothing', async () => {
    promptWith(PW)
    const reg = await registerPasskey('d', { offerPassword: true })
    promptWith('Wrong-Pass-1x', 'Wrong-Pass-2x', 'Wrong-Pass-3x', 'Wrong-Pass-4x', 'Wrong-Pass-5x')
    await expect(authenticatePasskey(reg.credentialId, true)).rejects.toThrow(/Wrong wallet password/)
    promptWith('Wrong-Pass-1x', PW)
    expect((await authenticatePasskey(reg.credentialId, true)).keyBytes.source).toBe('prf+password')
  })

  it('migration from PRF-only: add password re-encrypts every blob; then remove restores PRF-only', async () => {
    promptWith()
    const reg = await registerPasskey('e')
    await storeWallet(reg.credentialId, reg.keyBytes)
    const before = await stored()

    await addWalletPassword(reg.credentialId, PW)
    const after = await stored()
    expect(after.encrypted.kek).toBe('prf+password')
    expect(after.evmEncrypted?.kek).toBe('prf+password')
    expect(after.encrypted.data).not.toBe(before.encrypted.data)
    expect(JSON.stringify(after)).not.toContain('falcon-secret')
    await expect(decryptSeed(after.encrypted, await prfKeyFromSecret())).rejects.toThrow()
    expect((await loadKekRecord(reg.credentialId))?.mode).toBe('prf+password')
    await expect(addWalletPassword(reg.credentialId, PW)).rejects.toThrow(/already/)

    promptWith(PW)
    const k = (await authenticatePasskey(reg.credentialId, true)).keyBytes
    expect(await decryptSeed(after.encrypted, k)).toBe('falcon-secret')
    expect(await decryptSeed(after.evmEncrypted!, k)).toBe('evm-key')

    // removal requires a successful unlock: wrong password changes nothing
    promptWith('Wrong-Pass-1x', 'Wrong-Pass-2x', 'Wrong-Pass-3x', 'Wrong-Pass-4x', 'Wrong-Pass-5x')
    await expect(removeWalletPassword(reg.credentialId)).rejects.toThrow(/Wrong wallet password/)
    expect((await stored()).encrypted.kek).toBe('prf+password')
    promptWith()
    await expect(removeWalletPassword(reg.credentialId)).rejects.toBeInstanceOf(PasswordPromptCancelled)

    promptWith(PW)
    await removeWalletPassword(reg.credentialId)
    const removed = await stored()
    expect(removed.encrypted.kek).toBe('prf')
    expect((await loadKekRecord(reg.credentialId))?.mode).toBe('prf')
    promptWith()
    const k2 = (await authenticatePasskey(reg.credentialId, true)).keyBytes
    expect(prompts).toEqual([])
    expect(await decryptSeed(removed.encrypted, k2)).toBe('falcon-secret')
  })

  it('change password: needs current password; old one stops working', async () => {
    promptWith(PW)
    const reg = await registerPasskey('f', { offerPassword: true })
    await storeWallet(reg.credentialId, reg.keyBytes)
    promptWith(PW)
    await changeWalletPassword(reg.credentialId, PW2)
    promptWith(PW, PW, PW, PW, PW)
    await expect(authenticatePasskey(reg.credentialId, true)).rejects.toThrow(/Wrong wallet password/)
    promptWith(PW2)
    const k = (await authenticatePasskey(reg.credentialId, true)).keyBytes
    expect(await decryptSeed((await stored()).encrypted, k)).toBe('falcon-secret')
  })

  it('password-only (no PRF) wallets are unchanged and cannot add the second factor', async () => {
    setAuthenticator({ rawId: authenticator.rawId, prfSecret: null })
    promptWith(PW)
    const reg = await registerPasskey('g', { offerPassword: true })
    expect(prompts).toEqual(['create'])
    expect(reg.keyBytes.source).toBe('password')
    await expect(addWalletPassword(reg.credentialId, PW2)).rejects.toThrow(/already password-protected/)
  })

  it('weak password is rejected', async () => {
    const prfKey = await prfKeyFromSecret()
    await expect(addWalletPassword('x', 'short')).rejects.toThrow(/12/)
    expect(prfKey.source).toBe('prf')
    expect(newPasswordKdfParams().alg).toBe('argon2id')
  })
})
