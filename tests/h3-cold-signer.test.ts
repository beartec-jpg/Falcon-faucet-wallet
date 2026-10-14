import { beforeEach, describe, expect, it } from 'vitest'
import { setAuthenticator } from './setup-browser'
import {
  saveColdVaultWithPassword,
  saveColdVaultWithPasskey,
  unlockColdVaultWithPassword,
  unlockColdVaultWithPasskey,
  migrateLegacyPasskeyVault,
  loadColdVaultMeta,
  wipeColdVault,
  isLegacyWeakPasskeyRecord,
} from '../cold-signer/src/lib/coldVaultDb'
import { registerColdPasskey, assertColdPasskey, NO_PRF_MESSAGE } from '../cold-signer/src/lib/coldPasskey'

;(globalThis as any).isSecureContext = true

const META = { address: 'rTestColdVault1111111111111', publicKey: 'ab'.repeat(16), label: 'cold', createdAt: 1 }
const SECRET = 'falcon-secret-' + 'x'.repeat(64)
const RAW_ID = new Uint8Array(32).fill(9)
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const b64url = (u: Uint8Array) => b64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function idb<T>(fn: (s: IDBObjectStore) => IDBRequest<T> | void, mode: IDBTransactionMode = 'readonly'): Promise<T> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('falcon-cold-signer', 3)
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('vault')) r.result.createObjectStore('vault', { keyPath: 'id' })
    }
    r.onsuccess = () => {
      const tx = r.result.transaction('vault', mode)
      const q = fn(tx.objectStore('vault'))
      tx.oncomplete = () => resolve(q ? (q as IDBRequest<T>).result : (undefined as T))
      tx.onerror = () => reject(tx.error)
    }
    r.onerror = () => reject(r.error)
  })
}
const raw = () => idb<any>((s) => s.get('main'))

/** Pre-H-3 passkey record: HKDF(credential rawId) — what old builds wrote. */
async function writeLegacyPasskeyVault() {
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const base = await crypto.subtle.importKey('raw', RAW_ID, 'HKDF', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('falcon-cold-signer-v1') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
  )
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(SECRET)))
  const rec = { id: 'main', ...META, unlockMethod: 'passkey', credentialId: b64url(RAW_ID), hasPrf: false,
    encrypted: { data: b64(data), iv: b64(iv), salt: b64(salt) } }
  await idb((s) => s.put(rec), 'readwrite')
  return rec
}

async function writeLegacyPbkdf2Vault(pw: string) {
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210_000, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(SECRET)))
  await idb((s) => s.put({ id: 'main', ...META, unlockMethod: 'password',
    encrypted: { data: b64(data), iv: b64(iv), salt: b64(salt) } }), 'readwrite')
}

beforeEach(async () => {
  await wipeColdVault()
  setAuthenticator({ rawId: RAW_ID, prfSecret: null })
})

describe('H-3 cold signer: registration', () => {
  it('fails closed when the authenticator has no PRF', async () => {
    await expect(registerColdPasskey('cold')).rejects.toThrow(NO_PRF_MESSAGE)
  })
  it('returns PRF output (not the raw ID) when PRF is available', async () => {
    setAuthenticator({ rawId: RAW_ID, prfSecret: new Uint8Array(32).fill(3) })
    const reg = await registerColdPasskey('cold')
    expect(reg.prfOutput.byteLength).toBe(32)
    expect(Array.from(reg.prfOutput)).not.toEqual(Array.from(RAW_ID))
  })
  it('evaluates PRF via get() when create() only reports prf.enabled', async () => {
    setAuthenticator({ rawId: RAW_ID, prfSecret: new Uint8Array(32).fill(4), prfOnlyEnabledAtCreate: true })
    const reg = await registerColdPasskey('cold')
    expect(reg.prfOutput.byteLength).toBe(32)
  })
})

