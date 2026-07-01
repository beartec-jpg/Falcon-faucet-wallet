/**
 * Encrypted wallet backup files for client-side restore.
 * Avoids manual entry of the 4k+ character Falcon hex secret.
 */

export const BACKUP_TYPE = 'qxrp-falcon-wallet-backup'
export const BACKUP_VERSION = 1

export interface BackupPayload {
  falcon_secret: string
  address: string
  publicKey: string
  label: string
  createdAt: number
}

export interface EncryptedBackupFile {
  version: typeof BACKUP_VERSION
  type: typeof BACKUP_TYPE
  encrypted: true
  address: string
  label: string
  createdAt: number
  payload: {
    data: string
    iv: string
    salt: string
  }
}

export interface PlainBackupFile extends BackupPayload {
  version: typeof BACKUP_VERSION
  type: typeof BACKUP_TYPE
  encrypted: false
}

export type WalletBackupFile = EncryptedBackupFile | PlainBackupFile

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
  if (passphrase.length < 8) return 'Backup password must be at least 8 characters'
  return null
}

export async function createEncryptedBackup(
  payload: BackupPayload,
  passphrase: string,
): Promise<EncryptedBackupFile> {
  const err = validateBackupPassphrase(passphrase)
  if (err) throw new Error(err)

  const salt = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await derivePassphraseKey(passphrase, salt)
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  )

  return {
    version: BACKUP_VERSION,
    type: BACKUP_TYPE,
    encrypted: true,
    address: payload.address,
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
    return JSON.parse(new TextDecoder().decode(dec)) as BackupPayload
  } catch {
    throw new Error('Wrong backup password or corrupted backup file')
  }
}

export function parseBackupFile(raw: unknown): WalletBackupFile {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid backup file')
  const file = raw as Record<string, unknown>
  if (file.type !== BACKUP_TYPE) throw new Error('Not a Falcon Ledger wallet backup file')
  if (file.version !== BACKUP_VERSION) throw new Error('Unsupported backup version')

  if (file.encrypted === true) {
    const payload = file.payload as EncryptedBackupFile['payload'] | undefined
    if (!payload?.data || !payload?.iv || !payload?.salt || typeof file.address !== 'string') {
      throw new Error('Invalid encrypted backup file')
    }
    return file as unknown as EncryptedBackupFile
  }

  if (typeof file.falcon_secret !== 'string') throw new Error('Invalid backup file')
  return file as unknown as PlainBackupFile
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
    text: `Backup for ${file.address}`,
  })
  return true
}