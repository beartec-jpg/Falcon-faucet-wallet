/**
 * Audit H-1: no code path may decrypt wallet keys without the passkey PRF output or the
 * user's password. In particular, nothing stored on the device (credential ID / rawId,
 * KDF params, check value) may be enough.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { authenticator, calls, setAuthenticator } from './setup-browser'
import { registerPasskey, authenticatePasskey, PrfUnavailableError, toBase64Url } from '@/lib/passkey'
import {
  decryptSeed,
  encryptSeed,
  isLegacyWeakBlob,
  LegacyWeakBlobError,
  reencryptLegacyBlob,
  type EncryptedSeed,
} from '@/lib/wallet-crypto'
import { validateWalletPassword, walletKeyFromPrf, isWalletKey } from '@/lib/wallet-key'
import { setWalletPasswordPrompter, PasswordPromptCancelled } from '@/lib/password-prompt'
import { loadKekRecord, deleteKekRecord } from '@/lib/kek-store'
import { saveWallet, loadWallets, deleteAllWallets, type StoredWallet } from '@/lib/wallet-store'
import { saveVaultPublic, loadVaults } from '@/lib/vault-store'
import { saveValidatorCredentials, loadValidatorCredentials, clearValidatorCredentials } from '@/lib/validator-credentials-store'

const GOOD_PW = 'Correct-Horse-9-Battery'

/** The pre-H-1 algorithm: HKDF(rawId) → AES-GCM. This is what an attacker with the DB can do. */
async function legacyEncrypt(seed: string, rawId: Uint8Array): Promise<EncryptedSeed> {
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await attackerKey(rawId, salt)
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(seed))
  const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')
  return { data: b64(new Uint8Array(enc)), iv: b64(iv), salt: b64(salt), hasPrf: false }
}
async function attackerKey(material: Uint8Array, salt: Uint8Array) {
  const raw = await crypto.subtle.importKey('raw', material, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('qxrp-wallet-v1') },
    raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}
/** Try every value an attacker can read from the device as key material. */
async function attackerCanDecrypt(blob: EncryptedSeed, deviceValues: Uint8Array[]): Promise<boolean> {
  for (const m of deviceValues) {
    try {
      const key = await attackerKey(m, Buffer.from(blob.salt, 'base64'))
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(blob.iv, 'base64') }, key, Buffer.from(blob.data, 'base64'))
      return true
    } catch { /* expected */ }
  }
  return false
}
function deviceValues(credentialId: string, extra: unknown): Uint8Array[] {
  const vals = [Buffer.from(credentialId, 'base64url'), new TextEncoder().encode(credentialId)]
  const s = JSON.stringify(extra)
  for (const m of s.matchAll(/"([A-Za-z0-9+/=_-]{16,})"/g)) {
    try { vals.push(Buffer.from(m[1], 'base64')) } catch { /* */ }
  }
  return vals.map((v) => new Uint8Array(v))
}

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

function wallet(credentialId: string, encrypted: EncryptedSeed, hasPrf: boolean, extra: Partial<StoredWallet> = {}): StoredWallet {
  return {
    credentialId, address: 'rTest', publicKey: 'ab', label: 't', encrypted, hasPrf, createdAt: 1, ...extra,
  } as StoredWallet
}

beforeEach(async () => {
  await deleteAllWallets()
  for (const v of await loadVaults()) await (await import('@/lib/vault-store')).deleteVault(v.vaultId)
  clearValidatorCredentials()
  setAuthenticator({ rawId: crypto.getRandomValues(new Uint8Array(32)), prfSecret: null })
  await deleteKekRecord(toBase64Url(authenticator.rawId))
  calls.create = calls.get = 0
})

