import { NextRequest, NextResponse } from 'next/server'
import { getAirdropOverview } from '@/lib/airdrop-store'
import { resolveNetworkKey } from '@/lib/network-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  // Airdrop program is mainnet-oriented; testnet can show the same UI in "preview" mode.
  const network = networkKey === 'mainnet' ? 'mainnet' : 'testnet'
  const overview = await getAirdropOverview(network)
  return NextResponse.json(overview)
}
