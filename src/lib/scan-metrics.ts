// 24h network sampler for the Vercel cron (/api/cron/sample-metrics).
//
// One PL status_req per run (the same snapshot /api/scan serves). Rates need two
// points in time, so the cron stores the raw cumulative counters under `ctr.*`
// keys and derives tx/s, blocks/min and per-seat packs/min from the previous run.

import type { MetricPoint } from '@/lib/metric-history'
import { buildScanSnapshot } from '@/lib/scan-snapshot'
import { sampleFromScan, seriesValues, type NetSample } from '@/lib/net-metrics'

/** Longest gap between cron runs we still compute a rate across. */
const MAX_RATE_GAP_MS = 20 * 60_000

export function counterValues(s: NetSample): Record<string, number> {
  const out: Record<string, number> = {
    'ctr.txs_sealed': s.txs_sealed,
    'ctr.ledgers_sealed': s.ledgers_sealed,
    'ctr.height': s.height,
  }
  for (const seat of s.seats) out[`ctr.seat.${seat.id}.packs`] = seat.packs
  return out
}

/** Rebuild the previous run's sample from stored counters (only fields rates need). */
export function previousSampleFromCounters(
  series: Record<string, MetricPoint[] | undefined>,
  now: number,
): NetSample | null {
  const last = (k: string) => {
    const a = series[k]
    return a?.length ? a[a.length - 1] : null
  }
  const tx = last('ctr.txs_sealed')
  const led = last('ctr.ledgers_sealed')
  if (!tx || !led || now - tx.t > MAX_RATE_GAP_MS || now - tx.t <= 0) return null
  const seats = Object.keys(series)
    .map((k) => /^ctr\.seat\.(.+)\.packs$/.exec(k))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => {
      const p = last(m[0])
      return p && p.t === tx.t
        ? { id: m[1], tip: 0, packs: p.v, online: false, jailed: false, perf: null }
        : null
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
  return {
    t: tx.t,
    height: last('ctr.height')?.v ?? led.v,
    txs_sealed: tx.v,
    ledgers_sealed: led.v,
    mempool: 0,
    peers: 0,
    online: 0,
    last_pack_txs: 0,
    last_pack_packer: '',
    seats,
  }
}

export async function collectNetworkSample(at = Date.now()): Promise<NetSample> {
  const snap = await buildScanSnapshot()
  return sampleFromScan(snap, at)
}

export { seriesValues }
