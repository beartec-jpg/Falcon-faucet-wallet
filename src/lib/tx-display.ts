const DROPS_PER_FALCON = 1_000_000

/** Display label for native or issued amounts in tx history. */
export type TxDisplayAsset = string

export interface ParsedTxAmount {
  display: string
  asset: TxDisplayAsset
  /** XRPL currency code when IOU (QUC, ETH, BNB, …) */
  currency?: string
  issuer?: string
}

/** Map Falcon IOU currency codes → product symbols. */
export function currencyToDisplayAsset(currency: string | undefined): string {
  if (!currency) return 'IOU'
  const c = currency.toUpperCase()
  switch (c) {
    case 'QUC':
    case 'USD':
    case 'USDC':
      return 'F-USDC'
    case 'ETH':
      return 'FETH'
    case 'BNB':
      return 'FBNB'
    case 'BTC':
    case 'XBT':
      return 'FBTC'
    case 'QUT':
    case 'USDT':
      return 'F-USDT'
    default:
      // 3-char classic currency or hex 40-char — show readable code
      if (/^[A-Z0-9]{3}$/.test(c)) return c
      if (c.length >= 8) return `${c.slice(0, 4)}…`
      return c
  }
}

/** Parse XRPL Payment Amount (drops string or IOU object) for UI display. */
export function parseTxAmount(amount: unknown): ParsedTxAmount | null {
  if (amount == null) return null

  if (typeof amount === 'string') {
    const drops = parseInt(amount, 10)
    if (!Number.isFinite(drops)) return null
    return {
      display: (drops / DROPS_PER_FALCON).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 6,
      }),
      asset: 'FALCON',
    }
  }

  if (typeof amount === 'object' && amount !== null && 'value' in amount) {
    const iou = amount as { value: unknown; currency?: string; issuer?: string }
    const value = String(iou.value)
    const n = parseFloat(value)
    if (!Number.isFinite(n)) return null
    const currency = iou.currency ? String(iou.currency) : undefined
    const issuer = iou.issuer ? String(iou.issuer) : undefined
    return {
      display: n.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 8,
      }),
      asset: currencyToDisplayAsset(currency),
      currency,
      issuer,
    }
  }

  return null
}
