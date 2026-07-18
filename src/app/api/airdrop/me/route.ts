import { NextRequest, NextResponse } from 'next/server'
import { getAirdropForAddress, getAirdropOverview } from '@/lib/airdrop-store'
import { resolveNetworkKey } from '@/lib/network-server'
import { isValidClassicAddress } from 'ripple-address-codec'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')?.trim() ?? ''
  if (!address || !isValidClassicAddress(address)) {
    return NextResponse.json({ error: 'Valid address required' }, { status: 400 })
  }
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const network = networkKey === 'mainnet' ? 'mainnet' : 'testnet'
  const [overview, me] = await Promise.all([
    getAirdropOverview(network),
    getAirdropForAddress(address, network),
  ])
  return NextResponse.json({ overview, me })
}