describe('H-3 cold signer: storage', () => {
  it('refuses to save a passkey vault without PRF output', async () => {
    await expect(saveColdVaultWithPasskey(META, SECRET, b64url(RAW_ID), RAW_ID.slice(0, 16))).rejects.toThrow(/PRF/)
    expect(await raw()).toBeUndefined()
  })
  it('PRF vault unlocks with PRF and fails closed without it', async () => {
    setAuthenticator({ rawId: RAW_ID, prfSecret: new Uint8Array(32).fill(5) })
    const reg = await registerColdPasskey('cold')
    await saveColdVaultWithPasskey(META, SECRET, reg.credentialId, reg.prfOutput)
    const a = await assertColdPasskey(reg.credentialId)
    expect((await unlockColdVaultWithPasskey(a.prfOutput)).falcon_secret).toBe(SECRET)
    await expect(unlockColdVaultWithPasskey(null)).rejects.toThrow(/PRF/)
    // The stored credential ID is not a key for the blob.
    await expect(unlockColdVaultWithPasskey(RAW_ID)).rejects.toThrow('Passkey unlock failed')
  })
  it('password vaults use Argon2id with the hot-wallet parameters', async () => {
    await saveColdVaultWithPassword(META, SECRET, 'correct horse battery')
    const r = await raw()
    expect(r.kdf).toEqual({ alg: 'argon2id', v: 0x13, m: 47_104, t: 2, p: 1 })
    expect((await unlockColdVaultWithPassword('correct horse battery')).falcon_secret).toBe(SECRET)
    await expect(unlockColdVaultWithPassword('wrong password!!')).rejects.toThrow('Wrong cold password')
  })
  it('legacy PBKDF2 password vaults are re-wrapped to Argon2id on unlock', async () => {
    await writeLegacyPbkdf2Vault('legacy password 1')
    expect((await unlockColdVaultWithPassword('legacy password 1')).falcon_secret).toBe(SECRET)
    expect((await raw()).kdf?.alg).toBe('argon2id')
    expect((await unlockColdVaultWithPassword('legacy password 1')).falcon_secret).toBe(SECRET)
  })
})

describe('H-3 cold signer: legacy passkey migration', () => {
  it('flags and refuses direct unlock of a credential-ID vault', async () => {
    await writeLegacyPasskeyVault()
    expect(isLegacyWeakPasskeyRecord((await loadColdVaultMeta())!)).toBe(true)
    await expect(unlockColdVaultWithPasskey(RAW_ID)).rejects.toThrow(/migrated/)
  })
  it('without PRF and without a password, migration fails closed and leaves the record', async () => {
    const before = await writeLegacyPasskeyVault()
    await expect(migrateLegacyPasskeyVault({ assertedRawId: RAW_ID, prfOutput: null })).rejects.toThrow(/cold password/)
    expect((await raw()).encrypted).toEqual(before.encrypted)
  })
  it('rejects a different credential', async () => {
    await writeLegacyPasskeyVault()
    await expect(migrateLegacyPasskeyVault({ assertedRawId: new Uint8Array(32).fill(1), prfOutput: null,
      newPassword: 'a new cold password' })).rejects.toThrow(/does not match/)
  })
  it('no PRF: re-wraps under an Argon2id password and overwrites the weak blob', async () => {
    const before = await writeLegacyPasskeyVault()
    const a = await assertColdPasskey(before.credentialId)
    expect(a.prfOutput).toBeNull()
    const res = await migrateLegacyPasskeyVault({ assertedRawId: a.rawId, prfOutput: null, newPassword: 'a new cold password' })
    expect(res.method).toBe('password')
    expect(res.session.falcon_secret).toBe(SECRET)
    const r = await raw()
    expect(r.unlockMethod).toBe('password')
    expect(r.kdf.alg).toBe('argon2id')
    expect(r.encrypted.data).not.toBe(before.encrypted.data)
    expect(r.encrypted.salt).not.toBe(before.encrypted.salt)
    expect((await unlockColdVaultWithPassword('a new cold password')).falcon_secret).toBe(SECRET)
  })
  it('PRF available: re-wraps under PRF and overwrites the weak blob', async () => {
    const before = await writeLegacyPasskeyVault()
    setAuthenticator({ rawId: RAW_ID, prfSecret: new Uint8Array(32).fill(6) })
    const a = await assertColdPasskey(before.credentialId)
    const res = await migrateLegacyPasskeyVault({ assertedRawId: a.rawId, prfOutput: a.prfOutput })
    expect(res.method).toBe('passkey')
    const r = await raw()
    expect(r.hasPrf).toBe(true)
    expect(r.encrypted.data).not.toBe(before.encrypted.data)
    expect(isLegacyWeakPasskeyRecord(r)).toBe(false)
    await expect(unlockColdVaultWithPasskey(RAW_ID)).rejects.toThrow('Passkey unlock failed')
    expect((await unlockColdVaultWithPasskey((await assertColdPasskey(before.credentialId)).prfOutput)).falcon_secret).toBe(SECRET)
  })
})
