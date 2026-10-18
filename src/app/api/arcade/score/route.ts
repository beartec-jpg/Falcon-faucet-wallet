// POST /api/arcade/score
// Body: { account, game, score, run_id?, network? }
// Upserts best single-run score for the UTC day (leaderboard) and accumulates
// claim progress: scores are posted repeatedly during a run, so only the rise
// within a run (keyed by run_id; legacy: a score drop = new run) is added, and
// each run adds at most GAME_MAX_RUN_CREDIT.

import { NextRequest, NextResponse } from 'next/server'
import { isClassicAddress } from '@/lib/classic-address'

/** FPL account id: r… or an on-chain name (same rule as /api/faucet). */
function isPlAccount(name: string): boolean {
  if (isClassicAddress(name)) return true
  return /^[A-Za-z0-9._-]{2,64}$/.test(name)
}
import {
  GAME_FAUCET_MIN_SCORE,
  isGameSlug,
  normalizeRunId,
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
  let plAccount = ''
  let score = 0
  let runId = ''
  let networkKey = resolveNetworkKey(undefined)

  try {
    const body = await req.json()
    account = (body.account ?? '').toString().trim()
    game = (body.game ?? '').toString().trim()
    plAccount = (body.pl_account ?? '').toString().trim().toLowerCase()
    score = Number(body.score)
    runId = normalizeRunId(body.run_id)
    networkKey = resolveNetworkKey(body.network)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!account || !isPlAccount(account)) {
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

  const { best, improved, progress, runs } = await upsertArcadeScore({
    network: networkKey,
    address: account,
    game,
    score,
    runId,
    plAccount: /^[a-z0-9][a-z0-9._-]{0,63}$/.test(plAccount) ? plAccount : undefined,
  })

  return NextResponse.json({
    ok: true,
    game,
    account,
    score: best,
    improved,
    progress,
    runs,
    minScore: GAME_FAUCET_MIN_SCORE,
    canClaimByScore: progress >= GAME_FAUCET_MIN_SCORE,
    network: networkKey,
  })
}
