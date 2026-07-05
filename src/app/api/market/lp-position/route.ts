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

export async function GET(req: NextRequest) {
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const address = req.nextUrl.searchParams.get('address')?.trim() ?? ''
  if (!address) {
    return NextResponse.json({ error: 'address required' }, { status: 400 })
  }

  const token = await tokenRef(networkKey)
  if (!token.issuer) {
    return NextResponse.json({ error: 'F-USDC issuer not configured' }, { status: 503 })
  }

  const ammR = await serverRpcCall<{ amm?: Record<string, unknown> }>(networkKey, 'amm_info', {
    asset: { currency: 'XRP' },
    asset2: { currency: token.currency, issuer: token.issuer },
    ledger_index: 'validated',
  }).catch(() => ({ amm: undefined }))

  const amm = ammR.amm
  if (!amm) {
    return NextResponse.json({ hasPosition: false, pool: null })
  }

  const ammAccount = String(amm.account ?? '')
  const lpMeta = amm.lp_token as { currency?: string; issuer?: string; value?: string } | undefined
  const poolLpTotal = parseFloat(lpMeta?.value ?? '0')
  const poolXrp = typeof amm.amount === 'string' ? parseInt(amm.amount, 10) / DROPS : 0
  const poolUsdc = parseFloat(String((amm.amount2 as { value?: string })?.value ?? '0'))

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
    pool: {
      account: ammAccount,
      xrp: poolXrp,
      usdc: poolUsdc,
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
          estUsdcOut: poolUsdc * share,
        }
      : null,
    updatedAt: new Date().toISOString(),
  })
}