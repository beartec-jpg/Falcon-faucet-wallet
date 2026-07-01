// Rate limiting — only counts SUCCESSFUL faucet drips.
// Failed attempts (signing errors, node down, tx rejected) do not consume quota.

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const REQUESTS = parseInt(process.env.RATE_LIMIT_REQUESTS ?? '5', 10)
const WINDOW_SECONDS = parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? '3600', 10)

function makeRedisLimiter(): Ratelimit | null {
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
          prefix: 'qxrp_faucet_v2',
        })
      } catch (err) {
        console.error(`[rate-limit] Failed to init Redis using ${c.name}:`, err)
      }
    }
  }

  return null
}

const memStore = new Map<string, { count: number; resetAt: number }>()

function memPeek(key: string): { success: boolean; reset: Date; remaining: number } {
  const now = Date.now()
  const entry = memStore.get(key)
  if (!entry || now > entry.resetAt) {
    return { success: true, reset: new Date(now + WINDOW_SECONDS * 1000), remaining: REQUESTS }
  }
  const remaining = Math.max(0, REQUESTS - entry.count)
  return { success: remaining > 0, reset: new Date(entry.resetAt), remaining }
}

function memConsume(key: string): void {
  const now = Date.now()
  const entry = memStore.get(key)
  if (!entry || now > entry.resetAt) {
    memStore.set(key, { count: 1, resetAt: now + WINDOW_SECONDS * 1000 })
    return
  }
  entry.count++
}

let limiter: Ratelimit | null = null

function getLimiter(): Ratelimit | null {
  if (!limiter) limiter = makeRedisLimiter()
  return limiter
}

export interface LimitResult {
  success: boolean
  reset: string
  remaining?: number
}

/** Check quota without consuming a token. */
export async function peekRateLimit(key: string): Promise<LimitResult> {
  try {
    const rl = getLimiter()
    if (rl) {
      const r = await rl.getRemaining(key)
      return {
        success: r.remaining > 0,
        reset: new Date(r.reset).toISOString(),
        remaining: r.remaining,
      }
    }
  } catch (err) {
    console.warn('[rate-limit] peek failed:', err)
  }

  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1'
  if (isProduction) {
    // Fail CLOSED in production: without a distributed limiter the faucet has no
    // effective protection and its funded account can be drained. Operators who
    // explicitly accept this risk can opt back into fail-open with
    // RATE_LIMIT_FAIL_OPEN=true, but the default must be safe.
    const failOpen = process.env.RATE_LIMIT_FAIL_OPEN === 'true'
    if (failOpen) {
      console.warn('[rate-limit] No Redis — RATE_LIMIT_FAIL_OPEN=true, rate limiting disabled')
      return { success: true, reset: new Date(Date.now() + WINDOW_SECONDS * 1000).toISOString(), remaining: REQUESTS }
    }
    console.error('[rate-limit] No Redis configured in production — failing closed. Set KV_REST_API_* / UPSTASH_REDIS_REST_* to enable the faucet.')
    return { success: false, reset: new Date(Date.now() + WINDOW_SECONDS * 1000).toISOString(), remaining: 0 }
  }

  const r = memPeek(key)
  return { success: r.success, reset: r.reset.toISOString(), remaining: r.remaining }
}

/** Consume one token after a successful drip. */
export async function consumeRateLimit(key: string): Promise<void> {
  try {
    const rl = getLimiter()
    if (rl) {
      await rl.limit(key)
      return
    }
  } catch (err) {
    console.warn('[rate-limit] consume failed:', err)
  }

  if (!(process.env.NODE_ENV === 'production' || process.env.VERCEL === '1')) {
    memConsume(key)
  }
}

/** @deprecated Use peekRateLimit + consumeRateLimit */
export async function checkRateLimit(key: string): Promise<LimitResult> {
  return peekRateLimit(key)
}

/** Reset quota for a key (e.g. after operator intervention). */
export async function resetRateLimit(key: string): Promise<void> {
  try {
    const rl = getLimiter()
    if (rl?.resetUsedTokens) {
      await rl.resetUsedTokens(key)
      return
    }
  } catch {
    // fall through
  }
  memStore.delete(key)
}