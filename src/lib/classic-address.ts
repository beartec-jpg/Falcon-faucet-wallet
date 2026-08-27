/**
 * Classic r-address helpers without ripple-address-codec.
 * That package is ESM-only and Next 14 collect (`require()`) throws ERR_REQUIRE_ESM.
 */

const ALPHABET = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz'
const ALPHABET_MAP: Record<string, number> = {}
for (let i = 0; i < ALPHABET.length; i++) ALPHABET_MAP[ALPHABET[i]] = i

export const CLASSIC_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n))
}

function sha256(message: Uint8Array): Uint8Array {
  const bitLen = message.length * 8
  const paddedLen = Math.ceil((message.length + 1 + 8) / 64) * 64
  const m = new Uint8Array(paddedLen)
  m.set(message)
  m[message.length] = 0x80
  const view = new DataView(m.buffer)
  view.setUint32(paddedLen - 4, bitLen >>> 0, false)

  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19
  const w = new Uint32Array(64)

  for (let i = 0; i < paddedLen; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4, false)
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let hh = h7
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (hh + S1 + ch + SHA256_K[t] + w[t]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
    h5 = (h5 + f) >>> 0
    h6 = (h6 + g) >>> 0
    h7 = (h7 + hh) >>> 0
  }

  const out = new Uint8Array(32)
  const ov = new DataView(out.buffer)
  ov.setUint32(0, h0, false)
  ov.setUint32(4, h1, false)
  ov.setUint32(8, h2, false)
  ov.setUint32(12, h3, false)
  ov.setUint32(16, h4, false)
  ov.setUint32(20, h5, false)
  ov.setUint32(24, h6, false)
  ov.setUint32(28, h7, false)
  return out
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

function encodeBase58(bytes: Uint8Array): string {
  let zeros = 0
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++
  let n = 0n
  for (const byte of bytes) n = (n << 8n) + BigInt(byte)
  let out = ''
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out
    n /= 58n
  }
  return ALPHABET[0].repeat(zeros) + out
}

function decodeBase58(value: string): Uint8Array {
  let zeros = 0
  while (zeros < value.length && value[zeros] === ALPHABET[0]) zeros++
  let n = 0n
  for (const ch of value) {
    const v = ALPHABET_MAP[ch]
    if (v === undefined) throw new Error('Invalid base58 character')
    n = n * 58n + BigInt(v)
  }
  const hex = n.toString(16)
  const padded = hex.length % 2 ? `0${hex}` : hex
  const rest = padded.length / 2
  const out = new Uint8Array(zeros + rest)
  for (let i = 0; i < rest; i++) {
    out[zeros + i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function asBytes(bytes: Uint8Array | ArrayLike<number>): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
}

/** XRPL classic AccountID encoding (version 0x00 + 20 bytes + 4-byte checksum). */
export function encodeAccountID(bytes: Uint8Array | ArrayLike<number>): string {
  const id = asBytes(bytes)
  if (id.length !== 20) throw new Error('AccountID must be 20 bytes')
  const payload = new Uint8Array(21)
  payload[0] = 0x00
  payload.set(id, 1)
  const checksum = sha256(sha256(payload)).subarray(0, 4)
  return encodeBase58(concatBytes(payload, checksum))
}

/** Decode a classic r-address to the 20-byte AccountID. */
export function decodeAccountID(address: string): Uint8Array {
  const decoded = decodeBase58(address.trim())
  if (decoded.length < 5) throw new Error('Invalid classic address')
  const payload = decoded.subarray(0, decoded.length - 4)
  const checksum = decoded.subarray(decoded.length - 4)
  const expect = sha256(sha256(payload)).subarray(0, 4)
  if (
    checksum[0] !== expect[0] ||
    checksum[1] !== expect[1] ||
    checksum[2] !== expect[2] ||
    checksum[3] !== expect[3]
  ) {
    throw new Error('Invalid classic address checksum')
  }
  if (payload[0] !== 0x00 || payload.length !== 21) {
    throw new Error('Not a classic AccountID address')
  }
  return payload.subarray(1)
}

export function isValidClassicAddress(value: string): boolean {
  const a = value.trim()
  if (!CLASSIC_ADDRESS_RE.test(a)) return false
  try {
    decodeAccountID(a)
    return true
  } catch {
    return false
  }
}

export function isClassicAddress(value: string): boolean {
  return isValidClassicAddress(value)
}
