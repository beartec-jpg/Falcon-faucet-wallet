import { NextResponse } from 'next/server'
import { plStatus } from '@/lib/pl-rpc'

export const dynamic = 'force-dynamic'

/** Live Falcon PL AMM pools and lend markets. Matching happens in the ledger. */
export async function GET() {
  try {
    const st = await plStatus(false)
    return NextResponse.json({
      ok: true,
      pools: st.defi_pools ?? [],
      markets: st.defi_markets ?? [],
      ammPools: st.amm_pools ?? 0,
      lendMarkets: st.lend_markets ?? 0,
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'status failed', pools: [], markets: [] },
      { status: 502 },
    )
  }
}
