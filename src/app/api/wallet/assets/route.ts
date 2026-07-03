import { NextRequest, NextResponse } from 'next/server'
import { resolveNetworkKey } from '@/lib/network-server'
import { fetchWalletAssets } from '@/lib/swap/wallet-assets'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')?.trim() ?? ''
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))

  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
  }

  try {
    const assets = await fetchWalletAssets(networkKey, address)
    return NextResponse.json({ address, network: networkKey, assets })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Node unavailable' },
      { status: 502 },
    )
  }
}