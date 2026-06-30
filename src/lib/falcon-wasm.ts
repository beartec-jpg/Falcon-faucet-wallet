/**
 * Singleton Falcon-512 WASM signer (browser-only).
 */

import { createFalcon512, type Falcon512Signer } from './falcon-512-browser'

let instance: Falcon512Signer | null = null
let loading: Promise<Falcon512Signer> | null = null

export async function getFalcon512(): Promise<Falcon512Signer> {
  if (instance) return instance
  if (!loading) {
    loading = createFalcon512().then(f => {
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