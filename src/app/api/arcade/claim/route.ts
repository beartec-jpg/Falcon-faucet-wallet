// POST /api/arcade/claim
// Body: { account, game, score, network? }
// Same faucet pool as /api/faucet — separate game rate limits + score threshold.
// Claimant provides their address (same UX as faucet page); server pays from faucet.

import { NextRequest, NextResponse } from 'next/server'
import { isValidClassicAddress } from 'ripple-address-codec'
import {
  GAME_FAUCET_MIN_SCORE,
  arcadeUtcDay,
  getBestScore,
  isGameSlug,
  logGameClaim,
  peekGameClaimQuota,
  upsertArcadeScore,
} from '@/lib/arcade-store'
import { sendFaucetDrip } from '@/lib/faucet-pay'
import { faucetUtcDay, hashIp, logFaucetClaim } from '@/lib/faucet-quota'
import { isOriginAllowed } from '@/lib/origin'
import { resolveFaucet, resolveNetworkKey } from '@/lib/network-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function ip(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

function err(msg: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: msg, ...extra }, { status })
}

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
    return err('Invalid JSON body')
  }

  if (!account || !isValidClassicAddress(account)) {
    return err('Invalid Falcon address')
  }
  if (!isGameSlug(game)) {
    return err('Invalid game slug')
  }
  if (!Number.isFinite(score) || score < 0) {
    return err('Invalid score')
  }

  // Record the reported score (best-of-day)
  await upsertArcadeScore({
    network: networkKey,
    address: account,
    game,
    score,
  })

  const best = await getBestScore({
    network: networkKey,
    address: account,
    game,
  })

  if (best < GAME_FAUCET_MIN_SCORE) {
    return err(
      `Score too low. Reach ${GAME_FAUCET_MIN_SCORE} points in this game to claim (best today: ${best}).`,
      403,
      { best, minScore: GAME_FAUCET_MIN_SCORE, game },
    )
  }

  const quota = await peekGameClaimQuota({
    network: networkKey,
    address: account,
    game,
  })

  if (!quota.ok) {
    const why =
      quota.reason === 'game_claimed'
        ? `Already claimed the Game Faucet for ${game} today (UTC). Come back tomorrow.`
        : `Daily game claim limit reached (${quota.claimsTotalToday} claims). Try again tomorrow (UTC).`
    return err(why, 429, {
      reason: quota.reason,
      claimsThisGameToday: quota.claimsThisGameToday,
      claimsTotalToday: quota.claimsTotalToday,
    })
  }

  // Optional smaller drip for games — defaults to same as main faucet
  const faucet = resolveFaucet(networkKey)
  const gameDrip = process.env.GAME_DRIP_AMOUNT_QXRP
    ? parseFloat(process.env.GAME_DRIP_AMOUNT_QXRP)
    : faucet?.dripAmountQxrp

  const paid = await sendFaucetDrip({
    networkKey,
    toAccount: account,
    amountQxrp: gameDrip,
  })

  if (!paid.ok) {
    return err(paid.error, paid.status, paid.extra)
  }

  // Log as both game claim (rate limit) and faucet claim (airdrop scoring / audit)
  const dayUtc = arcadeUtcDay()
  await logGameClaim({
    network: networkKey,
    address: account,
    game,
    scoreAtClaim: best,
    amountQxrp: paid.amount,
    txHash: paid.txHash,
    dayUtc,
  })

  const clientIp = ip(req)
  const ipHash = await hashIp(clientIp)
  await logFaucetClaim({
    network: networkKey,
    address: account,
    amountQxrp: paid.amount,
    txHash: paid.txHash,
    ipHash,
    dayUtc: faucetUtcDay(),
  })

  return NextResponse.json({
    ok: true,
    source: 'game',
    game,
    txHash: paid.txHash,
    amount: paid.amount,
    account,
    network: networkKey,
    scoreAtClaim: best,
    minScore: GAME_FAUCET_MIN_SCORE,
    remainingGameClaimsToday: Math.max(0, quota.remainingGame - 1),
    remainingTotalGameClaimsToday: Math.max(0, quota.remainingTotal - 1),
    // Same faucet account/pool as POST /api/faucet — only rate limits differ
    faucetPool: 'shared',
  })
}
