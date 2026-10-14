// GET /api/scan/history — shared 24h metric time series (Neon / Redis / memory).
// Network keys: tps, blocks_min, txs_per_block, mempool, peers, online.
// Seat keys: seat.<id>.lag | seat.<id>.packs_min | seat.<id>.perf.
// Optional ?prefix=seat.v1. narrows the response.

import { NextRequest, NextResponse } from 'next/server'
import type { MetricPoint } from '@/lib/metric-history'
import {
  COUNTER_PREFIX,
  getAllStoredSeries,
  metricStoreBackend,
  type MetricStoreBackend,
} from '@/lib/metric-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface HistoryResponse {
  series: Record<string, MetricPoint[]>
  backend: MetricStoreBackend
  points: number
  /** Server sampling interval (Vercel cron). */
  interval_ms: number
}

export async function GET(req: NextRequest) {
  const prefix = req.nextUrl.searchParams.get('prefix')?.trim() ?? ''
  try {
    const all = await getAllStoredSeries()
    const series: Record<string, MetricPoint[]> = {}
    let points = 0
    for (const [k, v] of Object.entries(all)) {
      if (!v?.length || k.startsWith(COUNTER_PREFIX)) continue
      if (prefix && !k.startsWith(prefix)) continue
      series[k] = v
      points += v.length
    }
    return NextResponse.json(
      { series, backend: metricStoreBackend(), points, interval_ms: 5 * 60_000 } satisfies HistoryResponse,
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=240' } },
    )
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 })
  }
}
