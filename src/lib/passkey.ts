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
 *  • Optional two-factor mode 'prf+password': KEK = HKDF(PRF || Argon2id(password)), so a
 *    broken P-256 passkey alone cannot unlock the keys. Added at creation or later from settings.
 */

import {
  newPasswordKdfParams,
  walletKeyFromPassword,
  walletKeyFromPrf,
  walletKeyFromPrfAndPassword,
  validateWalletPassword,
  WalletKeyError,
  type WalletKey,
} from '@/lib/wallet-key'
import { decryptSeed, encryptSeed } from '@/lib/wallet-crypto'
import { KEK_CHECK_PLAINTEXT, loadKekRecord, saveKekRecord, type KekRecord } from '@/lib/kek-store'
import { PasswordPromptCancelled, promptWalletPassword, type PasswordPromptMode } from '@/lib/password-prompt'
import { hasLegacyBlobs, migrateLegacyBlobs, rewrapAllBlobs } from '@/lib/wallet-migrate'

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

async function createCombinedKek(credentialId: string, prfKey: WalletKey, password: string): Promise<WalletKey> {
  const problem = validateWalletPassword(password)
  if (problem) throw new WalletKeyError(problem)
  const kdf = newPasswordKdfParams()
  const key = await walletKeyFromPrfAndPassword(prfKey, await walletKeyFromPassword(password, kdf))
  const check = await encryptSeed(KEK_CHECK_PLAINTEXT, key)
  await saveKekRecord({ credentialId, mode: 'prf+password', kdf, check, createdAt: Date.now() })
  return key
}

async function unlockCombinedKek(rec: KekRecord, prfKey: WalletKey): Promise<WalletKey> {
  if (!rec.kdf || !rec.check) throw new WalletKeyError('Wallet password record is incomplete')
  let error: string | undefined
  for (let attempt = 0; attempt < 5; attempt++) {
    const pw = await promptWalletPassword({ mode: 'enter', error })
    const key = await walletKeyFromPrfAndPassword(prfKey, await walletKeyFromPassword(pw, rec.kdf))
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
export async function registerPasskey(
  label: string,
  opts: { offerPassword?: boolean } = {},
): Promise<PasskeyRegistration> {
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
    const prfKey = walletKeyFromPrf(prf)
    if (opts.offerPassword) {
      // Optional second factor, offered right after the passkey step (ticked by default).
      let pw = ''
      try {
        pw = await promptWalletPassword({ mode: 'add-optional' })
      } catch (e) {
        if (!(e instanceof PasswordPromptCancelled)) throw e
      }
      if (pw) return { credentialId, keyBytes: await createCombinedKek(credentialId, prfKey, pw), hasPrf: true }
    }
    await saveKekRecord({ credentialId, mode: 'prf', createdAt: Date.now() })
    return { credentialId, keyBytes: prfKey, hasPrf: true }
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
  if (rec?.mode === 'prf+password') {
    if (!prf) throw new PrfUnavailableError()
    key = await unlockCombinedKek(rec, walletKeyFromPrf(prf))
  } else if (rec?.mode === 'password') {
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
  return { keyBytes: key, hasPrf: key.source !== 'password' }
}

// ─── Add / remove the wallet password on a PRF wallet ───────────────────────

/** 'prf' | 'password' | 'prf+password' for this credential, or null if unknown. */
export async function walletKekMode(credentialId: string): Promise<KekRecord['mode'] | null> {
  return (await loadKekRecord(credentialId))?.mode ?? null
}

/**
 * Settings → "Add password": unlock with the passkey (PRF), then re-encrypt every stored key
 * for this credential under HKDF(PRF || Argon2id(password)). Plaintext stays in memory only.
 */
export async function addWalletPassword(credentialId: string, password: string): Promise<void> {
  const problem = validateWalletPassword(password)
  if (problem) throw new WalletKeyError(problem)
  const rec = await loadKekRecord(credentialId)
  if (rec?.mode === 'prf+password') throw new WalletKeyError('This wallet already has a password')
  if (rec?.mode === 'password') throw new WalletKeyError('This wallet is already password-protected (no passkey PRF)')
  const { keyBytes: oldKey } = await authenticatePasskey(credentialId, true)
  if (oldKey.source !== 'prf') throw new WalletKeyError('Adding a password needs a passkey with PRF')
  const kdf = newPasswordKdfParams()
  const newKey = await walletKeyFromPrfAndPassword(oldKey, await walletKeyFromPassword(password, kdf))
  const check = await encryptSeed(KEK_CHECK_PLAINTEXT, newKey)
  await rewrapAllBlobs(credentialId, oldKey, newKey)
  await saveKekRecord({ credentialId, mode: 'prf+password', kdf, check, createdAt: Date.now() })
}

/**
 * Remove the wallet password: requires a full successful unlock (passkey PRF + current password),
 * then re-encrypts every stored key back under the PRF key alone.
 */
export async function removeWalletPassword(credentialId: string): Promise<void> {
  const rec = await loadKekRecord(credentialId)
  if (rec?.mode !== 'prf+password') throw new WalletKeyError('This wallet has no passkey + password protection')
  const cred = await getAssertion(credentialId)
  const prf = prfResult(cred)
  if (!prf) throw new PrfUnavailableError()
  const prfKey = walletKeyFromPrf(prf)
  const oldKey = await unlockCombinedKek(rec, prfKey)
  await rewrapAllBlobs(credentialId, oldKey, prfKey)
  await saveKekRecord({ credentialId, mode: 'prf', createdAt: Date.now() })
}

/** Change the wallet password: needs passkey PRF + current password, then re-wraps under the new one. */
export async function changeWalletPassword(credentialId: string, newPassword: string): Promise<void> {
  const problem = validateWalletPassword(newPassword)
  if (problem) throw new WalletKeyError(problem)
  const rec = await loadKekRecord(credentialId)
  if (rec?.mode !== 'prf+password') throw new WalletKeyError('This wallet has no passkey + password protection')
  const prf = prfResult(await getAssertion(credentialId))
  if (!prf) throw new PrfUnavailableError()
  const prfKey = walletKeyFromPrf(prf)
  const oldKey = await unlockCombinedKek(rec, prfKey)
  const kdf = newPasswordKdfParams()
  const newKey = await walletKeyFromPrfAndPassword(prfKey, await walletKeyFromPassword(newPassword, kdf))
  const check = await encryptSeed(KEK_CHECK_PLAINTEXT, newKey)
  await rewrapAllBlobs(credentialId, oldKey, newKey)
  await saveKekRecord({ credentialId, mode: 'prf+password', kdf, check, createdAt: Date.now() })
}
