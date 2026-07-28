import type { NetworkKey } from '@/lib/networks'
import { serverRpcCall } from '@/lib/network-server'
import { loadStableToken, loadStableTokens } from '@/lib/swap/token-config'

const DROPS = 1_000_000

/** One Falcon IOU / stable row (multi-asset ready). */
export interface WalletIouBalance {
  id: string
  symbol: string
  balance: number
  currency: string
  issuer: string
  hasTrustLine: boolean
}

export interface WalletAssetBalances {
  /** @deprecated prefer `tokens` — kept for F-USDC call sites */
  fusdc: {
    symbol: string
    balance: number
    currency: string
    issuer: string
    hasTrustLine: boolean
  }
  /** All configured stable / bridged IOUs on Falcon */
  tokens: WalletIouBalance[]
  lp: {
    symbol: string
    balance: number
    currency: string
    issuer: string
    sharePct: number
    estXrpOut: number
    estUsdcOut: number
  }
}

export async function fetchWalletAssets(
  networkKey: NetworkKey,
  address: string,
): Promise<WalletAssetBalances> {
  const catalog = await loadStableTokens()
  const token = catalog[0] ?? (await loadStableToken())
  const emptyFusdc: WalletAssetBalances['fusdc'] = {
    symbol: 'F-USDC',
    balance: 0,
    currency: token.currency,
    issuer: token.issuer,
    hasTrustLine: false,
  }
  const emptyLp: WalletAssetBalances['lp'] = {
    symbol: 'LP-TOKENS',
    balance: 0,
    currency: '',
    issuer: '',
    sharePct: 0,
    estXrpOut: 0,
    estUsdcOut: 0,
  }

  if (!token.issuer && catalog.length === 0) {
    return { fusdc: emptyFusdc, tokens: [], lp: emptyLp }
  }

  const linesR = await serverRpcCall<{
    lines?: Array<{ currency: string; account: string; balance: string }>
  }>(networkKey, 'account_lines', {
    account: address,
    ledger_index: 'validated',
  }).catch(() => ({ lines: [] }))

  const lines = linesR.lines ?? []
  const tokens: WalletIouBalance[] = catalog.map((t, i) => {
    const line = lines.find((l) => l.currency === t.currency && l.account === t.issuer)
    return {
      id: t.symbol.toLowerCase().replace(/[^a-z0-9]+/g, '_') || `token_${i}`,
      symbol: t.displaySymbol || t.symbol,
      balance: line ? parseFloat(line.balance) : 0,
      currency: t.currency,
      issuer: t.issuer,
      hasTrustLine: !!line,
    }
  })

  const usdcTok = tokens.find((t) => t.currency === token.currency && t.issuer === token.issuer)
  const fusdc: WalletAssetBalances['fusdc'] = usdcTok
    ? {
        symbol: usdcTok.symbol,
        balance: usdcTok.balance,
        currency: usdcTok.currency,
        issuer: usdcTok.issuer,
        hasTrustLine: usdcTok.hasTrustLine,
      }
    : emptyFusdc

  let lp: WalletAssetBalances['lp'] | undefined

  const ammR = await serverRpcCall<{ amm?: Record<string, unknown> }>(networkKey, 'amm_info', {
    asset: { currency: 'XRP' },
    asset2: { currency: token.currency, issuer: token.issuer },
    ledger_index: 'validated',
  }).catch(() => ({ amm: undefined }))

  const amm = ammR.amm
  if (amm) {
    const ammAccount = String(amm.account ?? '')
    const lpMeta = amm.lp_token as { currency?: string; value?: string } | undefined
    const poolLpTotal = parseFloat(lpMeta?.value ?? '0')
    const poolXrp = typeof amm.amount === 'string' ? parseInt(amm.amount, 10) / DROPS : 0
    const poolUsdc = parseFloat(String((amm.amount2 as { value?: string })?.value ?? '0'))

    const lpLine = lines.find(
      (l) => l.account === ammAccount && lpMeta?.currency && l.currency === lpMeta.currency,
    )
    if (lpLine && lpMeta?.currency) {
      const lpBal = parseFloat(lpLine.balance)
      if (lpBal > 0 && poolLpTotal > 0) {
        const share = lpBal / poolLpTotal
        lp = {
          symbol: 'LP-TOKENS',
          balance: lpBal,
          currency: lpMeta.currency,
          issuer: ammAccount,
          sharePct: share * 100,
          estXrpOut: poolXrp * share,
          estUsdcOut: poolUsdc * share,
        }
      }
    }
  }

  return { fusdc, tokens, lp: lp ?? emptyLp }
}