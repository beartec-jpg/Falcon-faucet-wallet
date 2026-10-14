// GET /api/scan/activity — testnet activity leaderboard (JSON, or ?format=csv for export).
import { NextRequest, NextResponse } from 'next/server'
import { boardCsv } from '@/lib/activity-index'
import { getRailsPools } from '@/lib/rails-pools-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { activity, generated_at } = await getRailsPools()
    if (req.nextUrl.searchParams.get('format') === 'csv') {
      return new NextResponse(boardCsv(activity.rows), {
        headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="falcon-testnet-activity.csv"' },
      })
    }
    return NextResponse.json({ generated_at, ...activity })
  } catch (e) {
    console.error('[scan/activity]', e)
    return NextResponse.json({ error: 'Node unavailable' }, { status: 503 })
  }
}
