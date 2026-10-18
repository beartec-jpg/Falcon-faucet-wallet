import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Bridge operator stats from an operator kit's public feed (GET http://<host>:19481/feed).
 * Configure with FPL_OPERATOR_FEED_URL. Unset / unreachable => empty list (no operators online yet).
 */
export type OperatorRow = { name: string; xonly: string; availableSats: number; lastSeen: number; heartbeats: number }
export type OperatorsResponse = { configured: boolean; ok: boolean; operators: OperatorRow[]; generated: number | null }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

export async function GET() {
  const url = process.env.FPL_OPERATOR_FEED_URL?.trim()
  const empty: OperatorsResponse = { configured: Boolean(url), ok: false, operators: [], generated: null }
  if (!url) return NextResponse.json(empty)
  try {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (!r.ok) return NextResponse.json(empty)
    const j = (await r.json()) as { generated?: number; operators?: Array<Record<string, unknown>> }
    const operators: OperatorRow[] = (Array.isArray(j.operators) ? j.operators : []).map((o) => ({
      name: typeof o.name === 'string' ? o.name : '',
      xonly: typeof o.xonly === 'string' ? o.xonly : '',
      availableSats: num(o.available_sats),
      lastSeen: num(o.last_seen),
      heartbeats: num(o.heartbeats),
    }))
    return NextResponse.json({ configured: true, ok: true, operators, generated: num(j.generated) || null } satisfies OperatorsResponse)
  } catch {
    return NextResponse.json(empty)
  }
}
