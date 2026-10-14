// GET /api/scan/tracker — testnet activity boards (users + operators). ?format=csv[&board=operators]
import { NextRequest, NextResponse } from 'next/server'
import { operatorsCsv, trackerCsv } from '@/lib/tracker'
import { trackerPayload } from '@/lib/tracker-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const p = await trackerPayload()
    if (req.nextUrl.searchParams.get('format') === 'csv') {
      const ops = req.nextUrl.searchParams.get('board') === 'operators'
      return new NextResponse(ops ? operatorsCsv(p.operators) : trackerCsv(p.board), {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="falcon-testnet-${ops ? 'operators' : 'activity'}.csv"`,
        },
      })
    }
    return NextResponse.json(p, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    console.error('[scan/tracker]', e)
    return NextResponse.json({ error: 'Node unavailable' }, { status: 503 })
  }
}
