// Vercel cron — sample network metrics every 5 min into shared Redis (24h retention).

import { NextRequest, NextResponse } from 'next/server'
import { appendMetricSamples } from '@/lib/metric-store'
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
    await appendMetricSamples(metrics)
    return NextResponse.json({
      ok: true,
      at: Date.now(),
      ledger: validated_ledger ?? null,
      metrics,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 })
  }
}