describe('WalletKey construction', () => {
  it('encrypt/decrypt reject raw bytes (e.g. a rawId) at runtime', async () => {
    const rawId = new Uint8Array(32).fill(1)
    await expect(encryptSeed('s', rawId as any)).rejects.toThrow(/PRF key or a wallet password/)
    const k = walletKeyFromPrf(new Uint8Array(32).fill(2))
    const blob = await encryptSeed('s', k)
    await expect(decryptSeed(blob, rawId as any)).rejects.toThrow(/PRF key or a wallet password/)
    await expect(decryptSeed(blob, { source: 'prf', bytes: rawId } as any)).rejects.toThrow()
  })
  it('PRF output shorter than 32 bytes is refused', () => {
    expect(() => walletKeyFromPrf(new Uint8Array(16))).toThrow()
  })
  it('decryptSeed refuses legacy rawId blobs even with a valid key', async () => {
    const legacy = await legacyEncrypt('secret', new Uint8Array(32).fill(3))
    expect(isLegacyWeakBlob(legacy)).toBe(true)
    await expect(decryptSeed(legacy, walletKeyFromPrf(new Uint8Array(32)))).rejects.toBeInstanceOf(LegacyWeakBlobError)
  })
  it('reencryptLegacyBlob returns only a strong blob, never plaintext', async () => {
    const rawId = new Uint8Array(32).fill(4)
    const legacy = await legacyEncrypt('topsecret', rawId)
    const k = walletKeyFromPrf(new Uint8Array(32).fill(5))
    const out = await reencryptLegacyBlob(legacy, rawId, k)
    expect(JSON.stringify(out)).not.toContain('topsecret')
    expect(out.kek).toBe('prf')
    expect(await attackerCanDecrypt(out, [rawId])).toBe(false)
    expect(await decryptSeed(out, k)).toBe('topsecret')
    await expect(reencryptLegacyBlob(out, rawId, k)).rejects.toThrow(/Not a legacy/)
  })
  it('blob kek kind must match the key kind', async () => {
    const prfKey = walletKeyFromPrf(new Uint8Array(32).fill(9))
    const blob = await encryptSeed('x', prfKey)
    const forged = { ...blob, kek: 'password' as const }
    await expect(decryptSeed(forged, prfKey)).rejects.toThrow(/password/)
  })
})

describe('password policy', () => {
  it('enforces a minimum strength', () => {
    expect(validateWalletPassword('short1A!')).toMatch(/12/)
    expect(validateWalletPassword('alllowercaseletters')).toMatch(/3 of/)
    expect(validateWalletPassword('aaaaaaAAAA11')).toMatch(/repeated/)
    expect(validateWalletPassword(GOOD_PW)).toBeNull()
  })
})

describe('registration', () => {
  it('without PRF: requires a password; stored data cannot decrypt the keys', async () => {
    promptWith(GOOD_PW)
    const reg = await registerPasskey('alice')
    expect(prompts).toEqual(['create'])
    expect(reg.hasPrf).toBe(false)
    expect(reg.keyBytes.source).toBe('password')
    const blob = await encryptSeed('falcon-secret-hex', reg.keyBytes)
    const rec = await loadKekRecord(reg.credentialId)
    expect(rec?.mode).toBe('password')
    expect(JSON.stringify(rec)).not.toContain(GOOD_PW)
    expect(await attackerCanDecrypt(blob, deviceValues(reg.credentialId, [rec, blob]))).toBe(false)
  })
  it('without PRF: cancelling the password prompt aborts wallet creation', async () => {
    promptWith()
    await expect(registerPasskey('bob')).rejects.toBeInstanceOf(PasswordPromptCancelled)
  })
  it('with PRF: no password, key is the PRF output, not the rawId', async () => {
    setAuthenticator({ rawId: authenticator.rawId, prfSecret: new Uint8Array(32).fill(8) })
    promptWith()
    const reg = await registerPasskey('carol')
    expect(prompts).toEqual([])
    expect(reg.keyBytes.source).toBe('prf')
    const blob = await encryptSeed('k', reg.keyBytes)
    expect(await attackerCanDecrypt(blob, deviceValues(reg.credentialId, [blob]))).toBe(false)
  })
  it('PRF only enabled at create: fetches PRF via an assertion', async () => {
    setAuthenticator({ rawId: authenticator.rawId, prfSecret: new Uint8Array(32).fill(6), prfOnlyEnabledAtCreate: true })
    promptWith()
    const reg = await registerPasskey('dave')
    expect(reg.hasPrf).toBe(true)
    expect(calls.get).toBe(1)
  })
})

