/**
 * POST /api/airdrop/snapshot
 * Auth: Authorization: Bearer $AIRDROP_ADMIN_TOKEN
 * Body: { network?: 'mainnet', validators?: string[] }
 *
 * Mainnet only — refuses testnet so testnet farming cannot enter airdrop scores.
 * Cron: daily during the 60-day mainnet contribution window.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAirdropScoringNetwork } from '@/lib/airdrop-network'
import {
  persistSnapshot,
  recomputeAllocations,
  snapshotDexLp,
  snapshotValidators,
} from '@/lib/airdrop-snapshot'
import { bearerToken, timingSafeEqualString } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(req: NextRequest): boolean {
  const token = process.env.AIRDROP_ADMIN_TOKEN?.trim()
  if (!token) return false
  const auth = bearerToken(req)
  return !!auth && timingSafeEqualString(auth, token)
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { validators?: string[]; network?: string; day?: string } = {}
  try {
    body = await req.json()
  } catch {
    /* empty */
  }

  const gated = requireAirdropScoringNetwork(
    body.network,
    req.nextUrl.searchParams.get('network'),
  )
  if (!gated.ok) {
    return NextResponse.json(
      { error: gated.error, ok: false, scoringNetwork: 'mainnet' },
      { status: 400 },
    )
  }

  const { network, networkKey } = gated
  const candidates = Array.isArray(body.validators)
    ? body.validators.filter((a) => typeof a === 'string' && a.startsWith('r'))
    : (process.env.AIRDROP_VALIDATOR_ADDRESSES ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

  // Always UTC day for mainnet window (optional override for ops backfill on mainnet only).
  const day =
    typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day)
      ? body.day
      : new Date().toISOString().slice(0, 10)

  // Snapshots hit mainnet RPC only (networkKey forced to mainnet).
  const validators = await snapshotValidators(networkKey, candidates)
  await persistSnapshot(network, 'validators', validators, day)

  const dex = await snapshotDexLp(networkKey)
  await persistSnapshot(
    network,
    'dex_lp',
    { holders: dex, note: dex.length ? 'holders' : 'LP holder scan deferred — pool meta only' },
    day,
  )

  const scores = await recomputeAllocations(network)

  return NextResponse.json({
    ok: true,
    day,
    network,
    scoringNetwork: network,
    validators: validators.length,
    bonded: validators.filter((v) => v.bonded).length,
    dexHolders: dex.length,
    allocations: scores,
  })
}
