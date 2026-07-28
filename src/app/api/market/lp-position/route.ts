import { NextRequest, NextResponse } from 'next/server'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'
import { resolveStableToken } from '@/lib/swap/token-config'

const DROPS = 1_000_000

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

  const ammR = await serverRpcCall<{ amm?: Record<string, unknown> }>(networkKey, 'amm_info', {
    asset: { currency: 'XRP' },
    asset2: { currency: token.currency, issuer: token.issuer },
    ledger_index: 'validated',
  }).catch(() => ({ amm: undefined }))

  const amm = ammR.amm
  if (!amm) {
    return NextResponse.json({
      hasPosition: false,
      pool: null,
      token: {
        symbol: token.displaySymbol,
        currency: token.currency,
        issuer: token.issuer,
      },
    })
  }

  const ammAccount = String(amm.account ?? '')
  const lpMeta = amm.lp_token as { currency?: string; issuer?: string; value?: string } | undefined
  const poolLpTotal = parseFloat(lpMeta?.value ?? '0')
  const poolXrp = typeof amm.amount === 'string' ? parseInt(amm.amount, 10) / DROPS : 0
  const poolToken = parseFloat(String((amm.amount2 as { value?: string })?.value ?? '0'))

  let lpBalance = 0
  if (lpMeta?.currency && ammAccount) {
    const linesR = await serverRpcCall<{
      lines?: Array<{ currency: string; account: string; balance: string }>
    }>(networkKey, 'account_lines', {
      account: address,
      ledger_index: 'validated',
    }).catch(() => ({ lines: [] }))

    const line = (linesR.lines ?? []).find(
      (l) => l.account === ammAccount && l.currency === lpMeta.currency,
    )
    if (line) lpBalance = parseFloat(line.balance)
  }

  const share = poolLpTotal > 0 ? lpBalance / poolLpTotal : 0

  return NextResponse.json({
    hasPosition: lpBalance > 0,
    token: {
      symbol: token.displaySymbol,
      currency: token.currency,
      issuer: token.issuer,
    },
    pool: {
      account: ammAccount,
      xrp: poolXrp,
      /** Token-side reserves (legacy field name `usdc` kept for clients). */
      usdc: poolToken,
      token: poolToken,
      lpTotal: poolLpTotal,
      tradingFeeBps: amm.trading_fee ?? 0,
    },
    position: lpBalance > 0 && lpMeta?.currency
      ? {
          lpBalance,
          lpToken: {
            currency: lpMeta.currency,
            issuer: ammAccount,
          },
          sharePct: share * 100,
          estXrpOut: poolXrp * share,
          estUsdcOut: poolToken * share,
          estTokenOut: poolToken * share,
        }
      : null,
    updatedAt: new Date().toISOString(),
  })
}
