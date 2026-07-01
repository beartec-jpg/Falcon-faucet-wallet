// Shared origin allow-list check for state-changing API routes (CSRF defence).
//
// Configure ALLOWED_ORIGINS as a comma-separated list of allowed site origins,
// e.g. "https://wallet.example.com,https://preview.example.com".
//
// Security: when ALLOWED_ORIGINS is not set we FAIL CLOSED in production so a
// misconfigured deployment cannot be driven cross-site. In development/testnet
// (no NODE_ENV=production / VERCEL) we allow requests to keep local dev simple.

import type { NextRequest } from 'next/server'

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1'
}

export function isOriginAllowed(req: NextRequest): boolean {
  if (ALLOWED_ORIGINS.length === 0) {
    // No allow-list configured: permit in dev, deny in production.
    return !isProduction()
  }
  const origin = req.headers.get('origin') || req.headers.get('referer') || ''
  if (!origin) return false
  return ALLOWED_ORIGINS.some((allowed) => origin.startsWith(allowed))
}
