/**
 * Encrypted wallet backup files for client-side restore.
 * One file = Falcon + multi-chain deposit keys (EVM + BTC + classic XRPL).
 * v1 Falcon only · v2 + EVM · v3 + BTC · v4 + classic XRPL XRP (PBKDF2, addresses in clear; import only)
 * v5 sealed (audit M-4): Argon2id + AES-GCM with the header as AAD; no addresses or labels outside
 *    the ciphertext. All new backups are v5.
 */

import { isSealedPayload, openBackup, sealBackup, type SealedPayload } from '@/lib/backup-crypto'

export const BACKUP_TYPE = 'qxrp-falcon-wallet-backup'
export const BACKUP_VERSION_SEALED = 5
export const BACKUP_VERSION = 4
export const BACKUP_VERSION_V3 = 3
export const BACKUP_VERSION_V2 = 2
export const BACKUP_VERSION_LEGACY = 1

export interface BackupPayload {
  falcon_secret: string
  address: string
  /** FPL account name when the name is the account */
  accountName?: string
  publicKey: string
  label: string
  createdAt: number
  /** EVM private key (64-char hex, no 0x) — ETH + BNB deposit wallet */
  evm_private_key?: string
  /** Checksummed 0x… address */
  evm_address?: string
  /** Bitcoin private key (64-char hex, no 0x) */
  btc_private_key?: string
  /** Bitcoin testnet P2PKH (m…/n…) */
  btc_address?: string
  /** Bitcoin mainnet P2PKH (1…) */
  btc_address_mainnet?: string
  /** Classic XRPL family seed (s…) — not Falcon-512 */
  xrpl_classic_seed?: string
  xrpl_classic_address?: string
  xrpl_classic_public_key?: string
}

/** v1–v4 (read-only). */
export interface LegacyEncryptedBackupFile {
  version: 1 | 2 | 3 | 4
  type: typeof BACKUP_TYPE
  encrypted: true
  address: string
  accountName?: string
  /** EVM deposit address (outer metadata) */
  evm_address?: string
  /** BTC testnet address (outer metadata) */
  btc_address?: string
  /** Classic XRPL r… (outer metadata) */
  xrpl_classic_address?: string
  label: string
  createdAt: number
  payload: {
    data: string
    iv: string
    salt: string
  }
}

/** v5: only type/version/KDF params are visible. */
export interface SealedBackupFile {
  version: typeof BACKUP_VERSION_SEALED
  type: typeof BACKUP_TYPE
  encrypted: true
  payload: SealedPayload
}

export type EncryptedBackupFile = LegacyEncryptedBackupFile | SealedBackupFile
export type WalletBackupFile = EncryptedBackupFile

export function isSealedBackupFile(f: EncryptedBackupFile): f is SealedBackupFile {
  return f.version === BACKUP_VERSION_SEALED
}

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

export function validateBackupPassphrase(passphrase: string): string | null {
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

function backupVersionForPayload(payload: BackupPayload): number {
  if (payload.xrpl_classic_seed && payload.xrpl_classic_address) return BACKUP_VERSION // 4
  if (payload.btc_private_key && payload.btc_address) return BACKUP_VERSION_V3
  if (payload.evm_private_key && payload.evm_address) return BACKUP_VERSION_V2
  return BACKUP_VERSION_LEGACY
}

export async function createEncryptedBackup(
  payload: BackupPayload,
  passphrase: string,
): Promise<SealedBackupFile> {
  const err = validateBackupPassphrase(passphrase)
  if (err) throw new Error(err)

  const version = backupVersionForPayload(payload)
  if (version >= BACKUP_VERSION_V2 && (!payload.evm_private_key || !payload.evm_address)) {
    throw new Error('Multi-chain EVM keys are required for wallet backup')
  }

  if (!payload.falcon_secret || !payload.address) throw new Error('Invalid backup payload')
  return {
    version: BACKUP_VERSION_SEALED,
    type: BACKUP_TYPE,
    encrypted: true,
    payload: await sealBackup(BACKUP_TYPE, BACKUP_VERSION_SEALED, payload, passphrase),
  }
}

export async function decryptBackupFile(
  file: EncryptedBackupFile,
  passphrase: string,
): Promise<BackupPayload> {
  if (isSealedBackupFile(file)) {
    const payload = await openBackup<BackupPayload>(BACKUP_TYPE, BACKUP_VERSION_SEALED, file.payload, passphrase)
    if (typeof payload?.falcon_secret !== 'string' || typeof payload.address !== 'string') {
      throw new Error('Backup file integrity check failed')
    }
    return payload
  }
  return decryptLegacyBackupFile(file, passphrase)
}

async function decryptLegacyBackupFile(
  file: LegacyEncryptedBackupFile,
  passphrase: string,
): Promise<BackupPayload> {
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
    const payload = JSON.parse(new TextDecoder().decode(dec)) as BackupPayload
    if (payload.address !== file.address) {
      throw new Error('Backup file integrity check failed')
    }
    if (file.evm_address) {
      if (!payload.evm_address || payload.evm_address.toLowerCase() !== file.evm_address.toLowerCase()) {
        throw new Error('Backup file integrity check failed')
      }
    }
    return payload
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'Backup file integrity check failed') throw e
    throw new Error('Wrong backup password or corrupted backup file')
  }
}

