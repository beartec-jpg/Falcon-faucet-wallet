import { NextRequest, NextResponse } from 'next/server'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'
import { isMptToken, resolveStableToken } from '@/lib/swap/token-config'
import { satsToBtc } from '@/lib/xrpl-amount'

const DROPS = 1_000_000

function asset2ForToken(token: {
  currency: string
  issuer: string
  kind?: 'iou' | 'mpt'
  mptIssuanceId?: string
}): Record<string, string> {
  if (isMptToken(token) && token.mptIssuanceId) {
    return { mpt_issuance_id: token.mptIssuanceId.toUpperCase() }
  }
  return { currency: token.currency, issuer: token.issuer }
}

function parseTokenPoolAmount(amount2: unknown, mpt: boolean): number {
  if (amount2 == null) return 0
  if (typeof amount2 === 'string') {
    const n = parseInt(amount2, 10)
    if (!Number.isFinite(n)) return 0
    return mpt ? satsToBtc(n) : parseFloat(amount2)
  }
  if (typeof amount2 === 'object') {
    const o = amount2 as { value?: string }
    if (o.value != null) {
      const n = parseFloat(o.value)
      if (!Number.isFinite(n)) return 0
      if (mpt && /^\d+$/.test(String(o.value)) && n > 1e3) return satsToBtc(n)
      return n
    }
  }
  return 0
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
    networkKey,
  })
  const mpt = isMptToken(token)
  if (!mpt && !token.issuer) {
    return NextResponse.json(
      { error: `${token.displaySymbol} issuer not configured` },
      { status: 503 },
    )
  }
  if (mpt && !token.mptIssuanceId) {
    return NextResponse.json(
      { error: 'SPV FBTC MPT issuance not found on bridge' },
      { status: 503 },
    )
  }

  const tokenOut = {
    symbol: token.displaySymbol,
    currency: token.currency,
    issuer: token.issuer,
    kind: mpt ? ('mpt' as const) : ('iou' as const),
    mptIssuanceId: token.mptIssuanceId,
    decimals: token.decimals ?? (mpt ? 8 : 6),
  }

  const ammR = await serverRpcCall<{ amm?: Record<string, unknown> }>(networkKey, 'amm_info', {
    asset: { currency: 'XRP' },
    asset2: asset2ForToken(token),
    ledger_index: 'validated',
  }).catch(() => ({ amm: undefined }))

  const amm = ammR.amm
  if (!amm) {
    return NextResponse.json({
      hasPosition: false,
      pool: null,
      token: tokenOut,
      poolHint: mpt
        ? 'SPV FBTC AMM not found — needs MPTokensV2 + FPL/FBTC seed.'
        : undefined,
    })
  }

  const ammAccount = String(amm.account ?? '')
  const lpMeta = amm.lp_token as { currency?: string; issuer?: string; value?: string } | undefined
  const poolLpTotal = parseFloat(lpMeta?.value ?? '0')
  const poolXrp = typeof amm.amount === 'string' ? parseInt(amm.amount, 10) / DROPS : 0
  const poolToken = parseTokenPoolAmount(amm.amount2, mpt)

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
    token: tokenOut,
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
