/**
 * POST /api/airdrop/snapshot
 * Auth: Authorization: Bearer $AIRDROP_ADMIN_TOKEN
 * Body: { network?: 'testnet'|'mainnet', validators?: string[] }
 *
 * Takes a daily snapshot of validator candidates + recompute faucet-based scores.
 * Cron: daily during the 60-day window.
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveNetworkKey } from '@/lib/network-server'
import {
  persistSnapshot,
  recomputeAllocations,
  snapshotDexLp,
  snapshotValidators,
} from '@/lib/airdrop-snapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(req: NextRequest): boolean {
  const token = process.env.AIRDROP_ADMIN_TOKEN?.trim()
  if (!token) return false
  const h = req.headers.get('authorization') ?? ''
  return h === `Bearer ${token}` || h === token
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  let body: { validators?: string[]; network?: string } = {}
  try {
    body = await req.json()
  } catch {
    /* empty */
  }

  const network = body.network === 'mainnet' || networkKey === 'mainnet' ? 'mainnet' : 'testnet'
  const candidates = Array.isArray(body.validators)
    ? body.validators.filter((a) => typeof a === 'string' && a.startsWith('r'))
    : (process.env.AIRDROP_VALIDATOR_ADDRESSES ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

  const day = new Date().toISOString().slice(0, 10)
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
    validators: validators.length,
    bonded: validators.filter((v) => v.bonded).length,
    dexHolders: dex.length,
    allocations: scores,
  })
}
