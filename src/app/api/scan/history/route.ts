// GET /api/scan/history — shared 24h metric time series from Neon (fast read-only).

import { NextResponse } from 'next/server'
import type { MetricKey } from '@/lib/metric-history'
import {
  getAllStoredSeries,
  metricStoreBackend,
  METRIC_KEYS,
  type MetricStoreBackend,
} from '@/lib/metric-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface HistoryResponse {
  series: Partial<Record<MetricKey, Array<{ t: number; v: number }>>>
  backend: MetricStoreBackend
  points: number
}

export async function GET() {
  try {
    const series = await getAllStoredSeries()
    const points = METRIC_KEYS.reduce((n, k) => n + (series[k]?.length ?? 0), 0)

    return NextResponse.json({
      series,
      backend: metricStoreBackend(),
      points,
    } satisfies HistoryResponse)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 })
  }
}