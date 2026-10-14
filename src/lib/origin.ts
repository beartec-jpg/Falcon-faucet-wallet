// Shared origin allow-list for state-changing / browser-only API routes (CSRF defence).
//
// ALLOWED_ORIGINS: comma-separated origins, e.g. "https://wallet.example.com".
// When unset, the request Origin/Referer must match this deployment's own origin.
//
// Browser-only routes should use requireBrowserOrigin (audit R-3): a matching Origin
// (or Referer) or Sec-Fetch-Site: same-origin. Bare requests with neither are refused
// in production. Cron and other server-to-server routes keep using their own secrets
// and must not call requireBrowserOrigin.

import type { NextRequest } from 'next/server'

function toOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)
  .map((o) => toOrigin(o))
  .filter((o): o is string => o !== null)

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1'
}

function siteOrigin(req: NextRequest): string | null {
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host')
  if (!host) return null
  const proto =
    req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
    toOrigin(req.url)?.split(':')[0] ||
    'https'
  return `${proto}://${host}`
}

function requestOrigin(req: NextRequest): string | null {
  const rawOrigin = req.headers.get('origin')
  const rawReferer = req.headers.get('referer')
  return (rawOrigin && toOrigin(rawOrigin)) || (rawReferer && toOrigin(rawReferer)) || null
}

/** True when Origin/Referer matches this site or ALLOWED_ORIGINS. */
export function isOriginAllowed(req: NextRequest): boolean {
  const origin = requestOrigin(req)
  const self = siteOrigin(req)

  if (origin && self && origin === self) return true
  if (ALLOWED_ORIGINS.length > 0 && origin && ALLOWED_ORIGINS.includes(origin)) return true

  // Mobile / PWA: Origin omitted but Sec-Fetch-Site says same-origin.
  if (!origin && req.headers.get('sec-fetch-site') === 'same-origin') return true

  if (!isProduction() && ALLOWED_ORIGINS.length === 0) return true
  return false
}

/**
 * Stricter check for browser-only routes (rpc proxies, submit, board, faucet).
 * Refuses production requests that have neither a matching Origin/Referer nor
 * Sec-Fetch-Site: same-origin. Does not accept bare scripted POSTs.
 */
export function requireBrowserOrigin(req: NextRequest): boolean {
  if (!isProduction() && ALLOWED_ORIGINS.length === 0) return true

  const origin = requestOrigin(req)
  const self = siteOrigin(req)
  if (origin && self && origin === self) return true
  if (ALLOWED_ORIGINS.length > 0 && origin && ALLOWED_ORIGINS.includes(origin)) return true

  if (!origin && req.headers.get('sec-fetch-site') === 'same-origin') return true
  return false
}
