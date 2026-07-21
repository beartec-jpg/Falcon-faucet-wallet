// POST /api/arcade/claim
// Body: { account, game, network? }  — score in body is IGNORED for eligibility
// Eligibility uses server-stored best score only (from prior SCORE_UPDATE posts).
// Same faucet pool as /api/faucet — separate game rate limits + score threshold.

import { NextRequest, NextResponse } from 'next/server'
import { isValidClassicAddress } from 'ripple-address-codec'
import {
  GAME_FAUCET_MIN_SCORE,
  GAME_GLOBAL_CLAIMS_PER_DAY,
  arcadeUtcDay,
  countGlobalGameClaimsToday,
  finalizeGameClaim,
  getBestScore,
  isGameSlug,
  releaseGameClaim,
  reserveGameClaim,
} from '@/lib/arcade-store'
import { sendFaucetDrip } from '@/lib/faucet-pay'
import {
  faucetUtcDay,
  hashIp,
  logFaucetClaim,
  peekFaucetQuota,
  consumeFaucetQuota,
} from '@/lib/faucet-quota'
import { isOriginAllowed } from '@/lib/origin'
import { resolveFaucet, resolveNetworkKey } from '@/lib/network-server'
import { clientIp } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function err(msg: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: msg, ...extra }, { status })
}

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  let account = ''
  let game = ''
  let networkKey = resolveNetworkKey(undefined)

  try {
    const body = await req.json()
    account = (body.account ?? '').toString().trim()
    game = (body.game ?? '').toString().trim()
    networkKey = resolveNetworkKey(body.network)
    // body.score intentionally ignored for eligibility / storage
  } catch {
    return err('Invalid JSON body')
  }

  if (!account || !isValidClassicAddress(account)) {
    return err('Invalid Falcon address')
  }
  if (!isGameSlug(game)) {
    return err('Invalid game slug')
  }

  // Server-stored best only — never trust claim-body score
  const best = await getBestScore({
    network: networkKey,
    address: account,
    game,
  })

  if (best < GAME_FAUCET_MIN_SCORE) {
    return err(
      `Score too low. Reach ${GAME_FAUCET_MIN_SCORE} points in a real run first (best on record today: ${best}). Keep playing — scores sync as you play.`,
      403,
      { best, minScore: GAME_FAUCET_MIN_SCORE, game },
    )
  }

  // IP budget shared with main faucet pattern (harder multi-wallet farming)
  const ip = clientIp(req)
  const ratePrefix = `game:${networkKey}:`
  const ipLimit = await peekFaucetQuota(`${ratePrefix}ip:${ip}`)
  if (!ipLimit.success) {
    return err(
      ipLimit.reason === 'cooldown'
        ? 'Game faucet IP cooldown active. Try again later.'
        : 'Daily game faucet limit reached for your network. Try again tomorrow (UTC).',
      429,
      { reason: ipLimit.reason, limitType: 'ip' },
    )
  }

  if (GAME_GLOBAL_CLAIMS_PER_DAY > 0) {
    const globalCount = await countGlobalGameClaimsToday(networkKey)
    if (globalCount >= GAME_GLOBAL_CLAIMS_PER_DAY) {
      return err(
        'Global game faucet budget for today is exhausted. Come back tomorrow (UTC).',
        429,
        { reason: 'global_cap', globalCount },
      )
    }
  }

  const reserved = await reserveGameClaim({
    network: networkKey,
    address: account,
    game,
    scoreAtClaim: best,
  })

  if (!reserved.ok) {
    const why =
      reserved.reason === 'game_claimed'
        ? `Already claimed the Game Faucet for ${game} today (UTC). Come back tomorrow.`
        : `Daily game claim limit reached (${reserved.quota.claimsTotalToday} claims). Try again tomorrow (UTC).`
    return err(why, 429, {
      reason: reserved.reason,
      claimsThisGameToday: reserved.quota.claimsThisGameToday,
      claimsTotalToday: reserved.quota.claimsTotalToday,
    })
  }

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
    await releaseGameClaim(reserved.reservationId)
    console.error('[arcade/claim] pay failed:', paid.error, paid.extra)
    return err('Claim failed. Try again shortly.', paid.status >= 400 ? paid.status : 502)
  }

  await finalizeGameClaim({
    reservationId: reserved.reservationId,
    amountQxrp: paid.amount,
    txHash: paid.txHash,
    scoreAtClaim: best,
  })

  await consumeFaucetQuota(`${ratePrefix}ip:${ip}`)

  // Audit only — weight game source so airdrop scoring can discount pure game farms
  const dayUtc = arcadeUtcDay()
  const ipHash = await hashIp(ip)
  await logFaucetClaim({
    network: networkKey,
    address: account,
    amountQxrp: paid.amount,
    txHash: paid.txHash,
    ipHash,
    dayUtc: faucetUtcDay(),
    // source stored in amount path only if schema supports — tag via console for now
  })
  console.info(
    '[arcade-claim-audit]',
    JSON.stringify({
      source: 'game',
      airdropWeight: 0.25,
      network: networkKey,
      address: account,
      game,
      amount: paid.amount,
      txHash: paid.txHash,
      dayUtc,
    }),
  )

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
    remainingGameClaimsToday: Math.max(0, reserved.quota.remainingGame - 1),
    remainingTotalGameClaimsToday: Math.max(0, reserved.quota.remainingTotal - 1),
    faucetPool: 'shared',
  })
}
