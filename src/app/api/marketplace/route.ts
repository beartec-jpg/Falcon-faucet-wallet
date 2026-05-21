import { NextRequest, NextResponse } from 'next/server'

const RPC = process.env.XRPLD_RPC_URL ?? 'http://127.0.0.1:6005'

// Token configuration — set via env after running 07_issue_stables.py
const TOKENS = [
  {
    symbol:   'qUSDC',
    currency: process.env.NEXT_PUBLIC_QUSDC_CURRENCY ?? 'QUC',
    issuer:   process.env.NEXT_PUBLIC_QUSDC_ISSUER   ?? '',
  },
  {
    symbol:   'qUSDT',
    currency: process.env.NEXT_PUBLIC_QUSDT_CURRENCY ?? 'QUT',
    issuer:   process.env.NEXT_PUBLIC_QUSDT_ISSUER   ?? '',
  },
]

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const res = await fetch(RPC, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ method, params: [params] }),
    cache:   'no-store',
  })
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`)
  return (await res.json()).result
}

async function getMarketInfo(currency: string, issuer: string) {
  // Try AMM first; fall back to DEX best-offer price
  try {
    const ammR = await rpc('amm_info', {
      asset:  { currency: 'XRP' },
      asset2: { currency, issuer },
      ledger_index: 'validated',
    })
    if (ammR?.amm) {
      const amm = ammR.amm
      const xrpDrops:   string = typeof amm.amount === 'string' ? amm.amount : '0'
      const tokenValue: string = amm.amount2?.value ?? '0'
      const xrpAmt = parseInt(xrpDrops, 10) / 1_000_000
      const tokAmt = parseFloat(tokenValue)
      return {
        type:       'amm' as const,
        xrpPool:    xrpAmt,
        tokenPool:  tokAmt,
        price:      tokAmt > 0 ? xrpAmt / tokAmt : 0,
        tradingFee: amm.trading_fee ?? 0,
        accountId:  amm.account,
      }
    }
  } catch { /* AMM not available */ }

  // DEX: query best sell offer (someone selling tokens for XRP)
  try {
    const bookR = await rpc('book_offers', {
      taker_gets: { currency: 'XRP' },
      taker_pays: { currency, issuer },
      limit: 5,
      ledger_index: 'validated',
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const offers: any[] = bookR?.offers ?? []
    if (offers.length > 0) {
      const best = offers[0]
      // quality = XRP drops per token (drop/token)
      const qual  = parseFloat(best.quality ?? '0')
      // price in qXRP per token
      const price = qual > 0 ? qual / 1_000_000 : 0

      const totalXrp   = offers.reduce((s: number, o: any) => s + parseInt(o.TakerGets ?? '0', 10) / 1_000_000, 0)
      const totalToken = offers.reduce((s: number, o: any) => s + parseFloat(o.TakerPays?.value ?? '0'), 0)

      return {
        type:       'dex' as const,
        xrpPool:    totalXrp,
        tokenPool:  totalToken,
        price,
        tradingFee: 0,
        offerCount: offers.length,
      }
    }
  } catch { /* ignore */ }

  return null
}

async function getTokenBalance(address: string, currency: string, issuer: string) {
  try {
    const r = await rpc('account_lines', { account: address, ledger_index: 'validated' })
    const line = (r?.lines ?? []).find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (l: any) => l.currency === currency && l.account === issuer
    )
    return line ? { balance: parseFloat(line.balance), limit: parseFloat(line.limit) } : null
  } catch {
    return null
  }
}

// GET /api/marketplace?address=rXXX  (address optional)
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address') ?? ''
  const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/

  try {
    const tokensWithData = await Promise.all(
      TOKENS.map(async (tok) => {
        if (!tok.issuer) {
          return { ...tok, amm: null, userBalance: null, configured: false }
        }

        const [amm, userBalance] = await Promise.all([
          getMarketInfo(tok.currency, tok.issuer),
          ADDRESS_RE.test(address)
            ? getTokenBalance(address, tok.currency, tok.issuer)
            : Promise.resolve(null),
        ])

        return { ...tok, amm, userBalance, configured: true }
      })
    )

    return NextResponse.json({ tokens: tokensWithData })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Node unavailable' },
      { status: 502 }
    )
  }
}
