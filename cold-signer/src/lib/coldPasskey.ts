/**
 * WebAuthn passkey helpers for the cold signer (distinct PRF salt from hot wallet).
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
    typeof navigator.credentials?.create === 'function'
  )
}

export interface ColdPasskeyReg {
  credentialId: string
  keyBytes: Uint8Array
  hasPrf: boolean
}

export async function registerColdPasskey(label: string): Promise<ColdPasskeyReg> {
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const userId = crypto.getRandomValues(new Uint8Array(16))
  const rpId = window.location.hostname

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'Falcon Cold Signer', id: rpId },
      user: { id: userId, name: label, displayName: label },
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extensions: { prf: { eval: { first: PRF_INPUT } } } as any,
    },
  })) as PublicKeyCredential | null

  if (!cred) throw new Error('Passkey creation was cancelled')

  const rawIdBytes = new Uint8Array(cred.rawId)
  const credentialId = toBase64Url(rawIdBytes)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ext = cred.getClientExtensionResults() as any
  const prfOut = ext?.prf?.results?.first as ArrayBuffer | undefined
  const hasPrf = prfOut instanceof ArrayBuffer && prfOut.byteLength >= 32
  const keyBytes = hasPrf ? new Uint8Array(prfOut!) : rawIdBytes

  return { credentialId, keyBytes, hasPrf }
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
      timeout: 60_000,
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
}
