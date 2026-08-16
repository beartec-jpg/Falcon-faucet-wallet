/**
 * Encrypted vault export files for cold-signer handoff.
 *
 * Outer JSON is public (address, publicKey, label) so the hot portal can
 * register a public vault record without ever decrypting the secret.
 * Inner payload holds falcon_secret — only for cold import / offline SD recovery.
 *
 * Distinct from hot wallet backup (`qxrp-falcon-wallet-backup`) — vault files
 * do NOT require Sepolia bridge keys.
 */

export const VAULT_EXPORT_TYPE = 'falcon-vault-export'
export const VAULT_EXPORT_VERSION = 1 as const

export interface VaultInnerPayload {
  falcon_secret: string
  address: string
  publicKey: string
  label: string
  createdAt: number
  accountName?: string
  payoutAddress?: string
  kind?: 'cold' | 'browser'
}

export interface EncryptedVaultFile {
  version: typeof VAULT_EXPORT_VERSION
  type: typeof VAULT_EXPORT_TYPE
  encrypted: true
  address: string
  publicKey: string
  label: string
  createdAt: number
  accountName?: string
  payoutAddress?: string
  kind?: 'cold' | 'browser'
  /** Optional short fingerprint for UI display */
  fingerprint?: string
  payload: {
    data: string
    iv: string
    salt: string
  }
}

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  bytes.forEach((b) => {
    bin += String.fromCharCode(b)
  })
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

/** Same rules as wallet backup passphrases. */
export function validateVaultPassphrase(passphrase: string): string | null {
  if (passphrase.length < 12) return 'Vault password must be at least 12 characters'
  const classes = [
    /[a-z]/.test(passphrase),
    /[A-Z]/.test(passphrase),
    /[0-9]/.test(passphrase),
    /[^A-Za-z0-9]/.test(passphrase),
  ].filter(Boolean).length
  if (classes < 3) {
    return 'Vault password must contain at least 3 of: uppercase, lowercase, numbers, and symbols'
  }
  return null
}

/** Short hex fingerprint from address+publicKey for UI confirmation. */
export async function vaultFingerprint(address: string, publicKey: string): Promise<string> {
  const data = new TextEncoder().encode(`${address}:${publicKey}`)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash).slice(0, 4), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

export async function createEncryptedVaultFile(
  inner: VaultInnerPayload,
  passphrase: string,
): Promise<EncryptedVaultFile> {
  const err = validateVaultPassphrase(passphrase)
  if (err) throw new Error(err)
  if (!inner.falcon_secret || !inner.address || !inner.publicKey) {
    throw new Error('Invalid vault payload')
  }

  const salt = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await derivePassphraseKey(passphrase, salt)
  const enc = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer,
    },
    key,
    new TextEncoder().encode(JSON.stringify(inner)),
  )

  const fingerprint = await vaultFingerprint(inner.address, inner.publicKey)

  return {
    version: VAULT_EXPORT_VERSION,
    type: VAULT_EXPORT_TYPE,
    encrypted: true,
    address: inner.address,
    publicKey: inner.publicKey,
    label: inner.label,
    createdAt: inner.createdAt,
    accountName: inner.accountName,
    payoutAddress: inner.payoutAddress,
    kind: inner.kind ?? 'cold',
    fingerprint,
    payload: {
      data: toBase64(enc),
      iv: toBase64(iv),
      salt: toBase64(salt),
    },
  }
}

export async function decryptVaultFile(
  file: EncryptedVaultFile,
  passphrase: string,
): Promise<VaultInnerPayload> {
  const salt = fromBase64(file.payload.salt)
  const iv = fromBase64(file.payload.iv)
  const key = await derivePassphraseKey(passphrase, salt)
  try {
    const dec = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer,
      },
      key,
      (() => {
        const b = fromBase64(file.payload.data)
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
      })(),
    )
    const payload = JSON.parse(new TextDecoder().decode(dec)) as VaultInnerPayload
    if (payload.address !== file.address || payload.publicKey !== file.publicKey) {
      throw new Error('Vault file integrity check failed')
    }
    return payload
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'Vault file integrity check failed') throw e
    throw new Error('Wrong vault password or corrupted vault file')
  }
}

export function parseVaultFile(raw: unknown): EncryptedVaultFile {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid vault file')
  const file = raw as Record<string, unknown>
  if (file.type !== VAULT_EXPORT_TYPE) {
    throw new Error('Not a Falcon vault export file')
  }
  if (file.version !== VAULT_EXPORT_VERSION) {
    throw new Error('Unsupported vault export version')
  }
  if (file.encrypted !== true) {
    throw new Error('Unencrypted vault files are not supported')
  }
  const payload = file.payload as EncryptedVaultFile['payload'] | undefined
  if (
    !payload?.data ||
    !payload?.iv ||
    !payload?.salt ||
    typeof file.address !== 'string' ||
    typeof file.publicKey !== 'string'
  ) {
    throw new Error('Invalid encrypted vault file')
  }
  return file as unknown as EncryptedVaultFile
}

/** Public fields only — safe to store on the hot portal. */
export function publicFromVaultFile(file: EncryptedVaultFile): {
  address: string
  publicKey: string
  label: string
  createdAt: number
  fingerprint?: string
  accountName?: string
  payoutAddress?: string
  kind?: 'cold' | 'browser'
} {
  return {
    address: file.address,
    publicKey: file.publicKey,
    label: file.label || 'Vault',
    createdAt: file.createdAt || Date.now(),
    fingerprint: file.fingerprint,
    accountName: file.accountName,
    payoutAddress: file.payoutAddress,
    kind: file.kind ?? 'cold',
  }
}

export function vaultFilename(file: EncryptedVaultFile | string): string {
  const slug =
    typeof file === 'string'
      ? file
      : file.accountName || file.label || file.address
  const safe = slug.replace(/[^a-z0-9._-]+/gi, '-').slice(0, 24) || 'vault'
  return `falcon-vault-${safe}.json`
}

export function downloadVaultFile(file: EncryptedVaultFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = vaultFilename(file)
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4_000)
}
