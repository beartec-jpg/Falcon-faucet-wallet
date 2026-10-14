// GET /api/scan/rails-pools — Rails (USDC / ETH / BTC), Pools and the testnet activity board.
import { NextResponse } from 'next/server'
import { getRailsPools } from '@/lib/rails-pools-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(await getRailsPools(), { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    console.error('[scan/rails-pools]', e)
    return NextResponse.json({ error: 'Node unavailable' }, { status: 503 })
  }
}
