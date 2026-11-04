// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// Minimal Stripe REST client + webhook signature check (no SDK dependency).
import { createHmac, timingSafeEqual } from 'crypto'

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY?.trim()
}

function encode(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (typeof v === 'object') out.push(...encode(v as Record<string, unknown>, key))
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`)
  }
  return out
}

export async function stripeRequest<T = any>(method: 'GET' | 'POST', path: string, params: Record<string, unknown> = {}): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured')
  const qs = encode(params).join('&')
  const url = `https://api.stripe.com/v1${path}${method === 'GET' && qs ? `?${qs}` : ''}`
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'POST' ? qs : undefined,
    cache: 'no-store',
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.message ?? `Stripe ${res.status}`)
  return json as T
}

/** Verify a Stripe-Signature header (v1 HMAC-SHA256, 5 min tolerance). */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, toleranceSec = 300, now = Date.now()): boolean {
  if (!header) return false
  const parts = header.split(',').map((p) => p.split('='))
  const t = parts.find(([k]) => k === 't')?.[1]
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v)
  if (!t || !sigs.length) return false
  if (Math.abs(now / 1000 - Number(t)) > toleranceSec) return false
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex'))
  return sigs.some((s) => { const b = Buffer.from(s); return b.length === expected.length && timingSafeEqual(b, expected) })
}
