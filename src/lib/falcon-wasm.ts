/**
 * Singleton Falcon-512 WASM signer (liboqs via @openforge-sh/liboqs).
 * Browser-only — never import from server components or API routes.
 */

import type { Falcon512 } from '@openforge-sh/liboqs/sig'

let instance: Falcon512 | null = null
let loading: Promise<Falcon512> | null = null

export async function getFalcon512(): Promise<Falcon512> {
  if (instance) return instance
  if (!loading) {
    loading = (async () => {
      const { createFalcon512 } = await import('@openforge-sh/liboqs/sig')
      instance = await createFalcon512()
      return instance
    })()
  }
  return loading
}

/** Release WASM resources (e.g. on page unload). */
export async function destroyFalcon512(): Promise<void> {
  if (instance) {
    instance.destroy()
    instance = null
    loading = null
  }
}
