'use client'

import { useEffect, useRef, useState } from 'react'
import type { ScanData } from '@/lib/scan-types'
import { useLiveSamples, type LiveSamples } from '@/hooks/useLiveSamples'

export interface SealedBlock {
  height: number
  /** Packer, when known (tip block, or present in the server's recent_ledgers ring). */
  packer: string | null
  txs: number | null
  /** Client time the block was first seen. */
  seenAt: number
}

export interface PollEvent {
  /** Client time of the poll that observed the change. */
  at: number
  /** Blocks sealed since the previous poll, oldest first. */
  blocks: SealedBlock[]
  /** Sealed txs since the previous poll (Δ txs_sealed). */
  newTxs: number
}

export interface NetworkFeed {
  data: ScanData | null
  error: string | null
  live: LiveSamples
  blocks: SealedBlock[]
  /** Last poll that saw new blocks; the scene keys animations on `at`. */
  event: PollEvent | null
  lastPollMs: number | null
}

const KEEP_BLOCKS = 40

/**
 * Poll /api/scan every `pollMs` (next poll starts `pollMs` after the previous one
 * started, never overlapping). Every animation the map shows is triggered by a
 * change seen here; nothing is interpolated or invented between polls.
 */
export function useNetworkFeed(pollMs: number): NetworkFeed {
  const [data, setData] = useState<ScanData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<SealedBlock[]>([])
  const [event, setEvent] = useState<PollEvent | null>(null)
  const [lastPollMs, setLastPollMs] = useState<number | null>(null)
  const prev = useRef<ScanData | null>(null)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const run = async () => {
      const started = Date.now()
      try {
        const r = await fetch('/api/scan', { cache: 'no-store', signal: AbortSignal.timeout(8000) })
        const d = (await r.json()) as ScanData & { error?: string }
        if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`)
        if (!alive) return
        const p = prev.current
        const at = Date.now()
        if (p && d.height > p.height) {
          const known = new Map((d.recent_ledgers ?? []).map((l) => [l.seq, l]))
          const n = Math.min(d.height - p.height, 12)
          const fresh: SealedBlock[] = []
          for (let h = d.height - n + 1; h <= d.height; h++) {
            const k = known.get(h)
            const isTip = h === d.last_pack?.height
            fresh.push({
              height: h,
              packer: isTip ? d.last_pack.packer : (k?.packer ?? null),
              txs: isTip ? d.last_pack.txs : (k?.txn_count ?? null),
              seenAt: at,
            })
          }
          const newTxs = Math.max(0, (d.metrics?.txs_sealed ?? 0) - (p.metrics?.txs_sealed ?? 0))
          setBlocks((b) => [...fresh.reverse(), ...b].slice(0, KEEP_BLOCKS))
          setEvent({ at, blocks: fresh.slice().reverse(), newTxs })
        }
        prev.current = d
        setData(d)
        setError(null)
        setLastPollMs(at - started)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) timer = setTimeout(run, Math.max(250, pollMs - (Date.now() - started)))
      }
    }
    void run()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [pollMs])

  const live = useLiveSamples(data)
  return { data, error, live, blocks, event, lastPollMs }
}