describe('unlock', () => {
  it('PRF wallet fails closed when PRF is missing (no silent fallback, no password prompt)', async () => {
    setAuthenticator({ rawId: authenticator.rawId, prfSecret: new Uint8Array(32).fill(1) })
    promptWith()
    const reg = await registerPasskey('erin')
    setAuthenticator({ rawId: authenticator.rawId, prfSecret: null })
    await expect(authenticatePasskey(reg.credentialId, true)).rejects.toBeInstanceOf(PrfUnavailableError)
    expect(prompts).toEqual([])
  })
  it('PRF wallet with no key record and flag hasPrf=true also fails closed', async () => {
    const cid = toBase64Url(authenticator.rawId)
    await expect(authenticatePasskey(cid, true)).rejects.toBeInstanceOf(PrfUnavailableError)
  })
  it('password wallet: wrong password is refused, right one decrypts; UV is required', async () => {
    promptWith(GOOD_PW)
    const reg = await registerPasskey('frank')
    const blob = await encryptSeed('my-secret', reg.keyBytes)
    promptWith('Wrong-Password-1', 'Wrong-Password-2', 'Wrong-Password-3', 'Wrong-Password-4', 'Wrong-Password-5')
    await expect(authenticatePasskey(reg.credentialId, false)).rejects.toThrow(/Wrong wallet password/)
    promptWith('Wrong-Password-1', GOOD_PW)
    const a = await authenticatePasskey(reg.credentialId, false)
    expect(calls.lastGetUv).toBe('required')
    expect(await decryptSeed(blob, a.keyBytes)).toBe('my-secret')
  })
  it('password wallet: cancelling the prompt unlocks nothing', async () => {
    promptWith(GOOD_PW)
    const reg = await registerPasskey('gina')
    promptWith()
    await expect(authenticatePasskey(reg.credentialId, false)).rejects.toBeInstanceOf(PasswordPromptCancelled)
  })
})

