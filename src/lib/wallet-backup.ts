/**
 * Encrypted wallet backup files for client-side restore.
 * One file = Falcon + multi-chain deposit keys (EVM + BTC).
 * v1 Falcon only · v2 + EVM · v3 + BTC (optional fields; restore accepts 1–3).
 */

export const BACKUP_TYPE = 'qxrp-falcon-wallet-backup'
export const BACKUP_VERSION = 3
export const BACKUP_VERSION_V2 = 2
export const BACKUP_VERSION_LEGACY = 1

export interface BackupPayload {
  falcon_secret: string
  address: string
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
}

export interface EncryptedBackupFile {
  version: number
  type: typeof BACKUP_TYPE
  encrypted: true
  address: string
  /** EVM deposit address (outer metadata) */
  evm_address?: string
  /** BTC testnet address (outer metadata) */
  btc_address?: string
  label: string
  createdAt: number
  payload: {
    data: string
    iv: string
    salt: string
  }
}

export type WalletBackupFile = EncryptedBackupFile

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  bytes.forEach(b => (bin += String.fromCharCode(b)))
  return btoa(bin)
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
  if (payload.btc_private_key && payload.btc_address) return BACKUP_VERSION // 3
  if (payload.evm_private_key && payload.evm_address) return BACKUP_VERSION_V2
  return BACKUP_VERSION_LEGACY
}

export async function createEncryptedBackup(
  payload: BackupPayload,
  passphrase: string,
): Promise<EncryptedBackupFile> {
  const err = validateBackupPassphrase(passphrase)
  if (err) throw new Error(err)

  const version = backupVersionForPayload(payload)
  if (version >= BACKUP_VERSION_V2 && (!payload.evm_private_key || !payload.evm_address)) {
    throw new Error('Multi-chain EVM keys are required for wallet backup')
  }

  const salt = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await derivePassphraseKey(passphrase, salt)
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  )

  return {
    version,
    type: BACKUP_TYPE,
    encrypted: true,
    address: payload.address,
    evm_address: payload.evm_address,
    btc_address: payload.btc_address,
    label: payload.label,
    createdAt: payload.createdAt,
    payload: {
      data: toBase64(enc),
      iv: toBase64(iv),
      salt: toBase64(salt),
    },
  }
}

export async function decryptBackupFile(
  file: EncryptedBackupFile,
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
  if (ver !== BACKUP_VERSION && ver !== BACKUP_VERSION_V2 && ver !== BACKUP_VERSION_LEGACY) {
    throw new Error('Unsupported backup version')
  }

  if (file.encrypted !== true) {
    throw new Error('Unencrypted backup files are not supported. Restore from a passphrase-encrypted backup.')
  }

  const payload = file.payload as EncryptedBackupFile['payload'] | undefined
  if (!payload?.data || !payload?.iv || !payload?.salt || typeof file.address !== 'string') {
    throw new Error('Invalid encrypted backup file')
  }
  return file as unknown as EncryptedBackupFile
}

export function backupHasBridgeKeys(payload: BackupPayload): boolean {
  return !!(payload.evm_private_key && payload.evm_address)
}

export function backupHasBtcKeys(payload: BackupPayload): boolean {
  return !!(payload.btc_private_key && payload.btc_address)
}

export function backupFilename(address: string): string {
  return `falcon-backup-${address.slice(0, 10)}.json`
}

export function downloadBackup(file: WalletBackupFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = backupFilename(file.address)
  a.click()
  URL.revokeObjectURL(url)
}

export async function shareBackup(file: WalletBackupFile): Promise<boolean> {
  if (!navigator.share || !navigator.canShare) return false
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const shareFile = new File([blob], backupFilename(file.address), { type: 'application/json' })
  if (!navigator.canShare({ files: [shareFile] })) return false
  await navigator.share({
    files: [shareFile],
    title: 'Falcon Ledger wallet backup',
    text: `Backup for ${file.address}${file.evm_address ? ` + EVM ${file.evm_address}` : ''}${file.btc_address ? ` + BTC ${file.btc_address}` : ''}`,
  })
  return true
}