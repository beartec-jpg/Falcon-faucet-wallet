// GET /api/first35/status — seats filled (approved entries) vs remaining. Public; no personal data.
import { NextResponse } from 'next/server'
import { FIRST35_SEATS } from '@/config/first35'
import { first35Store } from '@/lib/first35-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const filled = Math.min(FIRST35_SEATS, await first35Store().approvedCount())
    return NextResponse.json({ seats: FIRST35_SEATS, filled, remaining: FIRST35_SEATS - filled })
  } catch (e) {
    console.error('[first35/status]', e)
    return NextResponse.json({ error: 'Unavailable' }, { status: 503 })
  }
}
