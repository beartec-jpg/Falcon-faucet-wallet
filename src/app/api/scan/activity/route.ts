// GET /api/scan/activity — kept for PR #101 links: the user board (JSON, or ?format=csv).
import { NextRequest, NextResponse } from 'next/server'
import { trackerCsv } from '@/lib/tracker'
import { trackerPayload } from '@/lib/tracker-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const p = await trackerPayload()
    if (req.nextUrl.searchParams.get('format') === 'csv') {
      return new NextResponse(trackerCsv(p.board), {
        headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="falcon-testnet-activity.csv"' },
      })
    }
    return NextResponse.json({ generated_at: p.generated_at, rows: p.board, building: p.building, stats: p.stats })
  } catch (e) {
    console.error('[scan/activity]', e)
    return NextResponse.json({ error: 'Node unavailable' }, { status: 503 })
  }
}
