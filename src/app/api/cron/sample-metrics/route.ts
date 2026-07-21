// Vercel cron — sample network metrics every 5 min into shared Redis (24h retention).

import { NextRequest, NextResponse } from 'next/server'
import {
  appendMetricSamples,
  getAllStoredSeries,
  mergeIntoStore,
  pruneMetricSamples,
} from '@/lib/metric-store'
import { collectNetworkMetrics, ledgerMetricBackfill } from '@/lib/scan-metrics'
import {
  bearerToken,
  isProductionRuntime,
  timingSafeEqualString,
} from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    if (isProductionRuntime()) {
      return NextResponse.json(
        { error: 'CRON_SECRET not configured' },
        { status: 503 },
      )
    }
  } else {
    const auth = bearerToken(req)
    if (!auth || !timingSafeEqualString(auth, secret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const sample = await collectNetworkMetrics()
    const { validated_ledger, ...metrics } = sample
    const at = Date.now()
    await appendMetricSamples(metrics, at)

    const existing = await getAllStoredSeries()
    if ((existing.tps?.length ?? 0) < 12) {
      const backfill = await ledgerMetricBackfill(24)
      await mergeIntoStore(backfill)
    }

    const pruned = await pruneMetricSamples(at)
    return NextResponse.json({
      ok: true,
      at,
      ledger: validated_ledger ?? null,
      metrics,
      pruned,
    })
  } catch (e) {
    console.error('[cron/sample-metrics]', e)
    return NextResponse.json({ error: 'Metrics sample failed' }, { status: 503 })
  }
}
