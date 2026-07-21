/**
 * POST /api/airdrop/freeze
 * Auth: Bearer $AIRDROP_ADMIN_TOKEN
 *
 * Final freeze: recompute mainnet allocations once, write freeze marker.
 * Refuses testnet — freeze only applies to mainnet airdrop scores.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSql, isDbConfigured } from '@/lib/db'
import { recomputeAllocations } from '@/lib/airdrop-snapshot'
import { requireAirdropScoringNetwork } from '@/lib/airdrop-network'
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
  if (!isDbConfigured()) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  let body: { network?: string; note?: string } = {}
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

  const { network } = gated
  const scores = await recomputeAllocations(network)
  const sql = getSql()
  const note =
    body.note ??
    `Frozen ${new Date().toISOString()} · mainnet · ${scores.addresses} addresses`
  await sql`
    UPDATE airdrop_config
    SET notes = ${note}, network = ${network}, updated_at = NOW()
    WHERE id = 1
  `

  return NextResponse.json({
    ok: true,
    network,
    scoringNetwork: network,
    frozen: true,
    ...scores,
    message:
      'Mainnet allocations recomputed and freeze note written. Run batch payment from AIRDROP wallet next.',
  })
}
