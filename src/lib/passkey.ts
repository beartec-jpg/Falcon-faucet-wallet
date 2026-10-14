/**
 * WebAuthn passkey helpers for the Falcon wallet (browser-only).
 *
 * Security model (audit H-1):
 *  • Wallet keys are wrapped either with the passkey's PRF output or, when the authenticator
 *    has no PRF, with an Argon2id key from a user password. The passkey's user-verified
 *    assertion is still required in both cases.
 *  • There is NO fallback to the credential rawId. A PRF wallet whose authenticator stops
 *    returning PRF fails closed.
 *  • Wallets saved by older builds with a rawId-derived key are migrated on the next unlock:
 *    the user must set a password (or PRF re-wrap if now available), the blobs are re-encrypted
 *    and the weak copies overwritten.
 */

import {
  newPasswordKdfParams,
  walletKeyFromPassword,
  walletKeyFromPrf,
  WalletKeyError,
  type WalletKey,
} from '@/lib/wallet-key'
import { decryptSeed, encryptSeed } from '@/lib/wallet-crypto'
import { KEK_CHECK_PLAINTEXT, loadKekRecord, saveKekRecord, type KekRecord } from '@/lib/kek-store'
import { promptWalletPassword, type PasswordPromptMode } from '@/lib/password-prompt'
import { hasLegacyBlobs, migrateLegacyBlobs } from '@/lib/wallet-migrate'

// ─── Base64url helpers ────────────────────────────────────────────────────────

export function toBase64Url(buf: Uint8Array): string {
  let bin = ''
  buf.forEach(b => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function fromBase64Url(b64: string): Uint8Array {
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// ─── Feature detection ────────────────────────────────────────────────────────

export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function'
  )
}

/** Best-effort PRF capability probe (Chrome 118+, Safari 18+). */
export function isPrfLikelySupported(): boolean {
  if (!isPasskeySupported()) return false
  try {
    const caps = (PublicKeyCredential as unknown as { getClientCapabilities?: () => unknown }).getClientCapabilities?.()
    if (caps && typeof caps === 'object' && 'prf' in caps) {
      return !!(caps as Record<string, unknown>).prf
    }
  } catch { /* ignore */ }
  return window.isSecureContext
}

// PRF eval input. Constant per app: the PRF output is already unique per credential.
const PRF_INPUT = new TextEncoder().encode('qxrp-wallet-v1')

export class PrfUnavailableError extends Error {
  constructor() {
    super(
      'Your passkey did not return its encryption key (WebAuthn PRF). This wallet is protected ' +
        'by that key, so it cannot be unlocked here. Try the same passkey on the device or browser ' +
        'you created it with, or restore from your encrypted backup.',
    )
    this.name = 'PrfUnavailableError'
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PasskeyRegistration {
  credentialId: string   // base64url
  /** Strong wallet key: PRF output or Argon2id(password). Never derived from the rawId. */
  keyBytes: WalletKey
  hasPrf: boolean
}

export interface PasskeyAssertion {
  keyBytes: WalletKey
  hasPrf: boolean
}

type PrfExt = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer | Uint8Array } } }

function prfResult(cred: PublicKeyCredential): Uint8Array | null {
  const ext = cred.getClientExtensionResults() as unknown as PrfExt
  const first = ext?.prf?.results?.first
  if (!first) return null
  const b = first instanceof Uint8Array ? first : new Uint8Array(first)
  return b.length >= 32 ? b : null
}

async function getAssertion(credentialId: string): Promise<PublicKeyCredential> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: window.location.hostname,
      allowCredentials: [{
        type: 'public-key' as const,
        id: fromBase64Url(credentialId).buffer as ArrayBuffer,
        transports: ['internal' as AuthenticatorTransport, 'hybrid' as AuthenticatorTransport],
      }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: PRF_INPUT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('Authentication was cancelled')
  return cred
}

// ─── Password-wrapped keys ───────────────────────────────────────────────────

