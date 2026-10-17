// GET /api/first35/status — seats filled (approved entries) vs remaining, plus the public seat-holder list
// (approved only: seat, tier, account name). Public; no handles, notes or IPs.
import { NextResponse } from 'next/server'
import { FIRST35_SEATS } from '@/config/first35'
import { first35Store, publicHolders } from '@/lib/first35-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const store = first35Store()
    const [count, rows] = await Promise.all([store.approvedCount(), store.list()])
    const filled = Math.min(FIRST35_SEATS, count)
    // Public list: approved seats only, account name + seat + tier. No handles, notes or IPs.
    return NextResponse.json({ seats: FIRST35_SEATS, filled, remaining: FIRST35_SEATS - filled, holders: publicHolders(rows) })
  } catch (e) {
    console.error('[first35/status]', e)
    return NextResponse.json({ error: 'Unavailable' }, { status: 503 })
  }
}
