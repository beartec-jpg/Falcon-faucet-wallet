// GET /api/scan/history — shared 24h metric time series (Redis + ledger backfill).

import { NextResponse } from 'next/server'
import type { MetricKey } from '@/lib/metric-history'
import {
  getAllStoredSeries,
  mergeIntoStore,
  metricStoreBackend,
  METRIC_KEYS,
  type MetricStoreBackend,
} from '@/lib/metric-store'
import { ledgerMetricBackfill } from '@/lib/scan-metrics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface HistoryResponse {
  series: Partial<Record<MetricKey, Array<{ t: number; v: number }>>>
  backend: MetricStoreBackend
  points: number
}

export async function GET() {
  try {
    let series = await getAllStoredSeries()

    const tpsCount = series.tps?.length ?? 0
    if (tpsCount < 12) {
      const backfill = await ledgerMetricBackfill()
      await mergeIntoStore(backfill)
      series = await getAllStoredSeries()
      for (const key of METRIC_KEYS) {
        if (!series[key]?.length && backfill[key]?.length) {
          series[key] = backfill[key]
        }
      }
    }

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