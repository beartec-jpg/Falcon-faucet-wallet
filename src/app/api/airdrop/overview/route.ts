import { NextRequest, NextResponse } from 'next/server'
import { getAirdropOverview } from '@/lib/airdrop-store'
import { resolveNetworkKey } from '@/lib/network-server'
import { AIRDROP_SCORING_NETWORK } from '@/lib/airdrop-network'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  // Scores always live under mainnet. Testnet UI can preview mainnet totals + a notice.
  const overview = await getAirdropOverview(AIRDROP_SCORING_NETWORK)
  return NextResponse.json({
    ...overview,
    network: AIRDROP_SCORING_NETWORK,
    scoringNetwork: AIRDROP_SCORING_NETWORK,
    viewerNetwork: networkKey,
    testnetActivityCounts: false,
    note:
      networkKey === 'testnet'
        ? 'Preview only: airdrop scores mainnet activity after genesis. Testnet does not earn mainnet FALCON.'
        : overview.notes,
  })
}
