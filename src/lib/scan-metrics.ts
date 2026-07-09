// Lightweight network metric sampler (RPC) — used by /api/scan, cron, and history backfill.

import { DEFAULT_RPC_URL } from '@/lib/rpc'
import type { MetricKey } from '@/lib/metric-history'

const RPC = process.env.XRPLD_RPC_URL ?? DEFAULT_RPC_URL
const RIPPLE_EPOCH = 946684800
const CLOSE_EST_SEC = 3.5

async function rpc<T = Record<string, unknown>>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params: [params] }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`RPC ${res.status}`)
  const body = await res.json()
  return body.result as T
}

export interface NetworkMetricSample extends Partial<Record<MetricKey, number>> {
  validated_ledger?: number
}

export async function collectNetworkMetrics(): Promise<NetworkMetricSample> {
  const [srvR, feeR] = await Promise.all([
    rpc<{ info: Record<string, unknown> }>('server_info', {}),
    rpc<Record<string, unknown>>('fee', {}),
  ])

  const info = srvR.info
  const valSeq = ((info.validated_ledger as Record<string, unknown>)?.seq as number) ?? 0
  const peers = (info.peers as number) ?? 0

  const ledgerNums = Array.from({ length: 10 }, (_, i) => valSeq - i).filter((s) => s > 0)
  const ledgerResults = await Promise.all(
    ledgerNums.map((seq) =>
      rpc<{ ledger: Record<string, unknown> }>('ledger', {
        ledger_index: seq,
        transactions: true,
        expand: false,
      }).catch(() => null),
    ),
  )

  const ledgers = ledgerResults
    .filter(Boolean)
    .map((r) => {
      const l = r!.ledger
      const txns = (l.transactions as string[] | undefined) ?? []
      return {
        seq: (l.seqNum as number) ?? (l.ledger_index as number) ?? 0,
        txn_count: txns.length,
        close_time: (l.close_time as number) ?? 0,
        base_fee: Number(l.base_fee ?? 12),
      }
    })
    .sort((a, b) => a.seq - b.seq)

  let totalTxs = 0
  let totalSeconds = 0
  for (let i = 1; i < ledgers.length; i++) {
    totalTxs += ledgers[i].txn_count
    const dt = ledgers[i].close_time - ledgers[i - 1].close_time
    if (dt > 0 && dt < 30) totalSeconds += dt
  }
  const avgClose = ledgers.length > 1 ? totalSeconds / (ledgers.length - 1) : 3
  const avgTxPerL = ledgers.length > 1 ? totalTxs / (ledgers.length - 1) : 0
  const tps = avgClose > 0 ? avgTxPerL / avgClose : 0

  const drops = (feeR.drops as Record<string, unknown>) ?? {}
  const medFeeDrops = parseInt((drops.median_fee ?? drops.base_fee ?? '12') as string, 10)
  const curFeeDrops = parseInt((drops.minimum_fee ?? '12') as string, 10)
  const txQueue = (feeR.current_queue_size as number) ?? 0

  return {
    validated_ledger: valSeq,
    tps: Math.round(tps * 100) / 100,
    avg_close: Math.round(avgClose * 10) / 10,
    base_fee: curFeeDrops,
    median_fee: medFeeDrops,
    tx_queue: txQueue,
    peers,
  }
}

/** Ledger-sampled backfill for metrics that exist on-chain (TPS, close, base fee). */
export async function ledgerMetricBackfill(points = 72): Promise<Partial<Record<MetricKey, Array<{ t: number; v: number }>>>> {
  const srvR = await rpc<{ info: Record<string, unknown> }>('server_info', {})
  const valSeq = ((srvR.info.validated_ledger as Record<string, unknown>)?.seq as number) ?? 0
  if (valSeq <= 0) return {}

  const ledgers24h = Math.floor(86400 / CLOSE_EST_SEC)
  const span = Math.min(valSeq, ledgers24h)
  const step = Math.max(1, Math.floor(span / points))
  const indices = Array.from({ length: Math.min(points, Math.floor(span / step) + 1) }, (_, i) =>
    Math.max(1, valSeq - i * step),
  ).reverse()

  const ledgerResults = await Promise.all(
    indices.map((seq) =>
      rpc<{ ledger: Record<string, unknown> }>('ledger', {
        ledger_index: seq,
        transactions: true,
        expand: false,
      }).catch(() => null),
    ),
  )

  const ledgers = ledgerResults
    .filter(Boolean)
    .map((r) => {
      const l = r!.ledger
      const txns = (l.transactions as string[] | undefined) ?? []
      return {
        txn_count: txns.length,
        close_time: (l.close_time as number) ?? 0,
        base_fee: Number(l.base_fee ?? 12),
      }
    })
    .sort((a, b) => a.close_time - b.close_time)

  const tps: Array<{ t: number; v: number }> = []
  const avgClose: Array<{ t: number; v: number }> = []
  const baseFee: Array<{ t: number; v: number }> = []

  for (let i = 1; i < ledgers.length; i++) {
    const cur = ledgers[i]
    const prev = ledgers[i - 1]
    const dt = cur.close_time - prev.close_time
    if (dt <= 0 || dt > 30) continue
    const ts = (cur.close_time + RIPPLE_EPOCH) * 1000
    tps.push({ t: ts, v: Math.round((cur.txn_count / dt) * 100) / 100 })
    avgClose.push({ t: ts, v: Math.round(dt * 10) / 10 })
    baseFee.push({ t: ts, v: cur.base_fee })
  }

  return { tps, avg_close: avgClose, base_fee: baseFee }
}