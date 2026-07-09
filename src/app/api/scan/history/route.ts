// GET /api/scan/history — ledger-sampled time series for explorer charts (up to 24h).

import { NextResponse } from 'next/server'
import { DEFAULT_RPC_URL } from '@/lib/rpc'
import type { MetricKey } from '@/lib/metric-history'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RPC = process.env.XRPLD_RPC_URL ?? DEFAULT_RPC_URL
const RIPPLE_EPOCH = 946684800
const CLOSE_EST_SEC = 3.5
const POINTS = 72

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

export interface HistoryResponse {
  series: Partial<Record<MetricKey, Array<{ t: number; v: number }>>>
  sampled_ledgers: number
}

export async function GET() {
  try {
    const srvR = await rpc<{ info: Record<string, unknown> }>('server_info', {})
    const valSeq = ((srvR.info.validated_ledger as Record<string, unknown>)?.seq as number) ?? 0
    if (valSeq <= 0) {
      return NextResponse.json({ series: {}, sampled_ledgers: 0 } satisfies HistoryResponse)
    }

    const ledgers24h = Math.floor(86400 / CLOSE_EST_SEC)
    const span = Math.min(valSeq, ledgers24h)
    const step = Math.max(1, Math.floor(span / POINTS))
    const indices = Array.from({ length: Math.min(POINTS, Math.floor(span / step) + 1) }, (_, i) =>
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
          seq: (l.seqNum as number) ?? (l.ledger_index as number) ?? 0,
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

    return NextResponse.json({
      series: {
        tps,
        avg_close: avgClose,
        base_fee: baseFee,
      },
      sampled_ledgers: ledgers.length,
    } satisfies HistoryResponse)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 })
  }
}