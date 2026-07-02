import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import {
  resolveNetworkKey,
  serverNetworkConfig,
  serverRpcCall,
} from '@/lib/network-server'
import type { NetworkToken } from '@/lib/networks'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/

async function mergeManifestTokens(tokens: NetworkToken[]): Promise<NetworkToken[]> {
  if (tokens.every((t) => t.issuer)) return tokens
  try {
    const manifestPath = path.join(process.cwd(), 'public', 'config', 'testnet-stables.json')
    const raw = await readFile(manifestPath, 'utf8')
    const manifest = JSON.parse(raw) as {
      tokens?: Array<{ symbol: string; currency: string; issuer: string }>
    }
    if (!manifest.tokens?.length) return tokens
    return tokens.map((tok) => {
      const m = manifest.tokens!.find((x) => x.symbol === tok.symbol)
      if (!tok.issuer && m?.issuer) {
        return { ...tok, issuer: m.issuer, currency: m.currency || tok.currency }
      }
      return tok
    })
  } catch {
    return tokens
  }
}

async function getMarketInfo(
  networkKey: ReturnType<typeof resolveNetworkKey>,
  currency: string,
  issuer: string,
) {
  try {
    const ammR = await serverRpcCall<{ amm?: Record<string, unknown> }>(networkKey, 'amm_info', {
      asset: { currency: 'XRP' },
      asset2: { currency, issuer },
      ledger_index: 'validated',
    })
    if (ammR?.amm) {
      const amm = ammR.amm
      const xrpDrops: string = typeof amm.amount === 'string' ? amm.amount : '0'
      const amount2 = amm.amount2 as { value?: string } | undefined
      const tokenValue: string = amount2?.value ?? '0'
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

  try {
    const bookR = await serverRpcCall<{ offers?: unknown[] }>(networkKey, 'book_offers', {
      taker_gets: { currency, issuer },
      taker_pays: { currency: 'XRP' },
      limit: 20,
      ledger_index: 'validated',
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const offers: any[] = bookR?.offers ?? []
    if (offers.length > 0) {
      const best = offers[0]
      const qual = parseFloat(best.quality ?? '0')
      const price = qual > 0 ? qual / 1_000_000 : 0
      const totalToken = offers.reduce((s: number, o: any) => s + parseFloat(o.TakerGets?.value ?? '0'), 0)
      const totalXrp = offers.reduce((s: number, o: any) => s + parseInt(o.TakerPays ?? '0', 10) / 1_000_000, 0)
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

async function getTokenBalance(
  networkKey: ReturnType<typeof resolveNetworkKey>,
  address: string,
  currency: string,
  issuer: string,
) {
  try {
    const r = await serverRpcCall<{ lines?: Array<{ currency: string; account: string; balance: string; limit: string }> }>(
      networkKey, 'account_lines', {
      account: address,
      ledger_index: 'validated',
    })
    const line = (r?.lines ?? []).find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (l: any) => l.currency === currency && l.account === issuer,
    )
    return line ? { balance: parseFloat(line.balance), limit: parseFloat(line.limit) } : null
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address') ?? ''
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const cfg = serverNetworkConfig(networkKey)
  const tokens = await mergeManifestTokens(cfg.tokens)

  try {
    const tokensWithData = await Promise.all(
      tokens.map(async (tok) => {
        if (!tok.issuer) {
          return { ...tok, amm: null, userBalance: null, configured: false }
        }

        const [amm, userBalance] = await Promise.all([
          getMarketInfo(networkKey, tok.currency, tok.issuer),
          ADDRESS_RE.test(address)
            ? getTokenBalance(networkKey, address, tok.currency, tok.issuer)
            : Promise.resolve(null),
        ])

        return { ...tok, amm, userBalance, configured: true }
      }),
    )

    return NextResponse.json({ tokens: tokensWithData, network: networkKey })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Node unavailable' },
      { status: 502 },
    )
  }
}