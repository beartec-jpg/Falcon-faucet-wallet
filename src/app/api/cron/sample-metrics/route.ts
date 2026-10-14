// Vercel cron — every 5 min, sample the PL status into the shared 24h store.

import { NextRequest, NextResponse } from 'next/server'
import { appendMetricSamples, getAllStoredSeries, pruneMetricSamples } from '@/lib/metric-store'
import {
  collectNetworkSample,
  counterValues,
  previousSampleFromCounters,
  seriesValues,
} from '@/lib/scan-metrics'
import { bearerToken, isProductionRuntime, timingSafeEqualString } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    if (isProductionRuntime()) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
    }
  } else {
    const auth = bearerToken(req)
    if (!auth || !timingSafeEqualString(auth, secret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const at = Date.now()
    const sample = await collectNetworkSample(at)
    const stored = await getAllStoredSeries()
    const prev = previousSampleFromCounters(stored, at)
    const values = seriesValues(prev, sample)
    await appendMetricSamples({ ...values, ...counterValues(sample) }, at)
    const pruned = await pruneMetricSamples(at)
    return NextResponse.json({
      ok: true,
      at,
      height: sample.height,
      rate_base_ms: prev ? at - prev.t : null,
      keys: Object.keys(values).length,
      tps: values.tps ?? null,
      pruned,
    })
  } catch (e) {
    console.error('[cron/sample-metrics]', e)
    return NextResponse.json({ error: 'Metrics sample failed' }, { status: 503 })
  }
}
