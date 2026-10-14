/**
 * Guards for public relay/proxy routes (audit pass 2 Lows): origin check, per-IP rate limit,
 * and bounded request bodies. Uses Upstash when configured, else a per-instance memory window.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { requireBrowserOrigin } from '@/lib/origin'
import { clientIp } from '@/lib/security'

export interface Bucket {
  name: string
  limit: number
  windowSec: number
}

export const BUCKETS = {
  rpcProxy: { name: 'rpc-proxy', limit: 300, windowSec: 60 },
  boardChallengeIp: { name: 'board-ch-ip', limit: 30, windowSec: 3600 },
  boardChallengeAddr: { name: 'board-ch-addr', limit: 20, windowSec: 3600 },
} satisfies Record<string, Bucket>

const limiters = new Map<string, Ratelimit | null>()

function redisLimiter(b: Bucket): Ratelimit | null {
  if (limiters.has(b.name)) return limiters.get(b.name)!
  let rl: Ratelimit | null = null
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (url?.startsWith('https://') && token) {
    try {
      rl = new Ratelimit({
        redis: new Redis({ url, token }),
        limiter: Ratelimit.slidingWindow(b.limit, `${b.windowSec}s`),
        prefix: `falcon_guard_${b.name}`,
      })
    } catch {
      rl = null
    }
  }
  limiters.set(b.name, rl)
  return rl
}

const mem = new Map<string, { count: number; resetAt: number }>()

export function memHit(b: Bucket, key: string, now = Date.now()): boolean {
  const k = `${b.name}:${key}`
  const e = mem.get(k)
  if (!e || now > e.resetAt) {
    mem.set(k, { count: 1, resetAt: now + b.windowSec * 1000 })
    return true
  }
  e.count++
  return e.count <= b.limit
}

/** Consume one token; true if allowed. Fails open to the memory window if Redis errors. */
export async function hit(b: Bucket, key: string): Promise<boolean> {
  const rl = redisLimiter(b)
  if (rl) {
    try {
      return (await rl.limit(key)).success
    } catch {
      /* fall through */
    }
  }
  return memHit(b, key)
}

export class BodyTooLarge extends Error {}

/** Read the body as text, refusing more than maxBytes (Content-Length and actual size). */
export async function readBodyCapped(req: Request, maxBytes: number): Promise<string> {
  const cl = Number(req.headers.get('content-length') ?? '0')
  if (cl > maxBytes) throw new BodyTooLarge()
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    n += value.byteLength
    if (n > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new BodyTooLarge()
    }
    chunks.push(value)
  }
  const out = new Uint8Array(n)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.byteLength
  }
  return new TextDecoder().decode(out)
}

/** Origin + per-IP rate limit for a proxy route. Returns a response to send, or null to proceed. */
export async function guardProxy(req: NextRequest, b: Bucket = BUCKETS.rpcProxy): Promise<NextResponse | null> {
  if (!requireBrowserOrigin(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }
  if (!(await hit(b, `ip:${clientIp(req)}`))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  return null
}

export function tooLarge(maxBytes: number) {
  return NextResponse.json({ error: `Request body too large (max ${maxBytes} bytes)` }, { status: 413 })
}
