/**
 * Shared security helpers for API routes.
 */

import type { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'

/** Prefer platform client IP; avoid trusting leftmost X-Forwarded-For from clients. */
export function clientIp(req: NextRequest): string {
  const realIp = req.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length === 1) return parts[0]
    // On Vercel the leftmost is typically the client after edge rewrite.
    if (process.env.VERCEL === '1' && parts[0]) return parts[0]
    return parts[parts.length - 1] ?? 'unknown'
  }

  return 'unknown'
}

/** Constant-time string compare for bearer tokens (length-mismatch → false). */
export function timingSafeEqualString(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'utf8')
    const bb = Buffer.from(b, 'utf8')
    if (ba.length !== bb.length) return false
    return timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

/** Extract Bearer token; rejects raw non-Bearer secret in header. */
export function bearerToken(req: NextRequest): string | null {
  const h = req.headers.get('authorization') ?? ''
  const m = /^Bearer\s+(\S+)$/i.exec(h)
  return m?.[1] ?? null
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1'
}
