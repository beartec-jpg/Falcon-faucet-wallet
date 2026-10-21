// GET /api/airdrop/operators — operators pool leaderboard with projected share (proposed model).
import { NextResponse } from 'next/server'
import { OPERATORS_CONFIG } from '@/config/operators'
import { allocateOperators } from '@/lib/operator-score'
import { operatorStore } from '@/lib/operator-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const rows = await operatorStore().since(OPERATORS_CONFIG.windowStart)
    return NextResponse.json({ generated_at: Date.now(), ...allocateOperators(rows) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[airdrop/operators]', e)
    return NextResponse.json({ error: 'Operators leaderboard unavailable' }, { status: 503 })
  }
}
