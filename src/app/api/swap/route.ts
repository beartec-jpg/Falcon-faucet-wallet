import { NextRequest, NextResponse } from 'next/server'
import { resolveNetworkKey } from '@/lib/network-server'
import { quoteSwap, getUsdcMarket } from '@/lib/swap/quote'
import { resolveStableToken } from '@/lib/swap/token-config'

export async function GET(req: NextRequest) {
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const address = req.nextUrl.searchParams.get('address') ?? ''
  const direction = req.nextUrl.searchParams.get('direction') as
    | 'sell_falcon'
    | 'buy_falcon'
    | 'buy'
    | 'sell'
    | null
  const amountStr = req.nextUrl.searchParams.get('amount')

  const token = await resolveStableToken({
    symbol: req.nextUrl.searchParams.get('symbol'),
    currency: req.nextUrl.searchParams.get('currency'),
    issuer: req.nextUrl.searchParams.get('issuer'),
    networkKey,
  })

  if (direction && amountStr) {
    const amount = parseFloat(amountStr)
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }
    try {
      const quote = await quoteSwap(networkKey, token, direction, amount)
      if (!quote) {
        return NextResponse.json(
          {
            error: 'No liquidity available',
            token,
            poolHint:
              token.mptIssuanceId
                ? 'SPV FBTC AMM not found — seed FALCON+FBTC pool after MPTokensV2 is enabled.'
                : undefined,
          },
          { status: 404 },
        )
      }
      return NextResponse.json({ quote, token })
    } catch (e: unknown) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Node unavailable' },
        { status: 502 },
      )
    }
  }

  try {
    const data = await getUsdcMarket(networkKey, token, address || undefined)
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Node unavailable' },
      { status: 502 },
    )
  }
}
