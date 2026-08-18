import { NextRequest, NextResponse } from 'next/server'
import { resolveNetworkKey, serverNetworkConfig } from '@/lib/network-server'
import { fetchWalletAssets } from '@/lib/swap/wallet-assets'
import { plAccount } from '@/lib/pl-rpc'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/
const PL_NAME_RE = /^[A-Za-z0-9._-]{2,64}$/

function satsOf(raw: unknown, key: string): number {
  if (!raw || typeof raw !== 'object') return 0
  const v = (raw as Record<string, unknown>)[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return 0
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')?.trim() ?? ''
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const cfg = serverNetworkConfig(networkKey)

  if (cfg.networkId === 2300) {
    if (!ADDRESS_RE.test(address) && !PL_NAME_RE.test(address)) {
      return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
    }
    try {
      const acct = await plAccount(address)
      const btc = satsOf(acct.assets, 'BTC')
      return NextResponse.json({
        address,
        network: networkKey,
        assets: {
          fusdc: { symbol: 'F-USDC', balance: 0, currency: 'QUC', issuer: '', hasTrustLine: false },
          fbtc: {
            symbol: 'FBTC',
            balance: btc / 1e8,
            currency: 'BTC',
            issuer: '',
            hasTrustLine: true,
            sats: btc,
          },
          tokens: btc
            ? [
                {
                  symbol: 'FBTC',
                  currency: 'BTC',
                  issuer: '',
                  balance: btc / 1e8,
                  hasTrustLine: true,
                  spvMpt: true,
                  spvMptBalance: btc / 1e8,
                },
              ]
            : [],
        },
      })
    } catch (err: unknown) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Node unavailable' },
        { status: 502 },
      )
    }
  }

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