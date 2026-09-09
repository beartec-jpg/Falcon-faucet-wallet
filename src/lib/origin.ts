// Shared origin allow-list check for state-changing API routes (CSRF defence).
//
// Configure ALLOWED_ORIGINS as a comma-separated list of allowed site origins,
// e.g. "https://wallet.example.com,https://preview.example.com".
//
// When ALLOWED_ORIGINS is not set the check falls back to same-host matching:
// requests whose Origin/Referer origin equals https://<Host> are allowed.
// In development (no NODE_ENV=production / VERCEL) all requests are allowed to
// keep local dev simple.

import type { NextRequest } from 'next/server'

/** Normalise a URL string to its origin (scheme://host[:port]), or null. */
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

export function isOriginAllowed(req: NextRequest): boolean {
  // Prefer the Origin header; fall back to the Referer parsed down to its origin.
  // We compare the exact origin (not a prefix) to avoid suffix-based bypasses
  // such as https://wallet.example.com.attacker.com.
  const rawOrigin = req.headers.get('origin')
  const rawReferer = req.headers.get('referer')
  const requestOrigin =
    (rawOrigin && toOrigin(rawOrigin)) ||
    (rawReferer && toOrigin(rawReferer)) ||
    null
  const self = siteOrigin(req)

  // This deployment's own origin is always allowed (stale ALLOWED_ORIGINS
  // used to 403 create-wallet when the public host was not on the list).
  if (requestOrigin && self && requestOrigin === self) return true

  if (ALLOWED_ORIGINS.length > 0 && requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    return true
  }

  // Mobile / PWA / some WebViews omit Origin on POST. Same-site still sends this.
  if (!requestOrigin) {
    const site = req.headers.get('sec-fetch-site')
    if (site === 'same-origin' || site === 'none') return true
    if (self) return true
  }

  if (!isProduction() && ALLOWED_ORIGINS.length === 0) return true
  return false
}
