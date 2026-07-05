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

export async function GET(req: NextRequest) {
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const viewerAddress = req.nextUrl.searchParams.get('address')?.trim() ?? ''
  const token = await tokenRef(networkKey)

  if (!token.issuer) {
    return NextResponse.json({ error: 'USDC issuer not configured' }, { status: 503 })
  }

  let ammR: { amm?: Record<string, unknown> }
  try {
    ammR = await serverRpcCall(networkKey, 'amm_info', {
      asset: { currency: 'XRP' },
      asset2: { currency: token.currency, issuer: token.issuer },
      ledger_index: 'validated',
    })
  } catch {
    return NextResponse.json({
      live: false,
      token: { ...token, symbol: 'F-USDC' },
      updatedAt: new Date().toISOString(),
    })
  }

  const amm = ammR.amm
  if (!amm) {
    return NextResponse.json({
      live: false,
      token: { ...token, symbol: 'F-USDC' },
      updatedAt: new Date().toISOString(),
    })
  }

  const ammAccount = String(amm.account ?? '')
  const lpMeta = amm.lp_token as { currency?: string; issuer?: string; value?: string } | undefined
  const lpCurrency = lpMeta?.currency ?? ''
  const lpTotal = parseFloat(lpMeta?.value ?? '0')
  const falconPool = typeof amm.amount === 'string' ? parseInt(amm.amount, 10) / DROPS : 0
  const usdcPool = parseFloat(String((amm.amount2 as { value?: string })?.value ?? '0'))
  const tradingFeeBps = typeof amm.trading_fee === 'number' ? amm.trading_fee : 0
  const price = usdcPool > 0 ? falconPool / usdcPool : 0

  const usdcValueInFalcon = usdcPool * price
  const tvlFalcon = falconPool + usdcValueInFalcon
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
    token: { ...token, symbol: 'F-USDC' },
    pool: {
      account: ammAccount,
      falcon: falconPool,
      usdc: usdcPool,
      price,
      tradingFeeBps,
      tradingFeePct: tradingFeeBps / 1000,
      lpTokenSupply: lpTotal,
      tvlFalcon,
      falconSharePct,
      usdcSharePct: 100 - falconSharePct,
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
          estUsdcOut: viewerSharePct != null ? usdcPool * (viewerSharePct / 100) : 0,
        }
      : null,
    updatedAt: new Date().toISOString(),
  })
}