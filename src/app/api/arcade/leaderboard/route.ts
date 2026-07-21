// GET /api/arcade/leaderboard?network=testnet&game=falcon-flight&limit=25

import { NextRequest, NextResponse } from 'next/server'
import { getLeaderboard, isGameSlug } from '@/lib/arcade-store'
import { resolveNetworkKey } from '@/lib/network-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function buildAllowSet(): Set<string> {
  const set = new Set<string>([
    'https://falcon-ledger.com',
    'https://www.falcon-ledger.com',
    'https://falcon-arcade-lake.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
  ])
  for (const envVar of [
    process.env.NEXT_PUBLIC_ARCADE_URL,
    process.env.ALLOWED_ORIGINS,
  ]) {
    if (!envVar) continue
    for (const part of envVar.split(',')) {
      const t = part.trim()
      if (!t) continue
      try {
        set.add(new URL(t).origin)
      } catch {
        /* ignore */
      }
    }
  }
  return set
}

const EXACT_ALLOW = buildAllowSet()

function corsHeaders(req: NextRequest): HeadersInit {
  const origin = req.headers.get('origin')
  let allow = 'https://falcon-ledger.com'
  if (origin && EXACT_ALLOW.has(origin)) {
    allow = origin
  } else if (
    origin &&
    /^https:\/\/falconledger[\w-]*\.vercel\.app$/.test(origin)
  ) {
    allow = origin
  }
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
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
