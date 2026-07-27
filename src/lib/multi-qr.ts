/**
 * Multi-part / animated QR framing for Falcon vault cold-sign transport.
 *
 * Falcon-512 signatures and full tx_blobs exceed single-QR capacity.
 * Messages are split into versioned frames with CRC32 over the full body.
 *
 * Frame wire format (JSON, one QR per frame):
 *   { v, mid, i, n, ct, body, crc }
 *
 * body = base64url chunk of UTF-8 payload
 * crc  = CRC32 of the full reassembled body (hex, 8 chars) — same on every frame
 */

export const MULTI_QR_VERSION = 1 as const

/** Target chars per frame body chunk (keeps whole frame scannable). */
export const DEFAULT_CHUNK_CHARS = 400

export type MultiQrContentType =
  | 'vault-unlock-chal'
  | 'vault-unlock-resp'
  | 'unsigned-tx'
  | 'signed-tx'

export interface MultiQrFrame {
  v: typeof MULTI_QR_VERSION
  mid: string
  i: number
  n: number
  ct: MultiQrContentType
  body: string
  crc: string
}

export interface EncodedMultiQr {
  mid: string
  ct: MultiQrContentType
  frames: string[]
  frameCount: number
  crc: string
  /** Full UTF-8 payload (for tests / file fallback). */
  payload: string
}

// ── CRC32 ─────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

export function crc32(data: string | Uint8Array): string {
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : data
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}

// ── base64url ─────────────────────────────────────────────────────────────────

export function b64uEncode(bytes: Uint8Array): string {
  let bin = ''
  bytes.forEach((b) => {
    bin += String.fromCharCode(b)
  })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function b64uDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const padLen = (4 - (padded.length % 4)) % 4
  const bin = atob(padded + '='.repeat(padLen))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function b64uEncodeUtf8(text: string): string {
  return b64uEncode(new TextEncoder().encode(text))
}

export function b64uDecodeUtf8(s: string): string {
  return new TextDecoder().decode(b64uDecode(s))
}

// ── message id ────────────────────────────────────────────────────────────────

export function newMessageId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return b64uEncode(bytes)
}

// ── encode ────────────────────────────────────────────────────────────────────

export function encodeMultiQr(
  payload: string,
  ct: MultiQrContentType,
  opts?: { chunkChars?: number; mid?: string },
): EncodedMultiQr {
  const chunkChars = opts?.chunkChars ?? DEFAULT_CHUNK_CHARS
  const mid = opts?.mid ?? newMessageId()
  const fullB64 = b64uEncodeUtf8(payload)
  const crc = crc32(fullB64)

  const chunks: string[] = []
  for (let i = 0; i < fullB64.length; i += chunkChars) {
    chunks.push(fullB64.slice(i, i + chunkChars))
  }
  if (chunks.length === 0) chunks.push('')

  const n = chunks.length
  const frames = chunks.map((body, i) => {
    const frame: MultiQrFrame = {
      v: MULTI_QR_VERSION,
      mid,
      i,
      n,
      ct,
      body,
      crc,
    }
    return JSON.stringify(frame)
  })

  return { mid, ct, frames, frameCount: n, crc, payload }
}

// ── decode / reassemble ───────────────────────────────────────────────────────

export function parseFrame(raw: string): MultiQrFrame {
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    throw new Error('Invalid multi-QR frame — not JSON')
  }
  if (!obj || typeof obj !== 'object') {
    throw new Error('Invalid multi-QR frame')
  }
  const f = obj as Record<string, unknown>
  if (f.v !== MULTI_QR_VERSION) {
    throw new Error(`Unsupported multi-QR version: ${String(f.v)}`)
  }
  if (
    typeof f.mid !== 'string' ||
    typeof f.i !== 'number' ||
    typeof f.n !== 'number' ||
    typeof f.ct !== 'string' ||
    typeof f.body !== 'string' ||
    typeof f.crc !== 'string'
  ) {
    throw new Error('Invalid multi-QR frame fields')
  }
  if (f.i < 0 || f.n < 1 || f.i >= f.n) {
    throw new Error('Invalid multi-QR frame index')
  }
  return f as unknown as MultiQrFrame
}

export class MultiQrAssembler {
  private mid: string | null = null
  private ct: MultiQrContentType | null = null
  private n = 0
  private crc = ''
  private parts = new Map<number, string>()

  get expectedCount(): number {
    return this.n
  }

  get receivedCount(): number {
    return this.parts.size
  }

  get contentType(): MultiQrContentType | null {
    return this.ct
  }

  get messageId(): string | null {
    return this.mid
  }

  /** Progress 0..1 */
  get progress(): number {
    if (this.n <= 0) return 0
    return this.parts.size / this.n
  }

  reset(): void {
    this.mid = null
    this.ct = null
    this.n = 0
    this.crc = ''
    this.parts.clear()
  }

  /**
   * Ingest one scanned frame string.
   * @returns full UTF-8 payload when complete, else null
   */
  addFrame(raw: string): string | null {
    const frame = parseFrame(raw)

    if (this.mid === null) {
      this.mid = frame.mid
      this.ct = frame.ct
      this.n = frame.n
      this.crc = frame.crc
    } else {
      if (frame.mid !== this.mid) {
        // New message — restart assembly
        this.reset()
        return this.addFrame(raw)
      }
      if (frame.n !== this.n || frame.crc !== this.crc || frame.ct !== this.ct) {
        throw new Error('Multi-QR frame mismatch for message')
      }
    }

    this.parts.set(frame.i, frame.body)

    if (this.parts.size < this.n) return null

    const ordered: string[] = []
    for (let i = 0; i < this.n; i++) {
      const part = this.parts.get(i)
      if (part === undefined) {
        throw new Error(`Missing multi-QR frame ${i}`)
      }
      ordered.push(part)
    }
    const fullB64 = ordered.join('')
    const got = crc32(fullB64)
    if (got !== this.crc) {
      this.reset()
      throw new Error('Multi-QR CRC mismatch — rescan all frames')
    }
    return b64uDecodeUtf8(fullB64)
  }
}

export function decodeMultiQrFrames(frameStrings: string[]): {
  payload: string
  ct: MultiQrContentType
  mid: string
} {
  const asm = new MultiQrAssembler()
  let payload: string | null = null
  for (const f of frameStrings) {
    payload = asm.addFrame(f)
  }
  if (payload === null || !asm.contentType || !asm.messageId) {
    throw new Error(
      `Incomplete multi-QR: ${asm.receivedCount}/${asm.expectedCount || '?'} frames`,
    )
  }
  return { payload, ct: asm.contentType, mid: asm.messageId }
}
