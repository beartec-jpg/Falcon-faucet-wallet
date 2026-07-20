// GET /api/arcade/leaderboard?network=testnet&game=falcon-flight&limit=25

import { NextRequest, NextResponse } from 'next/server'
import { getLeaderboard, isGameSlug } from '@/lib/arcade-store'
import { resolveNetworkKey } from '@/lib/network-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const networkKey = resolveNetworkKey(sp.get('network'))
  const gameRaw = sp.get('game')?.trim()
  const game = gameRaw && isGameSlug(gameRaw) ? gameRaw : undefined
  const limit = parseInt(sp.get('limit') ?? '25', 10)

  const entries = await getLeaderboard({
    network: networkKey,
    game,
    limit: Number.isFinite(limit) ? limit : 25,
  })

  return NextResponse.json({
    network: networkKey,
    game: game ?? 'all',
    dayUtc: new Date().toISOString().slice(0, 10),
    entries,
  })
}
