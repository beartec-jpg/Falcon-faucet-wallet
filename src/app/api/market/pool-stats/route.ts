import { NextRequest, NextResponse } from 'next/server'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'
import { resolveStableToken } from '@/lib/swap/token-config'

const DROPS = 1_000_000

interface RippleStateObj {
  LedgerEntryType?: string
  Balance?: { currency?: string; issuer?: string; value?: string }
  HighLimit?: { currency?: string; issuer?: string; value?: string }
  LowLimit?: { currency?: string; issuer?: string; value?: string }
}

function parseLpHolder(
  obj: RippleStateObj,
  ammAccount: string,
  lpCurrency: string,
): { address: string; lpBalance: number } | null {
  if (obj.LedgerEntryType !== 'RippleState') return null
  const bal = obj.Balance
  if (!bal || bal.currency !== lpCurrency) return null
  const amount = Math.abs(parseFloat(bal.value ?? '0'))
  if (amount <= 0) return null

  const high = obj.HighLimit?.issuer ?? ''
  const low = obj.LowLimit?.issuer ?? ''
  let holder = ''
  if (low === ammAccount) holder = high
  else if (high === ammAccount) holder = low
  if (!holder || holder === ammAccount) return null
  return { address: holder, lpBalance: amount }
}

async function listLpHolders(
  networkKey: ReturnType<typeof resolveNetworkKey>,
  ammAccount: string,
  lpCurrency: string,
): Promise<Array<{ address: string; lpBalance: number }>> {
  const holders: Array<{ address: string; lpBalance: number }> = []
  let marker: unknown = undefined

  for (let page = 0; page < 20; page++) {
    const params: Record<string, unknown> = {
      account: ammAccount,
      ledger_index: 'validated',
      limit: 200,
    }
    if (marker) params.marker = marker

    const r = await serverRpcCall<{
      account_objects?: RippleStateObj[]
      marker?: unknown
    }>(networkKey, 'account_objects', params)

    for (const obj of r.account_objects ?? []) {
      const h = parseLpHolder(obj, ammAccount, lpCurrency)
      if (h) holders.push(h)
    }

    if (!r.marker) break
    marker = r.marker
  }

  return holders.sort((a, b) => b.lpBalance - a.lpBalance)
}

function asset2ForToken(token: {
  currency: string
  issuer: string
  kind?: string
  mptIssuanceId?: string
}): Record<string, string> {
  if ((token.kind === 'mpt' || token.mptIssuanceId) && token.mptIssuanceId) {
    return { mpt_issuance_id: token.mptIssuanceId.toUpperCase() }
  }
  return { currency: token.currency, issuer: token.issuer }
}

function parseTokenPoolAmount(amount2: unknown, mpt: boolean): number {
  if (amount2 == null) return 0
  if (typeof amount2 === 'string') {
    const n = parseInt(amount2, 10)
    if (!Number.isFinite(n)) return 0
    return mpt ? n / 1e8 : parseFloat(amount2)
  }
  if (typeof amount2 === 'object') {
    const o = amount2 as { value?: string }
    if (o.value != null) {
      const n = parseFloat(o.value)
      if (!Number.isFinite(n)) return 0
      if (mpt && /^\d+$/.test(String(o.value)) && n > 1e3) return n / 1e8
      return n
    }
  }
  return 0
}