export function parseBackupFile(raw: unknown): WalletBackupFile {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid backup file')
  const file = raw as Record<string, unknown>
  if (file.type !== BACKUP_TYPE) throw new Error('Not a Falcon Ledger wallet backup file')
  const ver = Number(file.version)
  if (ver === BACKUP_VERSION_SEALED) {
    if (file.encrypted !== true || !isSealedPayload(file.payload)) throw new Error('Invalid encrypted backup file')
    return file as unknown as SealedBackupFile
  }
  if (
    ver !== BACKUP_VERSION &&
    ver !== BACKUP_VERSION_V3 &&
    ver !== BACKUP_VERSION_V2 &&
    ver !== BACKUP_VERSION_LEGACY
  ) {
    throw new Error('Unsupported backup version')
  }

  if (file.encrypted !== true) {
    throw new Error('Unencrypted backup files are not supported. Restore from a passphrase-encrypted backup.')
  }

  const payload = file.payload as LegacyEncryptedBackupFile['payload'] | undefined
  if (!payload?.data || !payload?.iv || !payload?.salt || typeof file.address !== 'string') {
    throw new Error('Invalid encrypted backup file')
  }
  return file as unknown as LegacyEncryptedBackupFile
}

export function backupHasBridgeKeys(payload: BackupPayload): boolean {
  return !!(payload.evm_private_key && payload.evm_address)
}

export function backupHasBtcKeys(payload: BackupPayload): boolean {
  return !!(payload.btc_private_key && payload.btc_address)
}

export function backupHasXrplClassicKeys(payload: BackupPayload): boolean {
  return !!(payload.xrpl_classic_seed && payload.xrpl_classic_address)
}

export function backupFilename(file: WalletBackupFile | string): string {
  if (typeof file === 'string') {
    const slug = file.replace(/[^a-z0-9._-]+/gi, '-').slice(0, 24) || 'wallet'
    return `falcon-multi-backup-${slug}.json`
  }
  if (isSealedBackupFile(file)) {
    // No account name or address in the file name either (M-4).
    return `falcon-multi-backup-${new Date().toISOString().slice(0, 10)}.json`
  }
  const slug = (file.accountName || file.label || file.address || 'wallet')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .slice(0, 24)
  return `falcon-multi-backup-${slug}.json`
}

export function downloadBackup(file: WalletBackupFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = backupFilename(file)
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4_000)
}

export async function shareBackup(file: WalletBackupFile): Promise<boolean> {
  if (!navigator.share || !navigator.canShare) return false
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const shareFile = new File([blob], backupFilename(file), { type: 'application/json' })
  if (!navigator.canShare({ files: [shareFile] })) return false
  await navigator.share({
    files: [shareFile],
    title: 'Falcon & multi wallet backup',
    text: isSealedBackupFile(file) ? 'Encrypted Falcon wallet backup' : `Backup for ${file.accountName || file.address}`,
  })
  return true
}