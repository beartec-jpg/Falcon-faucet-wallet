import { NextResponse } from 'next/server'
import { plRpc } from '@/lib/pl-rpc'

export const dynamic = 'force-dynamic'

/** Pull one JSON array out of the status line and keep 16-digit amounts as strings. */
function arrayOf(raw: string, key: string): unknown[] {
  const i = raw.indexOf(`"${key}":`)
  if (i < 0) return []
  const start = raw.indexOf('[', i)
  if (start < 0) return []
  let depth = 0
  for (let j = start; j < raw.length; j++) {
    const c = raw[j]
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) {
        const slice = raw.slice(start, j + 1).replace(/:\s*(\d{16,})(?=\s*[,}\]])/g, ':"$1"')
        const v = JSON.parse(slice) as unknown
        return Array.isArray(v) ? v : []
      }
    }
  }
  return []
}

function accountName(raw: string | null): string {
  const s = (raw || '').trim().toLowerCase()
  return /^[a-z0-9._-]{1,64}$/.test(s) ? s : ''
}

/** Live Falcon PL AMM pools and lend markets. Matching happens in the ledger. */
export async function GET(req: Request) {
  try {
    const account = accountName(new URL(req.url).searchParams.get('account'))
    const r = await plRpc({ type: 'status_req', include_accounts: false })
    if (r.type === 'err') throw new Error(String(r.msg ?? 'status error'))
    const raw = typeof r.raw === 'string' ? r.raw : ''
    const body = (r.body ?? {}) as { amm_pools?: number; lend_markets?: number }
    let positions: unknown[] = []
    let lp: unknown[] = []
    if (account) {
      const acct = await plRpc({ type: 'account_query', account })
      if (acct.type !== 'err') {
        const line = typeof acct.raw === 'string' ? acct.raw : ''
        positions = arrayOf(line, 'lend_positions')
        lp = arrayOf(line, 'lp')
      }
    }
    return NextResponse.json({
      ok: true,
      pools: arrayOf(raw, 'defi_pools'),
      markets: arrayOf(raw, 'defi_markets'),
      positions,
      lp,
      ammPools: body.amm_pools ?? 0,
      lendMarkets: body.lend_markets ?? 0,
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'status failed', pools: [], markets: [] },
      { status: 502 },
    )
  }
}
