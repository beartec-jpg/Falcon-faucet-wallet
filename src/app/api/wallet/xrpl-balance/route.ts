import { NextRequest, NextResponse } from 'next/server'
import {
  fetchXrplClassicXrpBalance,
  type XrplClassicNetwork,
} from '@/lib/create-xrpl-classic-wallet'

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')?.trim() || ''
  const network = (req.nextUrl.searchParams.get('network') || 'testnet') as XrplClassicNetwork
  if (!address.match(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/)) {
    return NextResponse.json({ error: 'Invalid classic r-address' }, { status: 400 })
  }
  if (network !== 'testnet' && network !== 'mainnet') {
    return NextResponse.json({ error: 'network must be testnet|mainnet' }, { status: 400 })
  }
  try {
    const balance = await fetchXrplClassicXrpBalance(address, network)
    return NextResponse.json({
      address,
      network,
      balance,
      currency: 'XRP',
      crypto: 'classic-xrpl',
      note: 'Separate from Falcon-512 r-address',
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'XRPL classic balance failed' },
      { status: 502 },
    )
  }
}
