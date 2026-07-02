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

  if (ALLOWED_ORIGINS.length > 0) {
    if (!requestOrigin) return false
    return ALLOWED_ORIGINS.includes(requestOrigin)
  }

  // No explicit allow-list configured.
  if (!isProduction()) {
    // Development: allow everything to keep local dev simple.
    return true
  }

  // Production fallback: allow same-host requests so the faucet keeps working
  // even when ALLOWED_ORIGINS has not been set after a deployment/restart.
  if (!requestOrigin) return false
  const host = req.headers.get('host')
  if (!host) return false
  // Derive the scheme from x-forwarded-proto (set by Vercel/proxies), or fall
  // back to the scheme already present in the request URL.
  const proto =
    req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
    toOrigin(req.url)?.split(':')[0] ||
    'https'
  const siteOrigin = `${proto}://${host}`
  return requestOrigin === siteOrigin
}
