import { NextRequest, NextResponse } from 'next/server'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'
import { isDustOffer } from '@/lib/swap/dust-offers'
import { resolveStableToken } from '@/lib/swap/token-config'

const DROPS = 1_000_000

function parseUserOffer(
  o: Record<string, unknown>,
  tokenCurrency: string,
  tokenIssuer: string,
): {
  seq: number
  side: 'sell' | 'buy'
  price: number
  amountToken: number
  amountXrp: number
  dust: boolean
} | null {
  const gets = o.taker_gets ?? o.TakerGets
  const pays = o.taker_pays ?? o.TakerPays
  const seq = Number(o.seq ?? 0)

  const isToken = (v: unknown) =>
    typeof v === 'object' && v !== null && 'value' in v &&
    String((v as { currency?: string }).currency) === tokenCurrency &&
    String((v as { issuer?: string }).issuer) === tokenIssuer

  if (isToken(gets) && typeof pays === 'string') {
    const token = parseFloat(String((gets as { value: string }).value))
    const xrp = parseInt(pays, 10) / DROPS
    if (token <= 0 || xrp <= 0) return null
    return {
      seq, side: 'sell', price: xrp / token, amountToken: token, amountXrp: xrp,
      dust: isDustOffer(token, xrp),
    }
  }
  if (typeof gets === 'string' && isToken(pays)) {
    const xrp = parseInt(gets, 10) / DROPS
    const token = parseFloat(String((pays as { value: string }).value))
    if (token <= 0 || xrp <= 0) return null
    return {
      seq, side: 'buy', price: xrp / token, amountToken: token, amountXrp: xrp,
      dust: isDustOffer(token, xrp),
    }
  }
  return null
}

export async function GET(req: NextRequest) {
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const address = req.nextUrl.searchParams.get('address')?.trim() ?? ''
  if (!address) {
    return NextResponse.json({ error: 'address required' }, { status: 400 })
  }

  const token = await resolveStableToken({
    symbol: req.nextUrl.searchParams.get('symbol'),
    currency: req.nextUrl.searchParams.get('currency'),
    issuer: req.nextUrl.searchParams.get('issuer'),
  })
  if (!token.issuer) {
    return NextResponse.json(
      { error: `${token.displaySymbol} issuer not configured` },
      { status: 503 },
    )
  }

  const r = await serverRpcCall<{ offers?: Array<Record<string, unknown>> }>(
    networkKey,
    'account_offers',
    { account: address, ledger_index: 'validated' },
  ).catch(() => ({ offers: [] }))

  const offers = (r.offers ?? [])
    .map((o) => parseUserOffer(o, token.currency, token.issuer))
    .filter(Boolean)

  return NextResponse.json({
    address,
    token: {
      currency: token.currency,
      issuer: token.issuer,
      symbol: token.displaySymbol,
    },
    offers,
    updatedAt: new Date().toISOString(),
  })
}
