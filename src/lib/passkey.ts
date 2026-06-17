/**
 * WebAuthn passkey helpers for qXRP wallet.
 *
 * Security model:
 *  • Prefers the PRF extension (strong key material tied to the passkey private key).
 *  • Falls back to credential rawId when PRF is unavailable.
 *
 * WARNING (M-2 from audit): The rawId fallback is weaker (semi-public data).
 * Acceptable only for testnet. Do not use these wallets with real funds.
 *
 * All functions are browser-only.
 */

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
    const caps = PublicKeyCredential.getClientCapabilities?.()
    if (caps && typeof caps === 'object' && 'prf' in caps) {
      return !!(caps as Record<string, unknown>).prf
    }
  } catch { /* ignore */ }
  // Assume PRF on platform authenticators in secure contexts when API is missing
  return window.isSecureContext
}

// PRF eval input — constant so every auth call returns the same key material
const PRF_INPUT = new TextEncoder().encode('qxrp-wallet-v1')

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PasskeyRegistration {
  credentialId: string   // base64url
  keyBytes: Uint8Array   // 32-byte PRF output OR rawId bytes
  hasPrf: boolean        // true → keyBytes came from PRF extension
}

export interface PasskeyAssertion {
  keyBytes: Uint8Array
  hasPrf: boolean
}

// ─── Register ─────────────────────────────────────────────────────────────────

/**
 * Register a new platform passkey and return key material for seed encryption.
 */
export async function registerPasskey(label: string): Promise<PasskeyRegistration> {
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const userId    = crypto.getRandomValues(new Uint8Array(16))
  const rpId      = window.location.hostname

  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'qXRP Wallet', id: rpId },
      user: {
        id:          userId,
        name:        label,
        displayName: label,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7  },   // ES256
        { type: 'public-key', alg: -257 },   // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification:        'required',
        residentKey:             'required',
      },
      timeout:     60_000,
      attestation: 'none',
      extensions: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(({ prf: { eval: { first: PRF_INPUT } } }) as any),
      },
    },
  }) as PublicKeyCredential | null

  if (!cred) throw new Error('Passkey creation was cancelled')

  const rawIdBytes   = new Uint8Array(cred.rawId)
  const credentialId = toBase64Url(rawIdBytes)

  // Try to extract PRF output from extension results
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ext    = (cred.getClientExtensionResults() as any)
  const prfOut = ext?.prf?.results?.first as ArrayBuffer | undefined
  const hasPrf = prfOut instanceof ArrayBuffer && prfOut.byteLength >= 32

  const keyBytes: Uint8Array = hasPrf
    ? new Uint8Array(prfOut!)
    : rawIdBytes

  return { credentialId, keyBytes, hasPrf }
}

// ─── Authenticate ─────────────────────────────────────────────────────────────

/**
 * Authenticate with an existing passkey and return the same key material
 * that was available during registration.
 */
export async function authenticatePasskey(
  credentialId: string,
  hasPrf: boolean
): Promise<PasskeyAssertion> {
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const rpId      = window.location.hostname

  const extensions: Record<string, unknown> = hasPrf
    ? { prf: { eval: { first: PRF_INPUT } } }
    : {}

  const cred = await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId,
      allowCredentials: [{
        type:       'public-key' as const,
        id:         fromBase64Url(credentialId).buffer as ArrayBuffer,
        transports: ['internal' as AuthenticatorTransport, 'hybrid' as AuthenticatorTransport],
      }],
      userVerification: 'required',
      timeout:          60_000,
      extensions,
    },
  }) as PublicKeyCredential | null

  if (!cred) throw new Error('Authentication was cancelled')

  const rawIdBytes = new Uint8Array(cred.rawId)

  if (hasPrf) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext    = (cred.getClientExtensionResults() as any)
    const prfOut = ext?.prf?.results?.first as ArrayBuffer | undefined
    if (prfOut instanceof ArrayBuffer && prfOut.byteLength >= 32) {
      return { keyBytes: new Uint8Array(prfOut), hasPrf: true }
    }
    // PRF unexpectedly unavailable on assertion — fall back to rawId
  }

  return { keyBytes: rawIdBytes, hasPrf: false }
}
