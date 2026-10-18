// GET /api/arcade/status?account=&network=
// Per-game best single run (leaderboard), accumulated claim progress
// (sum of today's runs since the last claim) + claims remaining.

import { NextRequest, NextResponse } from 'next/server'
import { isClassicAddress } from '@/lib/classic-address'

/** FPL account id: r… or an on-chain name (same rule as /api/faucet). */
function isPlAccount(name: string): boolean {
  if (isClassicAddress(name)) return true
  return /^[A-Za-z0-9._-]{2,64}$/.test(name)
}
import {
  GAME_FAUCET_MIN_SCORE,
  GAME_SLUGS,
  getBestScore,
  getClaimProgress,
  peekGameClaimQuota,
} from '@/lib/arcade-store'
import { resolveNetworkKey } from '@/lib/network-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const account = (sp.get('account') ?? '').trim()
  const networkKey = resolveNetworkKey(sp.get('network'))

  if (!account || !isPlAccount(account)) {
    return NextResponse.json({ error: 'Invalid account' }, { status: 400 })
  }

  const games = await Promise.all(
    GAME_SLUGS.map(async (game) => {
      const best = await getBestScore({
        network: networkKey,
        address: account,
        game,
      })
      const { progress, runs } = await getClaimProgress({
        network: networkKey,
        address: account,
        game,
      })
      const quota = await peekGameClaimQuota({
        network: networkKey,
        address: account,
        game,
      })
      return {
        game,
        bestScore: best,
        progress,
        runsToday: runs,
        eligible: progress >= GAME_FAUCET_MIN_SCORE,
        canClaim: progress >= GAME_FAUCET_MIN_SCORE && quota.ok,
        claimsThisGameToday: quota.claimsThisGameToday,
        remainingGame: quota.remainingGame,
      }
    }),
  )

  return NextResponse.json({
    account,
    network: networkKey,
    minScore: GAME_FAUCET_MIN_SCORE,
    dayUtc: new Date().toISOString().slice(0, 10),
    games,
  })
}