export async function GET(req: NextRequest) {
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const viewerAddress = req.nextUrl.searchParams.get('address')?.trim() ?? ''
  const token = await resolveStableToken({
    symbol: req.nextUrl.searchParams.get('symbol'),
    currency: req.nextUrl.searchParams.get('currency'),
    issuer: req.nextUrl.searchParams.get('issuer'),
    networkKey,
  })

  const mpt = token.kind === 'mpt' || !!token.mptIssuanceId
  if (!mpt && !token.issuer) {
    return NextResponse.json({ error: `${token.displaySymbol} issuer not configured` }, { status: 503 })
  }
  if (mpt && !token.mptIssuanceId) {
    return NextResponse.json({ error: 'SPV FBTC MPT issuance not found on bridge' }, { status: 503 })
  }

  const tokenOut = {
    currency: token.currency,
    issuer: token.issuer,
    symbol: token.displaySymbol,
    kind: mpt ? ('mpt' as const) : ('iou' as const),
    mptIssuanceId: token.mptIssuanceId,
    decimals: token.decimals ?? (mpt ? 8 : 6),
  }

  let ammR: { amm?: Record<string, unknown> }
  try {
    ammR = await serverRpcCall(networkKey, 'amm_info', {
      asset: { currency: 'XRP' },
      asset2: asset2ForToken(token),
      ledger_index: 'validated',
    })
  } catch {
    return NextResponse.json({
      live: false,
      token: tokenOut,
      poolHint: mpt
        ? 'SPV FBTC AMM not found — needs MPTokensV2 + FPL/FBTC seed.'
        : undefined,
      updatedAt: new Date().toISOString(),
    })
  }

  const amm = ammR.amm
  if (!amm) {
    return NextResponse.json({
      live: false,
      token: tokenOut,
      poolHint: mpt
        ? 'SPV FBTC AMM not found — needs MPTokensV2 + FPL/FBTC seed.'
        : undefined,
      updatedAt: new Date().toISOString(),
    })
  }

  const ammAccount = String(amm.account ?? '')
  const lpMeta = amm.lp_token as { currency?: string; issuer?: string; value?: string } | undefined
  const lpCurrency = lpMeta?.currency ?? ''
  const lpTotal = parseFloat(lpMeta?.value ?? '0')
  const falconPool = typeof amm.amount === 'string' ? parseInt(amm.amount, 10) / DROPS : 0
  const tokenPool = parseTokenPoolAmount(amm.amount2, mpt)
  const tradingFeeBps = typeof amm.trading_fee === 'number' ? amm.trading_fee : 0
  const price = tokenPool > 0 ? falconPool / tokenPool : 0

  const tokenValueInFalcon = tokenPool * price
  const tvlFalcon = falconPool + tokenValueInFalcon
  const falconSharePct = tvlFalcon > 0 ? (falconPool / tvlFalcon) * 100 : 50

  const contributors = lpCurrency && ammAccount
    ? await listLpHolders(networkKey, ammAccount, lpCurrency)
    : []

  const contributorCount = contributors.length
  const viewer = viewerAddress
    ? contributors.find((c) => c.address === viewerAddress)
    : undefined
  const viewerSharePct = viewer && lpTotal > 0 ? (viewer.lpBalance / lpTotal) * 100 : null

  const voteSlots = Array.isArray(amm.vote_slots) ? amm.vote_slots.length : 0
  const auction = amm.auction_slot as { account?: string; expiration?: string } | undefined

  return NextResponse.json({
    live: true,
    token: tokenOut,
    pool: {
      account: ammAccount,
      falcon: falconPool,
      usdc: tokenPool, // legacy field name (token leg of AMM)
      token: tokenPool,
      price,
      tradingFeeBps,
      tradingFeePct: tradingFeeBps / 1000,
      lpTokenSupply: lpTotal,
      tvlFalcon,
      falconSharePct,
      usdcSharePct: 100 - falconSharePct,
      tokenSharePct: 100 - falconSharePct,
      contributorCount,
      voteSlots,
      auctionHolder: auction?.account ?? null,
      auctionExpires: auction?.expiration ?? null,
    },
    contributors: contributors.map((c) => ({
      address: c.address,
      lpBalance: c.lpBalance,
      sharePct: lpTotal > 0 ? (c.lpBalance / lpTotal) * 100 : 0,
    })),
    viewer: viewerAddress
      ? {
          address: viewerAddress,
          hasPosition: !!viewer,
          lpBalance: viewer?.lpBalance ?? 0,
          sharePct: viewerSharePct,
          estFalconOut: viewerSharePct != null ? falconPool * (viewerSharePct / 100) : 0,
          estUsdcOut: viewerSharePct != null ? tokenPool * (viewerSharePct / 100) : 0,
          estTokenOut: viewerSharePct != null ? tokenPool * (viewerSharePct / 100) : 0,
        }
      : null,
    updatedAt: new Date().toISOString(),
  })
}
