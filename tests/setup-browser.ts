// Minimal browser globals for wallet-key tests (Node 20 has WebCrypto, atob/btoa).
import 'fake-indexeddb/auto'

const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
}
;(globalThis as any).window = globalThis
;(globalThis as any).location = { hostname: 'falcon-fpl.com' }
;(globalThis as any).PublicKeyCredential = function PublicKeyCredential() {}

export interface FakeAuthenticator {
  rawId: Uint8Array
  /** PRF secret, or null for an authenticator without PRF. */
  prfSecret: Uint8Array | null
  /** If true, create() reports prf.enabled but returns no results. */
  prfOnlyEnabledAtCreate?: boolean
}

export let authenticator: FakeAuthenticator = { rawId: new Uint8Array(32).fill(7), prfSecret: null }
export function setAuthenticator(a: FakeAuthenticator) {
  authenticator = a
}

async function prf(secret: Uint8Array, input: Uint8Array): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, input)
}

function makeCred(results: Record<string, unknown>) {
  return {
    rawId: authenticator.rawId.slice().buffer,
    getClientExtensionResults: () => results,
  }
}

export const calls = { create: 0, get: 0, lastGetUv: '' as string }

;(globalThis as any).navigator = {
  credentials: {
    async create(opts: any) {
      calls.create++
      const input = opts.publicKey.extensions?.prf?.eval?.first
      if (!authenticator.prfSecret) return makeCred({})
      if (authenticator.prfOnlyEnabledAtCreate) return makeCred({ prf: { enabled: true } })
      return makeCred({ prf: { enabled: true, results: { first: await prf(authenticator.prfSecret, input) } } })
    },
    async get(opts: any) {
      calls.get++
      calls.lastGetUv = opts.publicKey.userVerification
      const input = opts.publicKey.extensions?.prf?.eval?.first
      if (!authenticator.prfSecret || !input) return makeCred({})
      return makeCred({ prf: { results: { first: await prf(authenticator.prfSecret, input) } } })
    },
  },
}
