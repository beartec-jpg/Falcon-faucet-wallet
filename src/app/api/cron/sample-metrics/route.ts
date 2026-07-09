// Vercel cron — sample network metrics every 5 min into shared Redis (24h retention).

import { NextRequest, NextResponse } from 'next/server'
import { appendMetricSamples, pruneMetricSamples } from '@/lib/metric-store'
import { collectNetworkMetrics } from '@/lib/scan-metrics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const sample = await collectNetworkMetrics()
    const { validated_ledger, ...metrics } = sample
    const at = Date.now()
    await appendMetricSamples(metrics, at)
    const pruned = await pruneMetricSamples(at)
    return NextResponse.json({
      ok: true,
      at,
      ledger: validated_ledger ?? null,
      metrics,
      pruned,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 })
  }
}