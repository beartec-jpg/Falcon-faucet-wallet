// Shared origin allow-list check for state-changing API routes (CSRF defence).
//
// Configure ALLOWED_ORIGINS as a comma-separated list of allowed site origins,
// e.g. "https://wallet.example.com,https://preview.example.com".
//
// Security: when ALLOWED_ORIGINS is not set we FAIL CLOSED in production so a
// misconfigured deployment cannot be driven cross-site. In development/testnet
// (no NODE_ENV=production / VERCEL) we allow requests to keep local dev simple.

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
  if (ALLOWED_ORIGINS.length === 0) {
    // No allow-list configured: permit in dev, deny in production.
    return !isProduction()
  }

  // Prefer the Origin header; fall back to the Referer parsed down to its origin.
  // We compare the exact origin (not a prefix) to avoid suffix-based bypasses
  // such as https://wallet.example.com.attacker.com.
  const rawOrigin = req.headers.get('origin')
  const rawReferer = req.headers.get('referer')
  const requestOrigin =
    (rawOrigin && toOrigin(rawOrigin)) ||
    (rawReferer && toOrigin(rawReferer)) ||
    null

  if (!requestOrigin) return false
  return ALLOWED_ORIGINS.includes(requestOrigin)
}
