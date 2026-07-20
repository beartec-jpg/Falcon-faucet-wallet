// GET /api/arcade/leaderboard?network=testnet&game=falcon-flight&limit=25

import { NextRequest, NextResponse } from 'next/server'
import { getLeaderboard, isGameSlug } from '@/lib/arcade-store'
import { resolveNetworkKey } from '@/lib/network-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function corsHeaders(req: NextRequest): HeadersInit {
  const origin = req.headers.get('origin')
  // Public read API — allow arcade iframe host + same-site
  const allow =
    origin &&
    (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
      origin.includes('vercel.app') ||
      origin.includes('falcon'))
      ? origin
      : '*'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) })
}

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

  return NextResponse.json(
    {
      network: networkKey,
      game: game ?? 'all',
      dayUtc: new Date().toISOString().slice(0, 10),
      entries,
    },
    { headers: corsHeaders(req) },
  )
}
