// Screenshot handling for testnet feedback: type sniffing by magic bytes, structural
// checks, and metadata stripping (EXIF/XMP/ICC text, comments) without native deps.
// The client re-encodes to JPEG already; this is the server-side guarantee.

export type ImageKind = 'png' | 'jpeg' | 'webp'
export const IMAGE_MIME: Record<ImageKind, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Detect png / jpeg / webp from the first bytes only (never trust the declared type). */
export function sniffImage(b: Uint8Array): ImageKind | null {
  if (b.length >= 8 && PNG_SIG.every((x, i) => b[i] === x)) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp'
  return null
}

function ascii(b: Uint8Array, at: number, n: number) {
  return String.fromCharCode(...b.subarray(at, at + n))
}
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const u32le = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** PNG: keep only chunks needed to render (drops tEXt/zTXt/iTXt/eXIf/tIME/iCCP and anything unknown). */
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'pHYs', 'acTL', 'fcTL', 'fdAT'])
function stripPng(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 8)]
  let i = 8
  let sawEnd = false
  let sawHdr = false
  while (i + 12 <= b.length) {
    const len = u32be(b, i)
    const type = ascii(b, i + 4, 4)
    const end = i + 12 + len
    if (end > b.length) throw new Error('truncated png')
    if (i === 8 && type !== 'IHDR') throw new Error('bad png')
    if (type === 'IHDR') sawHdr = true
    if (PNG_KEEP.has(type)) parts.push(b.subarray(i, end))
    i = end
    if (type === 'IEND') {
      sawEnd = true
      break
    }
  }
  if (!sawHdr || !sawEnd) throw new Error('bad png')
  return concat(parts)
}

/** JPEG: drop APP1–APP15 (EXIF, XMP, ICC, Photoshop…) and COM; keep APP0 (JFIF) and image segments. */
function stripJpeg(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 2)]
  let i = 2
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Error('bad jpeg')
    const m = b[i + 1]
    if (m === 0xff) {
      i++
      continue
    }
    if (m === 0xd9) {
      parts.push(b.subarray(i, i + 2))
      return concat(parts)
    }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      parts.push(b.subarray(i, i + 2))
      i += 2
      continue
    }
    const len = (b[i + 2] << 8) | b[i + 3]
    if (len < 2 || i + 2 + len > b.length) throw new Error('truncated jpeg')
    const seg = b.subarray(i, i + 2 + len)
    if (m === 0xda) {
      // Start of scan: copy the rest (entropy-coded data up to and including EOI).
      parts.push(b.subarray(i))
      return concat(parts)
    }
    const drop = (m >= 0xe1 && m <= 0xef) || m === 0xfe
    if (!drop) parts.push(seg)
    i += 2 + len
  }
  throw new Error('bad jpeg')
}

/** WebP: drop EXIF / XMP / ICCP chunks and clear their flags in VP8X. */
function stripWebp(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = []
  let i = 12
  let sawImage = false
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4)
    const len = u32le(b, i + 4)
    const end = i + 8 + len + (len & 1)
    if (i + 8 + len > b.length) throw new Error('truncated webp')
    if (type === 'VP8 ' || type === 'VP8L' || type === 'ANMF') sawImage = true
    if (type === 'VP8X') {
      const c = b.slice(i, Math.min(end, b.length))
      c[8] &= ~(0x20 | 0x08 | 0x04) // ICC, EXIF, XMP flags
      parts.push(c)
    } else if (type !== 'EXIF' && type !== 'XMP ' && type !== 'ICCP') {
      parts.push(b.subarray(i, Math.min(end, b.length)))
    }
    i = end
  }
  if (!sawImage) throw new Error('bad webp')
  const body = concat(parts)
  const head = new Uint8Array(12)
  head.set(b.subarray(0, 4), 0)
  const size = body.length + 4
  head.set([size & 255, (size >> 8) & 255, (size >> 16) & 255, (size >>> 24) & 255], 4)
  head.set(b.subarray(8, 12), 8)
  return concat([head, body])
}

/** Verify and clean one upload. Returns the cleaned bytes and type, or an error string. */
export function cleanImage(b: Uint8Array, maxBytes: number): { kind: ImageKind; bytes: Uint8Array } | string {
  if (b.length === 0) return 'Empty image.'
  if (b.length > maxBytes) return `Each image must be under ${Math.round(maxBytes / 1_000_000)} MB.`
  const kind = sniffImage(b)
  if (!kind) return 'Screenshots must be PNG, JPEG or WebP images.'
  try {
    const bytes = kind === 'png' ? stripPng(b) : kind === 'jpeg' ? stripJpeg(b) : stripWebp(b)
    return { kind, bytes }
  } catch {
    return 'That image file looks damaged. Try another screenshot.'
  }
}
