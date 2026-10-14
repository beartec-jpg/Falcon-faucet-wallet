/**
 * Encrypted Sepolia EVM wallet backup (private key hex, not a mnemonic phrase).
 */

export const EVM_BACKUP_TYPE = 'qxrp-sepolia-wallet-backup'
export const EVM_BACKUP_VERSION = 1
/** v2 sealed (audit M-4): Argon2id + AES-GCM, header as AAD, no address outside the ciphertext. */
export const EVM_BACKUP_VERSION_SEALED = 2

export interface EvmBackupPayload {
  evm_private_key: string
  evm_address: string
  falcon_address?: string
  label: string
  createdAt: number
}

export interface EncryptedEvmBackupFile {
  version: typeof EVM_BACKUP_VERSION
  type: typeof EVM_BACKUP_TYPE
  encrypted: true
  evm_address: string
  label: string
  createdAt: number
  payload: {
    data: string
    iv: string
    salt: string
  }
}

export interface PlainEvmBackupFile extends EvmBackupPayload {
  version: typeof EVM_BACKUP_VERSION
  type: typeof EVM_BACKUP_TYPE
  encrypted: false
}

export interface SealedEvmBackupFile {
  version: typeof EVM_BACKUP_VERSION_SEALED
  type: typeof EVM_BACKUP_TYPE
  encrypted: true
  payload: SealedPayload
}

export type EvmWalletBackupFile = EncryptedEvmBackupFile | SealedEvmBackupFile | PlainEvmBackupFile

import { isSealedPayload, openBackup, sealBackup, type SealedPayload } from '@/lib/backup-crypto'

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function derivePassphraseKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      iterations: 210_000,
      hash: 'SHA-256',
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function validateEvmBackupPassphrase(passphrase: string): string | null {
  if (passphrase.length < 12) return 'Backup password must be at least 12 characters'
  const classes = [
    /[a-z]/.test(passphrase),
    /[A-Z]/.test(passphrase),
    /[0-9]/.test(passphrase),
    /[^A-Za-z0-9]/.test(passphrase),
  ].filter(Boolean).length
  if (classes < 3) {
    return 'Backup password must contain at least 3 of: uppercase, lowercase, numbers, and symbols'
  }
  return null
}

export async function createEncryptedEvmBackup(
  payload: EvmBackupPayload,
  passphrase: string,
): Promise<SealedEvmBackupFile> {
  const err = validateEvmBackupPassphrase(passphrase)
  if (err) throw new Error(err)
  return {
    version: EVM_BACKUP_VERSION_SEALED,
    type: EVM_BACKUP_TYPE,
    encrypted: true,
    payload: await sealBackup(EVM_BACKUP_TYPE, EVM_BACKUP_VERSION_SEALED, payload, passphrase),
  }
}

export async function decryptEvmBackupFile(
  file: EncryptedEvmBackupFile | SealedEvmBackupFile,
  passphrase: string,
): Promise<EvmBackupPayload> {
  if (file.version === EVM_BACKUP_VERSION_SEALED) {
    const p = await openBackup<EvmBackupPayload>(EVM_BACKUP_TYPE, EVM_BACKUP_VERSION_SEALED, file.payload, passphrase)
    if (typeof p?.evm_private_key !== 'string' || typeof p.evm_address !== 'string') {
      throw new Error('Backup file integrity check failed')
    }
    return p
  }
  const salt = fromBase64(file.payload.salt)
  const iv = fromBase64(file.payload.iv)
  const key = await derivePassphraseKey(passphrase, salt)
  try {
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer },
      key,
      (() => {
        const b = fromBase64(file.payload.data)
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
      })(),
    )
    const payload = JSON.parse(new TextDecoder().decode(dec)) as EvmBackupPayload
    if (payload.evm_address.toLowerCase() !== file.evm_address.toLowerCase()) {
      throw new Error('Backup file integrity check failed')
    }
    return payload
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'Backup file integrity check failed') throw e
    throw new Error('Wrong backup password or corrupted backup file')
  }
}

export function parseEvmBackupFile(raw: unknown): EvmWalletBackupFile {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid backup file')
  const file = raw as Record<string, unknown>
  if (file.type !== EVM_BACKUP_TYPE) throw new Error('Not a Sepolia wallet backup file')
  if (file.version === EVM_BACKUP_VERSION_SEALED) {
    if (file.encrypted !== true || !isSealedPayload(file.payload)) throw new Error('Invalid encrypted backup file')
    return file as unknown as SealedEvmBackupFile
  }
  if (file.version !== EVM_BACKUP_VERSION) throw new Error('Unsupported backup version')

  if (file.encrypted === true) {
    const payload = file.payload as EncryptedEvmBackupFile['payload'] | undefined
    if (!payload?.data || !payload?.iv || !payload?.salt || typeof file.evm_address !== 'string') {
      throw new Error('Invalid encrypted backup file')
    }
    return file as unknown as EncryptedEvmBackupFile
  }

  if (typeof file.evm_private_key !== 'string') throw new Error('Invalid backup file')
  return file as unknown as PlainEvmBackupFile
}

export function evmBackupFilename(address: string): string {
  return `sepolia-backup-${address.slice(2, 12)}.json`
}

export function downloadEvmBackup(file: EvmWalletBackupFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download =
    'evm_address' in file && typeof file.evm_address === 'string'
      ? evmBackupFilename(file.evm_address)
      : `sepolia-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** Normalize pasted key: strip 0x, validate 64 hex chars. */
export function normalizeEvmPrivateKey(input: string): string | null {
  const raw = input.trim().replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return null
  return raw.toLowerCase()
}