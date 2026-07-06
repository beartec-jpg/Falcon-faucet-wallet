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
let memFallbackWarned = false

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

  const failOpen = process.env.RATE_LIMIT_FAIL_OPEN === 'true'
  if (failOpen) {
    console.warn('[rate-limit] No Redis — RATE_LIMIT_FAIL_OPEN=true, rate limiting disabled')
    return { success: true, reset: new Date(Date.now() + WINDOW_SECONDS * 1000).toISOString(), remaining: REQUESTS }
  }

  // No Redis available — fall back to in-process memory store.
  // This provides per-instance rate limiting. For multi-instance deployments
  // configure KV_REST_API_* or UPSTASH_REDIS_REST_* for a distributed limiter.
  if (!memFallbackWarned) {
    console.warn('[rate-limit] No Redis configured — using in-memory rate limiting (per-instance). Set KV_REST_API_* / UPSTASH_REDIS_REST_* for distributed limiting.')
    memFallbackWarned = true
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

  // No Redis — consume from in-memory store regardless of environment.
  memConsume(key)
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

// ── Dedicated limiter for the tx-submit proxy ────────────────────────────────
// Submitting signed blobs is a normal user action (swaps, orders, LP, bridge)
// so it needs a far more generous budget than the faucet drip limiter. This is
// per-instance (in-memory); it only guards a single node against abusive bursts.

const SUBMIT_DEFAULT_REQUESTS = 30
const SUBMIT_DEFAULT_WINDOW_SECONDS = 60
const SUBMIT_REQUESTS = parseInt(process.env.SUBMIT_RATE_LIMIT_REQUESTS ?? String(SUBMIT_DEFAULT_REQUESTS), 10)
const SUBMIT_WINDOW_SECONDS = parseInt(process.env.SUBMIT_RATE_LIMIT_WINDOW_SECONDS ?? String(SUBMIT_DEFAULT_WINDOW_SECONDS), 10)
const submitStore = new Map<string, { count: number; resetAt: number }>()

function submitPeek(key: string): LimitResult {
  const now = Date.now()
  const entry = submitStore.get(key)
  if (!entry || now > entry.resetAt) {
    return {
      success: true,
      reset: new Date(now + SUBMIT_WINDOW_SECONDS * 1000).toISOString(),
      remaining: SUBMIT_REQUESTS,
    }
  }
  const remaining = Math.max(0, SUBMIT_REQUESTS - entry.count)
  return { success: remaining > 0, reset: new Date(entry.resetAt).toISOString(), remaining }
}

/** Check the submit-proxy quota without consuming a token. */
export async function peekSubmitRateLimit(key: string): Promise<LimitResult> {
  return submitPeek(key)
}

/** Consume one submit-proxy token. */
export async function consumeSubmitRateLimit(key: string): Promise<void> {
  const now = Date.now()
  const entry = submitStore.get(key)
  if (!entry || now > entry.resetAt) {
    submitStore.set(key, { count: 1, resetAt: now + SUBMIT_WINDOW_SECONDS * 1000 })
    return
  }
  entry.count++
}