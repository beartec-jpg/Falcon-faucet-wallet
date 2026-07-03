import { NextRequest, NextResponse } from 'next/server'
import { resolveNetworkKey, serverNetworkConfig } from '@/lib/network-server'
import { quoteSwap, getUsdcMarket } from '@/lib/swap/quote'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

async function resolveUsdcToken(networkKey: ReturnType<typeof resolveNetworkKey>) {
  const cfg = serverNetworkConfig(networkKey)
  let currency = cfg.tokens[0]?.currency ?? ''
  let issuer = cfg.tokens[0]?.issuer ?? ''

  if (!issuer && networkKey === 'testnet') {
    try {
      const manifestPath = path.join(process.cwd(), 'public', 'config', 'testnet-stables.json')
      const raw = await readFile(manifestPath, 'utf8')
      const manifest = JSON.parse(raw) as {
        tokens?: Array<{ currency: string; issuer: string }>
      }
      const t = manifest.tokens?.[0]
      if (t) {
        currency = t.currency
        issuer = t.issuer
      }
    } catch { /* ignore */ }
  }

  return { currency, issuer }
}

export async function GET(req: NextRequest) {
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const address = req.nextUrl.searchParams.get('address') ?? ''
  const direction = req.nextUrl.searchParams.get('direction') as 'buy' | 'sell' | null
  const amountStr = req.nextUrl.searchParams.get('amount')

  const token = await resolveUsdcToken(networkKey)

  if (direction && amountStr) {
    const amount = parseFloat(amountStr)
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }
    const quote = await quoteSwap(networkKey, token, direction, amount)
    if (!quote) {
      return NextResponse.json({ error: 'No liquidity available' }, { status: 404 })
    }
    return NextResponse.json({ quote, token })
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