import { NextRequest, NextResponse } from 'next/server'
import { getAirdropForAddress, getAirdropOverview } from '@/lib/airdrop-store'
import { resolveNetworkKey } from '@/lib/network-server'
import { isClassicAddress } from '@/lib/classic-address'
import { AIRDROP_SCORING_NETWORK } from '@/lib/airdrop-network'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')?.trim() ?? ''
  if (!address || !isClassicAddress(address)) {
    return NextResponse.json({ error: 'Valid address required' }, { status: 400 })
  }
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  // Always resolve scores from mainnet tables — never from testnet faucet_claims.
  const [overview, me] = await Promise.all([
    getAirdropOverview(AIRDROP_SCORING_NETWORK),
    getAirdropForAddress(address, AIRDROP_SCORING_NETWORK),
  ])
  return NextResponse.json({
    overview: {
      ...overview,
      poolFpl: overview.poolFalcon,
      totalAllocatedFpl: overview.totalAllocatedFalcon,
      scoringNetwork: AIRDROP_SCORING_NETWORK,
      viewerNetwork: networkKey,
      testnetActivityCounts: false,
    },
    me: {
      ...me,
      fplAmount: me.falconAmount,
    },
    scoringNetwork: AIRDROP_SCORING_NETWORK,
    note:
      networkKey === 'testnet'
        ? 'Scores are mainnet-only. Testnet faucet/validator activity does not appear here.'
        : undefined,
  })
}