async function createPasswordKek(credentialId: string, mode: PasswordPromptMode): Promise<WalletKey> {
  const pw = await promptWalletPassword({ mode })
  const kdf = newPasswordKdfParams()
  const key = await walletKeyFromPassword(pw, kdf)
  const check = await encryptSeed(KEK_CHECK_PLAINTEXT, key)
  await saveKekRecord({ credentialId, mode: 'password', kdf, check, createdAt: Date.now() })
  return key
}

async function unlockPasswordKek(rec: KekRecord): Promise<WalletKey> {
  if (!rec.kdf || !rec.check) throw new WalletKeyError('Wallet password record is incomplete')
  let error: string | undefined
  for (let attempt = 0; attempt < 5; attempt++) {
    const pw = await promptWalletPassword({ mode: 'enter', error })
    const key = await walletKeyFromPassword(pw, rec.kdf)
    try {
      if ((await decryptSeed(rec.check, key)) === KEK_CHECK_PLAINTEXT) return key
    } catch { /* wrong password */ }
    error = 'Wrong password, try again'
  }
  throw new WalletKeyError('Wrong wallet password')
}

// ─── Register ─────────────────────────────────────────────────────────────────

/**
 * Register a new platform passkey and return a strong wallet key. If the authenticator has no
 * PRF, the user must set a password (Argon2id); there is no weaker option.
 */
export async function registerPasskey(label: string): Promise<PasskeyRegistration> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Falcon Ledger Wallet', id: window.location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: label, displayName: label },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'required',
      },
      timeout: 60_000,
      attestation: 'none',
      extensions: { prf: { eval: { first: PRF_INPUT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('Passkey creation was cancelled')

  const credentialId = toBase64Url(new Uint8Array(cred.rawId))
  let prf = prfResult(cred)
  const ext = cred.getClientExtensionResults() as unknown as PrfExt
  if (!prf && ext?.prf?.enabled) {
    // Some authenticators only report prf.enabled at create; the value comes from get().
    prf = prfResult(await getAssertion(credentialId))
  }
  if (prf) {
    await saveKekRecord({ credentialId, mode: 'prf', createdAt: Date.now() })
    return { credentialId, keyBytes: walletKeyFromPrf(prf), hasPrf: true }
  }
  const keyBytes = await createPasswordKek(credentialId, 'create')
  return { credentialId, keyBytes, hasPrf: false }
}

// ─── Authenticate ─────────────────────────────────────────────────────────────

/**
 * Run a user-verified passkey assertion and return the wallet key.
 * @param hasPrf  the wallet's stored flag; used only when no key record exists yet.
 */
export async function authenticatePasskey(credentialId: string, hasPrf: boolean): Promise<PasskeyAssertion> {
  const cred = await getAssertion(credentialId)
  const prf = prfResult(cred)
  const rec = await loadKekRecord(credentialId)

  let key: WalletKey
  if (rec?.mode === 'password') {
    key = await unlockPasswordKek(rec)
  } else if (rec?.mode === 'prf' || (!rec && hasPrf)) {
    if (!prf) throw new PrfUnavailableError()
    key = walletKeyFromPrf(prf)
    if (!rec) await saveKekRecord({ credentialId, mode: 'prf', createdAt: Date.now() })
  } else {
    // No key record and not a PRF wallet: a pre-H-1 wallet wrapped with the rawId.
    if (prf) {
      key = walletKeyFromPrf(prf)
      await saveKekRecord({ credentialId, mode: 'prf', createdAt: Date.now() })
    } else {
      key = await createPasswordKek(credentialId, 'migrate')
    }
  }

  // Re-wrap any legacy rawId blobs left for this credential (also catches stray blobs written
  // by the old silent fallback on PRF wallets).
  if (await hasLegacyBlobs(credentialId)) {
    await migrateLegacyBlobs(credentialId, new Uint8Array(cred.rawId), key)
  }
  return { keyBytes: key, hasPrf: key.source === 'prf' }
}
