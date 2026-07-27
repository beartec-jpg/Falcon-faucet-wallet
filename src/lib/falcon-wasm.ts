/**
 * Singleton Falcon-512 WASM signer (browser-only).
 */

import { createFalcon512, type Falcon512Signer } from './falcon-512-browser'

let instance: Falcon512Signer | null = null
let loading: Promise<Falcon512Signer> | null = null
let resolvedWasmPath = '/wasm/falcon-512.min.js'

/**
 * Optional: cold-signer PWA calls this once at boot with
 * `${import.meta.env.BASE_URL}wasm/falcon-512.min.js` so offline scope works.
 */
export function configureFalconWasmPath(wasmPath: string): void {
  if (instance || loading) {
    throw new Error('configureFalconWasmPath must be called before getFalcon512()')
  }
  resolvedWasmPath = wasmPath
}

export async function getFalcon512(): Promise<Falcon512Signer> {
  if (instance) return instance
  if (!loading) {
    const path = resolvedWasmPath
    loading = createFalcon512(path).then(f => {
      instance = f
      return f
    })
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