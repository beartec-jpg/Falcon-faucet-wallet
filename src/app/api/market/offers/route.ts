import { NextRequest, NextResponse } from 'next/server'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const DROPS = 1_000_000

async function tokenRef(networkKey: ReturnType<typeof resolveNetworkKey>) {
  try {
    const raw = await readFile(
      path.join(process.cwd(), 'public', 'config', 'testnet-stables.json'),
      'utf8',
    )
    const m = JSON.parse(raw) as { tokens?: Array<{ currency: string; issuer: string }> }
    const t = m.tokens?.[0]
    if (t) return t
  } catch { /* ignore */ }
  return { currency: 'QUC', issuer: '' }
}

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
    return { seq, side: 'sell', price: xrp / token, amountToken: token, amountXrp: xrp }
  }
  if (typeof gets === 'string' && isToken(pays)) {
    const xrp = parseInt(gets, 10) / DROPS
    const token = parseFloat(String((pays as { value: string }).value))
    if (token <= 0 || xrp <= 0) return null
    return { seq, side: 'buy', price: xrp / token, amountToken: token, amountXrp: xrp }
  }
  return null
}

export async function GET(req: NextRequest) {
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const address = req.nextUrl.searchParams.get('address')?.trim() ?? ''
  if (!address) {
    return NextResponse.json({ error: 'address required' }, { status: 400 })
  }

  const token = await tokenRef(networkKey)
  if (!token.issuer) {
    return NextResponse.json({ error: 'USDC issuer not configured' }, { status: 503 })
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
    token: { ...token, symbol: 'USDC' },
    offers,
    updatedAt: new Date().toISOString(),
  })
}