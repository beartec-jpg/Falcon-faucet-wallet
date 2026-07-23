/**
 * Faucet anti-Sybil gates (portal).
 *
 * Economic isolation for free drips — not consensus security.
 * Mainnet is fail-closed when durable quota backend is missing.
 */

import type { NextRequest } from 'next/server'
import { clientIp } from '@/lib/security'

export type NetworkKey = 'testnet' | 'mainnet'

export interface SybilGateResult {
  ok: boolean
  status?: number
  error?: string
  code?:
    | 'captcha_required'
    | 'captcha_failed'
    | 'mainnet_no_backend'
    | 'global_budget'
    | 'subnet_limit'
    | 'ua_blocked'
}

function hasRedis(): boolean {
  return Boolean(
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
      (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
  )
}

function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL)
}

/** Mainnet must not run unlimited in-memory only (multi-instance Sybil). */
export function mainnetQuotaBackendOk(): boolean {
  if (process.env.FAUCET_ALLOW_MEMORY_MAINNET === 'true') return true
  return hasRedis() || hasDb()
}

export function isBotishUserAgent(ua: string | null): boolean {
  if (!ua || ua.length < 8) return true
  const s = ua.toLowerCase()
  const blocked = [
    'curl/',
    'wget/',
    'python-requests',
    'python-urllib',
    'go-http-client',
    'java/',
    'libwww',
    'scrapy',
    'httpclient',
    'axios/',
    'node-fetch',
    'postman',
    'insomnia',
  ]
  // Allow explicitly if FAUCET_ALLOW_CLI=true (ops testing).
  if (process.env.FAUCET_ALLOW_CLI === 'true') return false
  return blocked.some((b) => s.includes(b))
}

/** /24 for IPv4; full key for IPv6 (coarse). */
export function ipSubnetKey(ip: string): string {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`
  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean)
    return parts.slice(0, 4).join(':') + '::/64'
  }
  return ip
}

async function redisIncr(key: string, ttlSeconds: number): Promise<number | null> {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  try {
    // INCR then EXPIRE (best-effort pipeline via two calls)
    const incrRes = await fetch(`${url}/incr/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!incrRes.ok) return null
    const j = (await incrRes.json()) as { result?: number }
    const n = typeof j.result === 'number' ? j.result : null
    if (n === 1) {
      await fetch(`${url}/expire/${encodeURIComponent(key)}/${ttlSeconds}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
    }
    return n
  } catch {
    return null
  }
}

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY ?? process.env.FAUCET_TURNSTILE_SECRET
  if (!secret) return true // not configured → skip
  try {
    const body = new URLSearchParams()
    body.set('secret', secret)
    body.set('response', token)
    if (ip && ip !== 'unknown') body.set('remoteip', ip)
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
    })
    if (!r.ok) return false
    const j = (await r.json()) as { success?: boolean }
    return Boolean(j.success)
  } catch {
    return false
  }
}

/**
 * Run Sybil gates before signing a drip.
 * `captchaToken` from body.turnstileToken / body.captchaToken when configured.
 */
export async function runFaucetSybilGates(opts: {
  req: NextRequest
  networkKey: NetworkKey
  captchaToken?: string
}): Promise<SybilGateResult> {
  const { req, networkKey, captchaToken } = opts
  const ip = clientIp(req)
  const ua = req.headers.get('user-agent')

  if (networkKey === 'mainnet' && !mainnetQuotaBackendOk()) {
    return {
      ok: false,
      status: 503,
      code: 'mainnet_no_backend',
      error:
        'Mainnet faucet requires Redis or database-backed quota (set KV/Upstash or DATABASE_URL). Refusing fail-open memory mode.',
    }
  }

  if (isBotishUserAgent(ua)) {
    return {
      ok: false,
      status: 403,
      code: 'ua_blocked',
      error: 'Automated clients are not allowed on the faucet. Use the portal UI.',
    }
  }

  const turnstileRequired =
    Boolean(process.env.TURNSTILE_SECRET_KEY || process.env.FAUCET_TURNSTILE_SECRET) &&
    (networkKey === 'mainnet' || process.env.FAUCET_CAPTCHA_TESTNET === 'true')

  if (turnstileRequired) {
    if (!captchaToken) {
      return {
        ok: false,
        status: 400,
        code: 'captcha_required',
        error: 'Captcha token required (Cloudflare Turnstile).',
      }
    }
    const ok = await verifyTurnstile(captchaToken, ip)
    if (!ok) {
      return {
        ok: false,
        status: 403,
        code: 'captcha_failed',
        error: 'Captcha verification failed.',
      }
    }
  }

  return { ok: true }
}

/**
 * After per-IP/account quota passes, enforce global + subnet budgets.
 * Call before signing so we do not burn faucet funds under mass Sybil.
 */
export async function consumeFaucetSybilBudgets(opts: {
  networkKey: NetworkKey
  ip: string
}): Promise<SybilGateResult> {
  const { networkKey, ip } = opts

  const globalCap = parseInt(
    process.env[
      networkKey === 'mainnet' ? 'FAUCET_GLOBAL_CLAIMS_PER_DAY_MAINNET' : 'FAUCET_GLOBAL_CLAIMS_PER_DAY'
    ] ?? (networkKey === 'mainnet' ? '2000' : '50000'),
    10,
  )
  if (globalCap > 0 && hasRedis()) {
    const day = new Date().toISOString().slice(0, 10)
    const n = await redisIncr(`faucet_global:${networkKey}:${day}`, 172800)
    if (n !== null && n > globalCap) {
      return {
        ok: false,
        status: 429,
        code: 'global_budget',
        error: 'Network faucet daily budget exhausted. Try again after UTC midnight.',
      }
    }
  }

  const subnetCap = parseInt(
    process.env.FAUCET_SUBNET_CLAIMS_PER_DAY ?? (networkKey === 'mainnet' ? '20' : '100'),
    10,
  )
  if (subnetCap > 0 && hasRedis() && ip !== 'unknown') {
    const day = new Date().toISOString().slice(0, 10)
    const sub = ipSubnetKey(ip)
    const n = await redisIncr(`faucet_subnet:${networkKey}:${day}:${sub}`, 172800)
    if (n !== null && n > subnetCap) {
      return {
        ok: false,
        status: 429,
        code: 'subnet_limit',
        error: 'Too many faucet claims from your network today. Try again tomorrow (UTC).',
      }
    }
  }

  return { ok: true }
}

/** Mainnet-oriented drip defaults (env overrides still win in resolveFaucet). */
export function recommendedMainnetDripQxrp(): number {
  return parseFloat(process.env.MAINNET_FAUCET_DRIP_QXRP ?? process.env.FAUCET_DRIP_QXRP ?? '10')
}
