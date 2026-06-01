// Rate limiting — Upstash Redis is REQUIRED in production (fail-closed).
// In-memory fallback only for local development.

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const REQUESTS = parseInt(process.env.RATE_LIMIT_REQUESTS ?? '1', 10)
const WINDOW_SECONDS = parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? '86400', 10)

// --------------------------------------------------------------------------
// Upstash Redis limiter (production)
// --------------------------------------------------------------------------
function makeRedisLimiter(): Ratelimit | null {
  // Support multiple common variable name patterns used by Vercel + Upstash over time
  const candidates: Array<{ url: string | undefined; token: string | undefined; name: string }> = [
    { url: process.env.KV_REST_API_URL,        token: process.env.KV_REST_API_TOKEN,        name: 'KV_REST_API_*' },
    { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN, name: 'UPSTASH_REDIS_REST_*' },
  ]

  for (const c of candidates) {
    if (c.url && c.token) {
      if (!c.url.startsWith('https://')) {
        console.warn(`[rate-limit] ${c.name} URL does not start with https:// — skipping`)
        continue
      }
      try {
        const redis = new Redis({ url: c.url, token: c.token })
        console.log(`[rate-limit] Using Upstash Redis via ${c.name}`)
        return new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(REQUESTS, `${WINDOW_SECONDS}s`),
          prefix: 'qxrp_faucet',
        })
      } catch (err) {
        console.error(`[rate-limit] Failed to init Redis using ${c.name}:`, err)
      }
    }
  }

  return null
}

// --------------------------------------------------------------------------
// In-memory fallback (development / no Redis)
// --------------------------------------------------------------------------
const memStore = new Map<string, { count: number; resetAt: number }>()

function memCheck(key: string): { success: boolean; reset: Date } {
  const now = Date.now()
  const entry = memStore.get(key)
  if (!entry || now > entry.resetAt) {
    memStore.set(key, { count: 1, resetAt: now + WINDOW_SECONDS * 1000 })
    return { success: true, reset: new Date(now + WINDOW_SECONDS * 1000) }
  }
  if (entry.count < REQUESTS) {
    entry.count++
    return { success: true, reset: new Date(entry.resetAt) }
  }
  return { success: false, reset: new Date(entry.resetAt) }
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------
let limiter: Ratelimit | null = null

export interface LimitResult {
  success: boolean
  /** ISO string of when the rate limit resets */
  reset: string
}

export async function checkRateLimit(key: string): Promise<LimitResult> {
  try {
    if (!limiter) limiter = makeRedisLimiter()

    if (limiter) {
      const r = await limiter.limit(key)
      return { success: r.success, reset: new Date(r.reset).toISOString() }
    }
  } catch (err) {
    console.warn('[rate-limit] Redis limiter failed:', err)
  }

  // Production safety: fail closed if no Upstash/Redis is configured.
  // This prevents the in-memory fallback (which is useless on Vercel serverless) from allowing unlimited abuse.
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1'
  if (isProduction) {
    console.error('[rate-limit] Production requires Upstash Redis (KV_REST_API_URL + KV_REST_API_TOKEN). In-memory fallback disabled.')
    return { success: false, reset: new Date(Date.now() + 60_000).toISOString() }
  }

  // Dev only fallback
  const r = memCheck(key)
  return { success: r.success, reset: r.reset.toISOString() }
}

/**
 * Refund one request token for a key (e.g. when signing/submit fails before
 * funds actually move). Best-effort — never throws.
 */
export async function refundRateLimit(key: string): Promise<void> {
  try {
    // In-memory: decrement the counter so the user isn't penalised
    const entry = memStore.get(key)
    if (entry && entry.count > 0) {
      entry.count--
    }

    // Redis: the Upstash Ratelimit SDK has no decrement, so we reset the key.
    // This gives a full window reset rather than a single-token refund, but it's
    // better than consuming the limit on a node error.
    if (!limiter) limiter = makeRedisLimiter()
    if (limiter) {
      // Access the underlying Redis client via the internal property
      const redis = (limiter as unknown as { redis: { del: (key: string) => Promise<unknown> } }).redis
      if (redis?.del) {
        const prefixedKey = `qxrp_faucet:${key}`
        await redis.del(prefixedKey).catch(() => {})
      }
    }
  } catch {
    // refund is best-effort — never propagate errors
  }
}
