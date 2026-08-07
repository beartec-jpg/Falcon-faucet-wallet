import type { NetworkKey } from '@/lib/networks'
import { serverRpcCall } from '@/lib/network-server'
import { loadStableToken, loadStableTokens } from '@/lib/swap/token-config'

const DROPS = 1_000_000

/** Parse MPT / bridge sats: decimal string or hex (engine often returns hex). */
function parseMptSats(raw: unknown): number {
  if (raw == null) return 0
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  const s = String(raw).trim()
  if (!s) return 0
  if (/^0x[0-9a-f]+$/i.test(s)) {
    const n = parseInt(s.slice(2), 16)
    return Number.isFinite(n) ? n : 0
  }
  // Hex without 0x when it contains a-f
  if (/^[0-9a-f]+$/i.test(s) && /[a-f]/i.test(s)) {
    const n = parseInt(s, 16)
    return Number.isFinite(n) ? n : 0
  }
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** One Falcon IOU / stable row (multi-asset ready). */
export interface WalletIouBalance {
  id: string
  symbol: string
  /** Portfolio total (IOU + SPV MPT for FBTC) */
  balance: number
  currency: string
  issuer: string
  hasTrustLine: boolean
  /** SPV light-client mint (MPToken); amount already included in balance when set */
  spvMpt?: boolean
  mptIssuanceId?: string
  /** Classic IOU only (BTC trust line) — not burnable via BTCBridgeBurn */
  iouBalance?: number
  /** SPV MPT only (sats/1e8) — burnable via Bridge Out SPV path */
  spvMptBalance?: number
  /** Raw MPT sats for SPV FBTC */
  spvMptSats?: number
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

  // SPV FBTC is minted as MPToken (sats integer), not the legacy IOU trust line.
  // Merge MPT balance into the FBTC row so the Falcon tab shows the light-client mint.
  try {
    const [bridgeR, objsR] = await Promise.all([
      serverRpcCall<{
        node?: {
          MPTokenIssuanceID?: string
          Account?: string
        }
        error?: string
      }>(
        networkKey,
        'ledger_entry',
        { btc_bridge_state: true, ledger_index: 'validated' },
        { allowError: true },
      ).catch(() => ({ node: undefined })),
      serverRpcCall<{
        account_objects?: Array<{
          LedgerEntryType?: string
          MPTokenIssuanceID?: string
          MPTAmount?: string | number
        }>
      }>(networkKey, 'account_objects', {
        account: address,
        ledger_index: 'validated',
        limit: 400,
      }).catch(() => ({ account_objects: [] })),
    ])

    const issuanceId = (bridgeR as { node?: { MPTokenIssuanceID?: string } })?.node
      ?.MPTokenIssuanceID
    const spvIssuer = (bridgeR as { node?: { Account?: string } })?.node?.Account
    if (issuanceId) {
      // SPV FBTC is an MPT. BTCDepositClaim auto-runs authorizeMPToken for the
      // destination — no classic TrustSet / trust-line step for the holder.
      const mpt = (objsR.account_objects ?? []).find(
        (o) =>
          o.LedgerEntryType === 'MPToken' &&
          String(o.MPTokenIssuanceID || '').toUpperCase() === issuanceId.toUpperCase(),
      )
      const sats = mpt ? parseMptSats(mpt.MPTAmount) : 0
      const btc = sats > 0 ? sats / 1e8 : 0
      const fbtcIdx = tokens.findIndex(
        (t) => t.symbol === 'FBTC' || t.currency === 'BTC' || t.id === 'fbtc',
      )
      if (fbtcIdx >= 0) {
        const iouOnly = tokens[fbtcIdx].balance
        tokens[fbtcIdx] = {
          ...tokens[fbtcIdx],
          // Portfolio: classic IOU + SPV MPT (different rails — do not burn IOU via SPV)
          balance: iouOnly + btc,
          iouBalance: iouOnly,
          spvMptBalance: btc,
          spvMptSats: sats,
          // Ready to receive via SPV even before first mint (no TrustSet needed)
          hasTrustLine: true,
          spvMpt: true,
          mptIssuanceId: issuanceId,
          issuer: spvIssuer || tokens[fbtcIdx].issuer,
        }
      } else {
        tokens.push({
          id: 'fbtc',
          symbol: 'FBTC',
          balance: btc,
          currency: 'BTC',
          issuer: spvIssuer || '',
          hasTrustLine: true,
          spvMpt: true,
          mptIssuanceId: issuanceId,
          iouBalance: 0,
          spvMptBalance: btc,
          spvMptSats: sats,
        })
      }
    }
  } catch {
    /* SPV not active or RPC missing fields — keep IOU-only view */
  }

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