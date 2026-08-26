import { NextRequest, NextResponse } from 'next/server'
import { resolveNetworkKey, serverNetworkConfig } from '@/lib/network-server'
import { fetchWalletAssets } from '@/lib/swap/wallet-assets'
import { plAccount } from '@/lib/pl-rpc'
import { loadZeroPoint, offsetAsset } from '@/lib/pl-zero-point'

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
      const zp = await loadZeroPoint()
      const btc = offsetAsset(zp, address, 'BTC', satsOf(acct.assets, 'BTC'))
      const eth = offsetAsset(zp, address, 'ETH', satsOf(acct.assets, 'ETH'))
      const usdc = offsetAsset(zp, address, 'USDC', satsOf(acct.assets, 'USDC'))
      const bnb = offsetAsset(zp, address, 'BNB', satsOf(acct.assets, 'BNB'))
      const tokens: Array<Record<string, unknown>> = []
      if (btc) {
        tokens.push({
          symbol: 'FBTC',
          currency: 'BTC',
          issuer: '',
          balance: btc / 1e8,
          hasTrustLine: true,
          spvMpt: true,
          spvMptBalance: btc / 1e8,
        })
      }
      if (eth) {
        tokens.push({
          symbol: 'FETH',
          currency: 'ETH',
          issuer: '',
          balance: eth / 1e18,
          hasTrustLine: true,
        })
      }
      if (usdc) {
        tokens.push({
          symbol: 'F-USDC',
          currency: 'USDC',
          issuer: '',
          balance: usdc / 1e6,
          hasTrustLine: true,
        })
      }
      if (bnb) {
        tokens.push({
          symbol: 'FBNB',
          currency: 'BNB',
          issuer: '',
          balance: bnb / 1e18,
          hasTrustLine: true,
        })
      }
      return NextResponse.json({
        address,
        network: networkKey,
        assets: {
          fusdc: { symbol: 'F-USDC', balance: usdc / 1e6, currency: 'USDC', issuer: '', hasTrustLine: true },
          fbtc: {
            symbol: 'FBTC',
            balance: btc / 1e8,
            currency: 'BTC',
            issuer: '',
            hasTrustLine: true,
            sats: btc,
          },
          feth: { symbol: 'FETH', balance: eth / 1e18, currency: 'ETH', issuer: '', hasTrustLine: true },
          tokens,
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