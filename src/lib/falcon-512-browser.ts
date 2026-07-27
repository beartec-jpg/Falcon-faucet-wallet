/**
 * Browser Falcon-512 loader — avoids @openforge-sh/liboqs dynamic import paths
 * that webpack cannot resolve in production bundles.
 *
 * WASM bundle is copied to /public/wasm/falcon-512.min.js on postinstall.
 */

const FALCON_512 = {
  identifier: 'Falcon-512',
  publicKey: 897,
  secretKey: 1281,
  signature: 752,
} as const

export interface Falcon512Signer {
  generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array }
  sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array
  /** Verify Falcon-512 signature. publicKey is raw 897 bytes (no 0xFB prefix). */
  verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean
  destroy(): void
}

type WasmModule = {
  _OQS_init: () => void
  _malloc: (n: number) => number
  _free: (ptr: number) => void
  lengthBytesUTF8: (s: string) => number
  stringToUTF8: (s: string, ptr: number, max: number) => void
  _OQS_SIG_new: (namePtr: number) => number
  _OQS_SIG_keypair: (sigPtr: number, pubPtr: number, secPtr: number) => number
  _OQS_SIG_sign: (
    sigPtr: number,
    sigOutPtr: number,
    sigLenPtr: number,
    msgPtr: number,
    msgLen: number,
    secPtr: number,
  ) => number
  _OQS_SIG_verify: (
    sigPtr: number,
    msgPtr: number,
    msgLen: number,
    sigInPtr: number,
    sigLen: number,
    pubPtr: number,
  ) => number
  _OQS_SIG_free: (sigPtr: number) => void
  getValue: (ptr: number, type: string) => number
  HEAPU8: Uint8Array
}

class Falcon512 implements Falcon512Signer {
  #wasm: WasmModule
  #sigPtr: number
  #destroyed = false

  constructor(wasm: WasmModule, sigPtr: number) {
    this.#wasm = wasm
    this.#sigPtr = sigPtr
  }

  generateKeyPair() {
    this.#check()
    const pubPtr = this.#wasm._malloc(FALCON_512.publicKey)
    const secPtr = this.#wasm._malloc(FALCON_512.secretKey)
    try {
      const rc = this.#wasm._OQS_SIG_keypair(this.#sigPtr, pubPtr, secPtr)
      if (rc !== 0) throw new Error('Falcon-512 key generation failed')
      const publicKey = this.#wasm.HEAPU8.slice(pubPtr, pubPtr + FALCON_512.publicKey)
      const secretKey = this.#wasm.HEAPU8.slice(secPtr, secPtr + FALCON_512.secretKey)
      return { publicKey, secretKey }
    } finally {
      this.#wasm._free(pubPtr)
      this.#wasm._free(secPtr)
    }
  }

  sign(message: Uint8Array, secretKey: Uint8Array) {
    this.#check()
    if (secretKey.length !== FALCON_512.secretKey) {
      throw new Error(`Invalid Falcon secret key length: ${secretKey.length}`)
    }
    const msgPtr = this.#wasm._malloc(message.length)
    const secPtr = this.#wasm._malloc(FALCON_512.secretKey)
    const sigPtr = this.#wasm._malloc(FALCON_512.signature)
    const sigLenPtr = this.#wasm._malloc(8)
    try {
      this.#wasm.HEAPU8.set(message, msgPtr)
      this.#wasm.HEAPU8.set(secretKey, secPtr)
      const rc = this.#wasm._OQS_SIG_sign(
        this.#sigPtr, sigPtr, sigLenPtr, msgPtr, message.length, secPtr,
      )
      if (rc !== 0) throw new Error('Falcon-512 signing failed')
      const sigLen = this.#wasm.getValue(sigLenPtr, 'i32')
      return this.#wasm.HEAPU8.slice(sigPtr, sigPtr + sigLen)
    } finally {
      this.#wasm._free(msgPtr)
      this.#wasm._free(secPtr)
      this.#wasm._free(sigPtr)
      this.#wasm._free(sigLenPtr)
    }
  }

  verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
    this.#check()
    if (publicKey.length !== FALCON_512.publicKey) {
      throw new Error(`Invalid Falcon public key length: ${publicKey.length}`)
    }
    if (signature.length === 0 || signature.length > FALCON_512.signature) {
      throw new Error(`Invalid Falcon signature length: ${signature.length}`)
    }
    const msgPtr = this.#wasm._malloc(message.length)
    const sigInPtr = this.#wasm._malloc(signature.length)
    const pubPtr = this.#wasm._malloc(FALCON_512.publicKey)
    try {
      this.#wasm.HEAPU8.set(message, msgPtr)
      this.#wasm.HEAPU8.set(signature, sigInPtr)
      this.#wasm.HEAPU8.set(publicKey, pubPtr)
      const rc = this.#wasm._OQS_SIG_verify(
        this.#sigPtr,
        msgPtr,
        message.length,
        sigInPtr,
        signature.length,
        pubPtr,
      )
      return rc === 0
    } finally {
      this.#wasm._free(msgPtr)
      this.#wasm._free(sigInPtr)
      this.#wasm._free(pubPtr)
    }
  }

  destroy() {
    if (!this.#destroyed && this.#sigPtr) {
      this.#wasm._OQS_SIG_free(this.#sigPtr)
      this.#destroyed = true
    }
  }

  #check() {
    if (this.#destroyed) throw new Error('Falcon-512 instance destroyed')
  }
}

async function loadWasmFactory(
  wasmPath = '/wasm/falcon-512.min.js',
): Promise<() => Promise<WasmModule>> {
  // Absolute path or full URL. Cold signer PWA uses e.g. /cold-signer/wasm/…
  const url = wasmPath.startsWith('http')
    ? wasmPath
    : new URL(wasmPath, window.location.origin).href
  const mod = await import(/* webpackIgnore: true */ url)
  const factory = mod.default as () => Promise<WasmModule>
  if (typeof factory !== 'function') {
    throw new Error('falcon-512.min.js did not export a factory function')
  }
  return factory
}

export async function createFalcon512(
  wasmPath = '/wasm/falcon-512.min.js',
): Promise<Falcon512Signer> {
  const factory = await loadWasmFactory(wasmPath)
  const wasm = await factory()
  wasm._OQS_init()

  const algoName = FALCON_512.identifier
  const nameLen = wasm.lengthBytesUTF8(algoName)
  const namePtr = wasm._malloc(nameLen + 1)
  wasm.stringToUTF8(algoName, namePtr, nameLen + 1)

  const sigPtr = wasm._OQS_SIG_new(namePtr)
  wasm._free(namePtr)

  if (!sigPtr) throw new Error('Failed to create Falcon-512 SIG instance')
  return new Falcon512(wasm, sigPtr)
}