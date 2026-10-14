'use client'

import { useEffect, useRef, useState } from 'react'
import type { ScanData } from '@/lib/scan-types'
import { sampleFromScan, windowRate, type NetRates, type NetSample } from '@/lib/net-metrics'
import { recordSample } from '@/lib/metric-history'

/** Keep this much live history in memory for the live charts / rate windows. */
const KEEP_MS = 15 * 60_000

export interface LiveSamples {
  samples: NetSample[]
  /** ~10s, 60s and 5 min windows over the live polls. */
  rate10s: NetRates | null
  rate60s: NetRates | null
  rate5m: NetRates | null
}

/**
 * Turn successive /api/scan snapshots into timestamped samples and live rates,
 * and feed the 24h localStorage ring buffer. Duplicate snapshots (same height and
 * counters) are ignored so a cached response does not read as a zero-rate interval.
 */
export function useLiveSamples(data: ScanData | null): LiveSamples {
  const ref = useRef<NetSample[]>([])
  const [, bump] = useState(0)

  useEffect(() => {
    if (!data) return
    const s = sampleFromScan(data, Date.now())
    const arr = ref.current
    const last = arr[arr.length - 1]
    if (last && last.txs_sealed === s.txs_sealed && last.ledgers_sealed === s.ledgers_sealed) return
    // Counter went backwards (served by a different seat): restart the window.
    if (last && (s.txs_sealed < last.txs_sealed || s.ledgers_sealed < last.ledgers_sealed)) arr.length = 0
    arr.push(s)
    const cutoff = s.t - KEEP_MS
    while (arr.length > 2 && arr[0].t < cutoff) arr.shift()
    recordSample(s)
    bump((n) => n + 1)
  }, [data])

  const samples = ref.current
  return {
    samples,
    rate10s: windowRate(samples, 10_000),
    rate60s: windowRate(samples, 60_000),
    rate5m: windowRate(samples, 5 * 60_000),
  }
}
