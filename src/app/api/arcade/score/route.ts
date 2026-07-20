// POST /api/arcade/score
// Body: { account, game, score, network? }
// Upserts best score for the UTC day (leaderboard + claim eligibility).

import { NextRequest, NextResponse } from 'next/server'
import { isValidClassicAddress } from 'ripple-address-codec'
import {
  isGameSlug,
  upsertArcadeScore,
} from '@/lib/arcade-store'
import { isOriginAllowed } from '@/lib/origin'
import { resolveNetworkKey } from '@/lib/network-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  let account = ''
  let game = ''
  let score = 0
  let networkKey = resolveNetworkKey(undefined)

  try {
    const body = await req.json()
    account = (body.account ?? '').toString().trim()
    game = (body.game ?? '').toString().trim()
    score = Number(body.score)
    networkKey = resolveNetworkKey(body.network)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!account || !isValidClassicAddress(account)) {
    return NextResponse.json({ error: 'Invalid account' }, { status: 400 })
  }
  if (!isGameSlug(game)) {
    return NextResponse.json({ error: 'Invalid game slug' }, { status: 400 })
  }
  if (!Number.isFinite(score) || score < 0) {
    return NextResponse.json({ error: 'Invalid score' }, { status: 400 })
  }
  // Sanity clamp anti-spam
  if (score > 1_000_000) score = 1_000_000

  const { best, improved } = await upsertArcadeScore({
    network: networkKey,
    address: account,
    game,
    score,
  })

  return NextResponse.json({
    ok: true,
    game,
    account,
    score: best,
    improved,
    network: networkKey,
  })
}
