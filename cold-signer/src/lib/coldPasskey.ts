/**
 * WebAuthn passkey helpers for the cold signer.
 *
 * Password is the recommended cold unlock method (works fully offline).
 * Passkey is optional — Android Credential Manager is flaky offline and
 * often throws "unknown error while talking to the credential manager"
 * when PRF / residentKey requirements are too strict.
 */

const PRF_INPUT = new TextEncoder().encode('falcon-cold-signer-v1')

export function toBase64Url(buf: Uint8Array): string {
  let bin = ''
  buf.forEach((b) => {
    bin += String.fromCharCode(b)
  })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function fromBase64Url(b64: string): Uint8Array {
  let s = b64.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function' &&
    window.isSecureContext
  )
}

export interface ColdPasskeyReg {
  credentialId: string
  keyBytes: Uint8Array
  hasPrf: boolean
}

/** Map browser/WebAuthn failures to something the user can act on. */
export function formatPasskeyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const name = e instanceof Error ? e.name : ''
  const lower = msg.toLowerCase()

  if (
    lower.includes('credential manager') ||
    lower.includes('unknown error occurred while talking')
  ) {
    return (
      'Passkey/credential manager failed on this device (common offline or on some Android builds). ' +
      'Use Password to protect this vault instead — switch to Password above and import again.'
    )
  }
  if (name === 'NotAllowedError' || lower.includes('not allowed') || lower.includes('timed out')) {
    return 'Passkey was cancelled or timed out. Try again, or use Password unlock instead.'
  }
  if (name === 'InvalidStateError' || lower.includes('already registered')) {
    return 'A passkey may already exist for this app. Use Password unlock, or wipe and retry.'
  }
  if (name === 'NotSupportedError' || lower.includes('not supported')) {
    return 'Passkeys are not supported here. Use Password unlock instead.'
  }
  if (name === 'SecurityError') {
    return 'Passkey blocked by browser security (secure context / domain). Use Password unlock instead.'
  }
  return msg || 'Passkey registration failed. Use Password unlock instead.'
}

async function createCredential(opts: {
  withPrf: boolean
  platformOnly: boolean
  resident: 'required' | 'preferred' | 'discouraged'
  label: string
}): Promise<PublicKeyCredential> {
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const userId = crypto.getRandomValues(new Uint8Array(16))
  const rpId = window.location.hostname

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extensions: any = opts.withPrf
    ? { prf: { eval: { first: PRF_INPUT } } }
    : undefined

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'Falcon Cold Signer', id: rpId },
      user: {
        id: userId,
        name: `cold-vault@${rpId}`,
        displayName: opts.label.slice(0, 64) || 'Falcon Cold Vault',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        ...(opts.platformOnly ? { authenticatorAttachment: 'platform' as const } : {}),
        userVerification: 'required',
        residentKey: opts.resident,
        requireResidentKey: opts.resident === 'required',
      },
      timeout: 90_000,
      attestation: 'none',
      ...(extensions ? { extensions } : {}),
    },
  })) as PublicKeyCredential | null

  if (!cred) throw new Error('Passkey creation was cancelled')
  return cred
}

/**
 * Register a passkey with progressive fallbacks.
 * Prefer no-PRF + preferred resident key — most reliable on Android PWA.
 */
export async function registerColdPasskey(label: string): Promise<ColdPasskeyReg> {
  if (!window.isSecureContext) {
    throw new Error('Passkeys require HTTPS (or localhost). Use Password unlock instead.')
  }

  const attempts: Array<{
    withPrf: boolean
    platformOnly: boolean
    resident: 'required' | 'preferred' | 'discouraged'
  }> = [
    // Most compatible first (avoids credential-manager failures)
    { withPrf: false, platformOnly: true, resident: 'preferred' },
    { withPrf: false, platformOnly: false, resident: 'preferred' },
    { withPrf: true, platformOnly: true, resident: 'preferred' },
    { withPrf: false, platformOnly: true, resident: 'required' },
  ]

  let lastErr: unknown
  for (const attempt of attempts) {
    try {
      const cred = await createCredential({ ...attempt, label })
      const rawIdBytes = new Uint8Array(cred.rawId)
      const credentialId = toBase64Url(rawIdBytes)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = cred.getClientExtensionResults() as any
      const prfOut = ext?.prf?.results?.first as ArrayBuffer | undefined
      const hasPrf = prfOut instanceof ArrayBuffer && prfOut.byteLength >= 32
      // When PRF unavailable, derive vault key material from credential id
      // (weaker but local-only; password path is stronger for cold storage).
      const keyBytes = hasPrf ? new Uint8Array(prfOut!) : rawIdBytes
      return { credentialId, keyBytes, hasPrf }
    } catch (e) {
      lastErr = e
      const msg = e instanceof Error ? e.message.toLowerCase() : ''
      // User cancelled — don't keep retrying
      if (e instanceof Error && e.name === 'NotAllowedError' && !msg.includes('credential manager')) {
        throw new Error(formatPasskeyError(e))
      }
      // try next attempt
    }
  }

  throw new Error(formatPasskeyError(lastErr))
}

export async function authenticateColdPasskey(
  credentialId: string,
  hasPrf: boolean,
): Promise<{ keyBytes: Uint8Array; hasPrf: boolean }> {
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const rpId = window.location.hostname
  const extensions: Record<string, unknown> = hasPrf
    ? { prf: { eval: { first: PRF_INPUT } } }
    : {}

  try {
    const cred = (await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId,
        allowCredentials: [
          {
            type: 'public-key',
            id: fromBase64Url(credentialId).buffer as ArrayBuffer,
            transports: ['internal', 'hybrid'],
          },
        ],
        userVerification: 'required',
        timeout: 90_000,
        extensions,
      },
    })) as PublicKeyCredential | null

    if (!cred) throw new Error('Authentication was cancelled')

    const rawIdBytes = new Uint8Array(cred.rawId)
    if (hasPrf) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = cred.getClientExtensionResults() as any
      const prfOut = ext?.prf?.results?.first as ArrayBuffer | undefined
      if (prfOut instanceof ArrayBuffer && prfOut.byteLength >= 32) {
        return { keyBytes: new Uint8Array(prfOut), hasPrf: true }
      }
    }
    return { keyBytes: rawIdBytes, hasPrf: false }
  } catch (e) {
    throw new Error(formatPasskeyError(e))
  }
}
