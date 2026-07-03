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

function parseOffer(
  o: Record<string, unknown>,
  side: 'ask' | 'bid',
): { price: number; amountToken: number; amountXrp: number; seq: number; owner: string } | null {
  const gets = o.TakerGets
  const pays = o.TakerPays
  const seq = Number(o.seq ?? 0)
  const owner = String(o.Account ?? o.account ?? '')

  let token = 0
  let xrp = 0
  if (side === 'ask') {
    if (typeof gets === 'object' && gets && 'value' in gets) {
      token = parseFloat(String((gets as { value: string }).value))
    }
    if (typeof pays === 'string') xrp = parseInt(pays, 10) / DROPS
  } else {
    if (typeof pays === 'object' && pays && 'value' in pays) {
      token = parseFloat(String((pays as { value: string }).value))
    }
    if (typeof gets === 'string') xrp = parseInt(gets, 10) / DROPS
  }
  if (token <= 0 || xrp <= 0) return null
  return {
    price: xrp / token,
    amountToken: token,
    amountXrp: xrp,
    seq,
    owner,
  }
}

export async function GET(req: NextRequest) {
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const token = await tokenRef(networkKey)
  if (!token.issuer) {
    return NextResponse.json({ error: 'USDC issuer not configured' }, { status: 503 })
  }

  const [asksR, bidsR, ammR] = await Promise.all([
    serverRpcCall<{ offers?: Array<Record<string, unknown>> }>(networkKey, 'book_offers', {
      taker_gets: { currency: token.currency, issuer: token.issuer },
      taker_pays: { currency: 'XRP' },
      limit: 40,
      ledger_index: 'validated',
    }).catch(() => ({ offers: [] })),
    serverRpcCall<{ offers?: Array<Record<string, unknown>> }>(networkKey, 'book_offers', {
      taker_gets: { currency: 'XRP' },
      taker_pays: { currency: token.currency, issuer: token.issuer },
      limit: 40,
      ledger_index: 'validated',
    }).catch(() => ({ offers: [] })),
    serverRpcCall<{ amm?: Record<string, unknown> }>(networkKey, 'amm_info', {
      asset: { currency: 'XRP' },
      asset2: { currency: token.currency, issuer: token.issuer },
      ledger_index: 'validated',
    }).catch(() => ({})),
  ])

  const asks = (asksR.offers ?? [])
    .map((o) => parseOffer(o, 'ask'))
    .filter(Boolean)
  const bids = (bidsR.offers ?? [])
    .map((o) => parseOffer(o, 'bid'))
    .filter(Boolean)

  let amm: Record<string, unknown> | null = null
  if (ammR && 'amm' in ammR && ammR.amm) {
    const a = ammR.amm
    amm = {
      xrp: typeof a.amount === 'string' ? parseInt(a.amount, 10) / DROPS : 0,
      usdc: parseFloat(String((a.amount2 as { value?: string })?.value ?? '0')),
      tradingFeeBps: a.trading_fee ?? 0,
      account: a.account,
    }
  }

  return NextResponse.json({
    token: { ...token, symbol: 'USDC' },
    amm,
    ammEnabled: !!amm,
    asks,
    bids,
    updatedAt: new Date().toISOString(),
  })
}