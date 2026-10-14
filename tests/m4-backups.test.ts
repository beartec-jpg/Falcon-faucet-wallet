/** Audit M-4: new backups use Argon2id + AAD and expose no addresses; old files still import. */
import { describe, expect, it } from 'vitest'
import { createEncryptedBackup, decryptBackupFile, parseBackupFile, backupFilename } from '@/lib/wallet-backup'
import { createEncryptedEvmBackup, decryptEvmBackupFile, parseEvmBackupFile } from '@/lib/evm-wallet-backup'
import { createEncryptedVaultFile, decryptVaultFile, parseVaultFile, publicFromVaultFile } from '@/lib/vault-export'
import * as legacyWallet from './fixtures/legacy-wallet-backup'
import * as legacyEvm from './fixtures/legacy-evm-backup'
import * as legacyVault from './fixtures/legacy-vault-export'

const PW = 'Backup-Pass-2026!'
const payload = {
  falcon_secret: 'fb' + 'ab'.repeat(2177),
  address: 'rFalconAddressXYZ123',
  accountName: 'scott-test',
  publicKey: 'fb' + '11'.repeat(897),
  label: 'My wallet',
  createdAt: 1_700_000_000_000,
  evm_private_key: '22'.repeat(32),
  evm_address: '0x1234567890abcdef1234567890ABCDEF12345678',
  btc_private_key: '33'.repeat(32),
  btc_address: 'mBtcTestAddr123',
  btc_address_mainnet: '1BtcMainAddr123',
  xrpl_classic_seed: 'sEdSeed',
  xrpl_classic_address: 'rClassicAddr',
}

describe('wallet backup v5', () => {
  it('round-trips and exposes no address, name or label', async () => {
    const file = await createEncryptedBackup(payload, PW)
    expect(file.version).toBe(5)
    const json = JSON.stringify(file)
    for (const v of [payload.address, payload.accountName, payload.label, payload.evm_address, payload.btc_address, payload.xrpl_classic_address, payload.evm_address.toLowerCase()]) {
      expect(json).not.toContain(v)
    }
    expect(backupFilename(file)).not.toContain('scott')
    expect(file.payload.kdf).toMatchObject({ alg: 'argon2id', m: 47104, t: 2, p: 1 })
    expect(atob(file.payload.kdf.salt).length).toBe(16)
    const out = await decryptBackupFile(parseBackupFile(JSON.parse(json)), PW)
    expect(out).toEqual(payload)
  })
  it('wrong password fails', async () => {
    const file = await createEncryptedBackup(payload, PW)
    await expect(decryptBackupFile(file, PW + 'x')).rejects.toThrow(/Wrong backup password/)
  })
  it('header is authenticated: KDF downgrade or version swap fails', async () => {
    const file = await createEncryptedBackup(payload, PW)
    const downgraded = JSON.parse(JSON.stringify(file))
    downgraded.payload.kdf.t = 3
    await expect(decryptBackupFile(downgraded, PW)).rejects.toThrow()
    const weak = JSON.parse(JSON.stringify(file))
    weak.payload.kdf.m = 1024
    await expect(decryptBackupFile(weak, PW)).rejects.toThrow()
  })
  it('two backups never share salt or IV', async () => {
    const a = await createEncryptedBackup(payload, PW)
    const b = await createEncryptedBackup(payload, PW)
    expect(a.payload.kdf.salt).not.toBe(b.payload.kdf.salt)
    expect(a.payload.iv).not.toBe(b.payload.iv)
  })
  it('legacy v4 (PBKDF2) files still import', async () => {
    const old = await legacyWallet.createEncryptedBackup(payload, PW)
    expect(old.version).toBe(4)
    const out = await decryptBackupFile(parseBackupFile(JSON.parse(JSON.stringify(old))), PW)
    expect(out.falcon_secret).toBe(payload.falcon_secret)
  })
})

describe('EVM backup v2', () => {
  const evm = { evm_private_key: '44'.repeat(32), evm_address: '0xAbCdEf0000000000000000000000000000001234', falcon_address: 'rF', label: 'Sepolia', createdAt: 1 }
  it('round-trips, no address outside, legacy v1 imports', async () => {
    const f = await createEncryptedEvmBackup(evm, PW)
    expect(JSON.stringify(f)).not.toMatch(/AbCdEf|abcdef0000/i)
    const p = parseEvmBackupFile(JSON.parse(JSON.stringify(f)))
    if (!p.encrypted) throw new Error('expected encrypted')
    expect(await decryptEvmBackupFile(p, PW)).toEqual(evm)
    const old = await legacyEvm.createEncryptedEvmBackup(evm, PW)
    const po = parseEvmBackupFile(JSON.parse(JSON.stringify(old)))
    if (!po.encrypted) throw new Error('expected encrypted')
    expect((await decryptEvmBackupFile(po, PW)).evm_private_key).toBe(evm.evm_private_key)
  })
})

describe('vault export v2', () => {
  const inner = { falcon_secret: 'fb' + 'cd'.repeat(10), address: 'rVault', publicKey: 'pk', label: 'Cold', createdAt: 5, kind: 'cold' as const }
  it('Argon2id, header bound by AAD, public fields kept for watch-only import, v1 imports', async () => {
    const f = await createEncryptedVaultFile(inner, PW)
    expect(f.version).toBe(2)
    expect(publicFromVaultFile(f).address).toBe('rVault')
    expect(await decryptVaultFile(parseVaultFile(JSON.parse(JSON.stringify(f))), PW)).toEqual(inner)
    const swapped = { ...f, address: 'rAttacker' }
    await expect(decryptVaultFile(swapped, PW)).rejects.toThrow(/integrity/)
    const old = await legacyVault.createEncryptedVaultFile(inner, PW)
    expect((await decryptVaultFile(parseVaultFile(JSON.parse(JSON.stringify(old))), PW)).falcon_secret).toBe(inner.falcon_secret)
  })
})
