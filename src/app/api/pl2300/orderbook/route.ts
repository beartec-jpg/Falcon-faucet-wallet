import { NextResponse } from 'next/server'
import { plRpc, plStatus } from '@/lib/pl-rpc'
import { meshHeadFromStatus } from '@/lib/pl-mesh'
import { ORDERBOOK_ACTIVATION_HEIGHT } from '@/config/orderbook'

export const dynamic = 'force-dynamic'

/** Reply body as JSON with every 16+ digit integer kept as a string (u64 raw amounts). */
function bodyOf(r: Record<string, unknown>): Record<string, unknown> {
  const raw = typeof r.raw === 'string' ? r.raw : ''
  if (raw) {
    try {
      const safe = JSON.parse(raw.replace(/:\s*(\d{16,})(?=\s*[,}\]])/g, ':"$1"')) as Record<string, unknown>
      if (safe && typeof safe.body === 'object' && safe.body) return safe.body as Record<string, unknown>
    } catch { /* fall through */ }
  }
  return (r.body ?? {}) as Record<string, unknown>
}

function pairOf(raw: string | null): string {
  const s = (raw || '').trim().toUpperCase().replace(/[/_]/g, '-')
  const base = s.endsWith('-FPL') ? s.slice(0, -4) : s
  return /^[A-Z0-9]{1,16}$/.test(base) && base !== 'FPL' ? `${base}-FPL` : ''
}

function accountOf(raw: string | null): string {
  const s = (raw || '').trim().toLowerCase()
  return /^[a-z0-9._-]{1,64}$/.test(s) ? s : ''
}

/**
 * Falcon PL 2.10.4 on-ledger order book (read-only). Matching happens in the ledger;
 * this route only relays the node's OrderBookQuery / OpenOrdersQuery / FillsQuery.
 * ?pair=USDC-FPL[&levels=20][&account=name][&fills=30]
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const pair = pairOf(url.searchParams.get('pair'))
  const account = accountOf(url.searchParams.get('account'))
  const levels = Math.min(200, Math.max(1, Number(url.searchParams.get('levels')) || 20))
  const fillLimit = Math.min(200, Math.max(1, Number(url.searchParams.get('fills')) || 30))
  let height = 0
  try {
    height = meshHeadFromStatus(await plStatus(false)).height
  } catch { /* height unknown */ }
  const active = height > 0 && height + 1 >= ORDERBOOK_ACTIVATION_HEIGHT
  const out: Record<string, unknown> = { ok: true, pair, height, activationHeight: ORDERBOOK_ACTIVATION_HEIGHT, active }
  if (!active) return NextResponse.json(out, { headers: { 'cache-control': 'no-store' } })
  try {
    const jobs: Promise<void>[] = []
    if (pair) {
      jobs.push(
        plRpc({ type: 'order_book_query', pair, levels }).then((r) => {
          if (r.type === 'err') throw new Error(String(r.msg ?? 'order book error'))
          out.book = bodyOf(r)
        }),
      )
      jobs.push(
        plRpc({ type: 'fills_query', pair, account: null, limit: fillLimit }).then((r) => {
          if (r.type !== 'err') out.fills = (bodyOf(r).fills ?? []) as unknown[]
        }),
      )
    }
    if (account) {
      jobs.push(
        plRpc({ type: 'open_orders_query', account }).then((r) => {
          if (r.type !== 'err') out.openOrders = (bodyOf(r).orders ?? []) as unknown[]
        }),
      )
    }
    await Promise.all(jobs)
    return NextResponse.json(out, { headers: { 'cache-control': 'no-store' } })
  } catch (e: unknown) {
    console.error('[api/pl2300/orderbook]', e)
    return NextResponse.json({ ...out, ok: false, error: e instanceof Error ? e.message : 'Node unavailable' }, { status: 503 })
  }
}
