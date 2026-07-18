/**
 * POST /api/airdrop/freeze
 * Auth: Bearer $AIRDROP_ADMIN_TOKEN
 *
 * Final freeze: recompute allocations once, write freeze marker on airdrop_config.
 * Claim release is a separate payment step (batch script).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSql, isDbConfigured } from '@/lib/db'
import { recomputeAllocations } from '@/lib/airdrop-snapshot'
import { resolveNetworkKey } from '@/lib/network-server'

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
  if (!isDbConfigured()) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  let body: { network?: string; note?: string } = {}
  try {
    body = await req.json()
  } catch {
    /* empty */
  }
  const network = body.network === 'mainnet' || networkKey === 'mainnet' ? 'mainnet' : 'testnet'

  const scores = await recomputeAllocations(network)
  const sql = getSql()
  const note = body.note ?? `Frozen ${new Date().toISOString()} · ${scores.addresses} addresses`
  await sql`
    UPDATE airdrop_config
    SET notes = ${note}, updated_at = NOW()
    WHERE id = 1
  `

  return NextResponse.json({
    ok: true,
    network,
    frozen: true,
    ...scores,
    message:
      'Allocations recomputed and freeze note written. Run batch payment script from AIRDROP wallet next.',
  })
}