describe('migration of pre-H-1 rawId wallets', () => {
  async function seedLegacy() {
    const rawId = authenticator.rawId
    const cid = toBase64Url(rawId)
    const w = wallet(cid, await legacyEncrypt('FALCON', rawId), false, {
      evmEncrypted: await legacyEncrypt('EVM', rawId),
      btcEncrypted: await legacyEncrypt('BTC', rawId),
    })
    await saveWallet(w)
    await saveVaultPublic({ vaultId: 'v1', address: 'rV', publicKey: 'p', label: 'v', createdAt: 1, fingerprint: 'f', payoutAddress: 'x', kind: 'browser', credentialId: cid, encrypted: await legacyEncrypt('VAULT', rawId), hasPrf: false } as any)
    saveValidatorCredentials({ address: 'rVal', consensusKeyHex: 'c', encrypted: await legacyEncrypt('VALIDATOR', rawId), credentialId: cid, hasPrf: false, label: 'Validator', savedAt: 1 } as any)
    return { rawId, cid }
  }
  async function allBlobs(): Promise<EncryptedSeed[]> {
    const w = (await loadWallets())[0]
    return [w.encrypted, w.evmEncrypted!, w.btcEncrypted!, (await loadVaults())[0].encrypted!, loadValidatorCredentials()!.encrypted]
  }

  it('the old blobs really are decryptable from device data alone (proves the test harness)', async () => {
    const { rawId } = await seedLegacy()
    for (const b of await allBlobs()) expect(await attackerCanDecrypt(b, [rawId])).toBe(true)
  })

  it('no PRF: forces a new password, re-encrypts every blob, deletes the weak copies', async () => {
    const { rawId, cid } = await seedLegacy()
    promptWith(GOOD_PW)
    const a = await authenticatePasskey(cid, false)
    expect(prompts).toEqual(['migrate'])
    expect(a.keyBytes.source).toBe('password')
    const blobs = await allBlobs()
    const rec = await loadKekRecord(cid)
    for (const b of blobs) {
      expect(isLegacyWeakBlob(b)).toBe(false)
      expect(b.kek).toBe('password')
      expect(await attackerCanDecrypt(b, deviceValues(cid, [rec, blobs]))).toBe(false)
    }
    expect((await Promise.all(blobs.map((b) => decryptSeed(b, a.keyBytes))))).toEqual(['FALCON', 'EVM', 'BTC', 'VAULT', 'VALIDATOR'])
    // Next unlock asks for the password (enter), not a new one.
    promptWith(GOOD_PW)
    await authenticatePasskey(cid, false)
    expect(prompts).toEqual(['enter'])
  })

  it('migration cancelled: nothing is decrypted or rewritten, wallet stays locked', async () => {
    const { cid } = await seedLegacy()
    const before = JSON.stringify(await allBlobs())
    promptWith()
    await expect(authenticatePasskey(cid, false)).rejects.toBeInstanceOf(PasswordPromptCancelled)
    expect(JSON.stringify(await allBlobs())).toBe(before)
    // And the app still cannot use the legacy blob directly.
    const w = (await loadWallets())[0]
    await expect(decryptSeed(w.encrypted, walletKeyFromPrf(new Uint8Array(32)))).rejects.toBeInstanceOf(LegacyWeakBlobError)
  })

  it('PRF now available: re-wraps with PRF, no password needed', async () => {
    setAuthenticator({ rawId: authenticator.rawId, prfSecret: new Uint8Array(32).fill(4) })
    const { cid } = await seedLegacy()
    promptWith()
    const a = await authenticatePasskey(cid, false)
    expect(prompts).toEqual([])
    expect(a.hasPrf).toBe(true)
    for (const b of await allBlobs()) expect(b.kek).toBe('prf')
    expect((await loadWallets())[0].hasPrf).toBe(true)
  })

  it('stray legacy blob on a PRF wallet (old silent fallback) is re-wrapped with PRF', async () => {
    setAuthenticator({ rawId: authenticator.rawId, prfSecret: new Uint8Array(32).fill(2) })
    promptWith()
    const reg = await registerPasskey('h')
    const good = await encryptSeed('FALCON', reg.keyBytes)
    await saveWallet(wallet(reg.credentialId, good, true, { evmEncrypted: await legacyEncrypt('EVM', authenticator.rawId) }))
    const a = await authenticatePasskey(reg.credentialId, true)
    const w = (await loadWallets())[0]
    expect(isLegacyWeakBlob(w.evmEncrypted)).toBe(false)
    expect(await decryptSeed(w.evmEncrypted!, a.keyBytes)).toBe('EVM')
  })
})

describe('static: no rawId-derived key material in app code', () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f)
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : []
    })
  }
  it('only the migration path touches rawId bytes as key material', () => {
    const allowed = new Set(['src/lib/passkey.ts', 'src/lib/wallet-crypto.ts', 'src/lib/wallet-migrate.ts'])
    const offenders: string[] = []
    for (const f of files('src')) {
      const rel = path.relative(process.cwd(), f)
      const src = readFileSync(f, 'utf8')
      if (/\.rawId\b/.test(src) && !allowed.has(rel)) offenders.push(rel)
      if (/keyBytes\s*[:=]\s*rawId/.test(src)) offenders.push(rel + ' (keyBytes = rawId)')
    }
    expect(offenders).toEqual([])
    const pk = readFileSync('src/lib/passkey.ts', 'utf8')
    // In passkey.ts rawId is only used to compute the credential id and to feed migration.
    const uses = [...pk.matchAll(/cred\.rawId/g)].length
    expect(uses).toBe(2)
    expect(pk).toMatch(/migrateLegacyBlobs\(credentialId, new Uint8Array\(cred\.rawId\), key\)/)
  })
  it('isWalletKey refuses look-alike objects', () => {
    expect(isWalletKey({ source: 'prf', bytes: new Uint8Array(32) })).toBe(false)
    expect(isWalletKey(new Uint8Array(32))).toBe(false)
  })
})
