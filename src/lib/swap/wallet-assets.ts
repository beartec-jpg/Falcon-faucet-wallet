import type { NetworkKey } from '@/lib/networks'
import { serverRpcCall } from '@/lib/network-server'
import { loadStableToken } from '@/lib/swap/token-config'

const DROPS = 1_000_000

export interface WalletAssetBalances {
  fusdc: {
    symbol: string
    balance: number
    currency: string
    issuer: string
  } | null
  lp: {
    symbol: string
    balance: number
    currency: string
    issuer: string
    sharePct: number
    estXrpOut: number
    estUsdcOut: number
  } | null
}

export async function fetchWalletAssets(
  networkKey: NetworkKey,
  address: string,
): Promise<WalletAssetBalances> {
  const token = await loadStableToken()
  let fusdc: WalletAssetBalances['fusdc'] = null
  let lp: WalletAssetBalances['lp'] = null

  if (!token.issuer) return { fusdc, lp }

  const linesR = await serverRpcCall<{
    lines?: Array<{ currency: string; account: string; balance: string }>
  }>(networkKey, 'account_lines', {
    account: address,
    ledger_index: 'validated',
  }).catch(() => ({ lines: [] }))

  const usdcLine = (linesR.lines ?? []).find(
    (l) => l.currency === token.currency && l.account === token.issuer,
  )
  if (usdcLine) {
    const bal = parseFloat(usdcLine.balance)
    fusdc = {
      symbol: token.displaySymbol,
      balance: bal,
      currency: token.currency,
      issuer: token.issuer,
    }
  }

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

    const lpLine = (linesR.lines ?? []).find(
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

  return { fusdc, lp }
}