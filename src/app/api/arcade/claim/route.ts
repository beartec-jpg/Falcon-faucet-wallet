// POST /api/arcade/claim
// Body: { account, game, network? }  — score in body is IGNORED for eligibility
// Eligibility uses server-stored accumulated progress only (sum of today's run
// scores since the last claim, built from prior /api/arcade/score posts).
// Each successful claim consumes GAME_FAUCET_MIN_SCORE points of progress.
// Same faucet pool as /api/faucet — separate game rate limits + score threshold.

import { NextRequest, NextResponse } from 'next/server'
import { isClassicAddress } from '@/lib/classic-address'

/** FPL account id: r… or an on-chain name (same rule as /api/faucet). */
function isPlAccount(name: string): boolean {
  if (isClassicAddress(name)) return true
  return /^[A-Za-z0-9._-]{2,64}$/.test(name)
}
import {
  GAME_FAUCET_MIN_SCORE,
  GAME_GLOBAL_CLAIMS_PER_DAY,
  arcadeUtcDay,
  countGlobalGameClaimsToday,
  finalizeGameClaim,
  consumeClaimProgress,
  getBestScore,
  getClaimProgress,
  isGameSlug,
  refundClaimProgress,
  releaseGameClaim,
  reserveGameClaim,
} from '@/lib/arcade-store'
import { sendFaucetDrip } from '@/lib/faucet-pay'
import { plFaucetDrip, PL_DRIP } from '@/lib/pl-faucet-drip'
import { serverNetworkConfig } from '@/lib/network-server'
import {
  faucetUtcDay,
  hashIp,
  logFaucetClaim,
  peekFaucetQuota,
  consumeFaucetQuota,
} from '@/lib/faucet-quota'
import { isOriginAllowed } from '@/lib/origin'
import { resolveFaucet, resolveNetworkKey } from '@/lib/network-server'
import { envNumberFirst } from '@/lib/networks'
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

  if (!account || !isPlAccount(account)) {
    return err('Invalid Falcon address')
  }
  if (!isGameSlug(game)) {
    return err('Invalid game slug')
  }

  // Server-stored progress only — never trust claim-body score or client totals
  const who = { network: networkKey, address: account, game }
  const [{ progress }, best] = await Promise.all([
    getClaimProgress(who),
    getBestScore(who),
  ])

  if (progress < GAME_FAUCET_MIN_SCORE) {
    return err(
      `Not enough points yet: ${Math.floor(progress)} / ${GAME_FAUCET_MIN_SCORE} today. Your run scores add up — keep playing, scores sync as you play.`,
      403,
      { progress, best, minScore: GAME_FAUCET_MIN_SCORE, game },
    )
  }

  // Game-only IP bucket (`game:` prefix → GAME_IP_* limits, not the main faucet's 1h cooldown)
  const ip = clientIp(req)
  const ratePrefix = `game:${networkKey}:`
  const ipLimit = await peekFaucetQuota(`${ratePrefix}ip:${ip}`)
  if (!ipLimit.success) {
    return err(
      ipLimit.reason === 'cooldown'
        ? 'Game faucet IP cooldown active. Try again later.'
        : 'Daily game faucet limit reached for your network. Try again tomorrow (UTC).',
      429,
      { reason: ipLimit.reason, limitType: 'ip', retryAt: ipLimit.reset },
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
    scoreAtClaim: progress,
  })

  if (!reserved.ok) {
    const why =
      reserved.reason === 'game_claimed'
        ? `Game Faucet claim limit for ${game} reached today (UTC). Come back tomorrow.`
        : `Daily game claim limit reached (${reserved.quota.claimsTotalToday} claims). Try again tomorrow (UTC).`
    return err(why, 429, {
      reason: reserved.reason,
      claimsThisGameToday: reserved.quota.claimsThisGameToday,
      claimsTotalToday: reserved.quota.claimsTotalToday,
    })
  }

  // Atomically spend the threshold (guards concurrent claims on the same progress).
  const spent = await consumeClaimProgress({ ...who, amount: GAME_FAUCET_MIN_SCORE })
  if (!spent.ok) {
    await releaseGameClaim(reserved.reservationId)
    return err(
      `Not enough points yet: ${Math.floor(spent.progress)} / ${GAME_FAUCET_MIN_SCORE} today.`,
      403,
      { progress: spent.progress, minScore: GAME_FAUCET_MIN_SCORE, game },
    )
  }

  // Falcon PL 2300 has no xrpld JSON-RPC: pay through the same PL drip as
  // /api/faucet (pl-ctl / walletd). The legacy xrpld path is only for others.
  let paid:
    | { ok: true; amount: number; txHash: string }
    | { ok: false; status: number; error: string; reason?: string; extra?: unknown }
  if (serverNetworkConfig(networkKey).networkId === 2300) {
    const plAmount = envNumberFirst(['GAME_DRIP_AMOUNT_FPL', 'GAME_DRIP_AMOUNT_QXRP'], PL_DRIP)
    const r = await plFaucetDrip(account, Number.isFinite(plAmount) && plAmount > 0 ? plAmount : PL_DRIP)
    paid = r.ok
      ? { ok: true, amount: r.amount, txHash: r.txId || 'pl' }
      : { ok: false, status: r.status, error: r.error, reason: r.reason }
  } else {
    const faucet = resolveFaucet(networkKey)
    const gameDrip = envNumberFirst(
      ['GAME_DRIP_AMOUNT_FPL', 'GAME_DRIP_AMOUNT_QXRP'],
      faucet?.dripAmountFpl ?? faucet?.dripAmountQxrp ?? NaN,
    )
    const amountFpl = Number.isFinite(gameDrip) ? gameDrip : undefined
    const r = await sendFaucetDrip({ networkKey, toAccount: account, amountQxrp: amountFpl })
    paid = r.ok
      ? { ok: true, amount: r.amount, txHash: r.txHash }
      : { ok: false, status: r.status, error: r.error, extra: r.extra }
  }

  if (!paid.ok) {
    await refundClaimProgress({ ...who, amount: GAME_FAUCET_MIN_SCORE })
    await releaseGameClaim(reserved.reservationId)
    console.error('[arcade/claim] pay failed:', paid.error, paid.reason ?? paid.extra ?? '')
    // Points were refunded; tell the player the specific reason.
    return err(paid.error || 'Claim failed. Try again shortly.', paid.status >= 400 ? paid.status : 502, {
      reason: paid.reason ?? 'payout_failed',
      refunded: true,
    })
  }

  await finalizeGameClaim({
    reservationId: reserved.reservationId,
    amountQxrp: paid.amount,
    txHash: paid.txHash,
    scoreAtClaim: progress,
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
    amountFpl: paid.amount,
    account,
    network: networkKey,
    scoreAtClaim: progress,
    progress: spent.progress,
    best,
    minScore: GAME_FAUCET_MIN_SCORE,
    remainingGameClaimsToday: Math.max(0, reserved.quota.remainingGame - 1),
    remainingTotalGameClaimsToday: Math.max(0, reserved.quota.remainingTotal - 1),
    faucetPool: 'shared',
  })
}
