// Public network health JSON for /network/health. Read-only; built from the
// brief status the site already fetches plus the cron's stored state.

import { NextResponse } from 'next/server'
import { networkHealth } from '@/lib/network-health-server'
import type { NetworkHealth } from '@/lib/network-health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

let cache: { at: number; body: NetworkHealth } | null = null
const TTL_MS = 15_000

export async function GET() {
  const now = Date.now()
  try {
    if (!cache || now - cache.at > TTL_MS) cache = { at: now, body: await networkHealth(now) }
    return NextResponse.json(cache.body, { headers: { 'cache-control': 'public, s-maxage=15, stale-while-revalidate=30' } })
  } catch (e) {
    console.error('[api/network/health]', e)
    if (cache) return NextResponse.json({ ...cache.body, stale: true })
    return NextResponse.json({ error: 'Network status unavailable' }, { status: 503 })
  }
}
