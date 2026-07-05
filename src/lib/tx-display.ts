const DROPS_PER_FALCON = 1_000_000

export type TxDisplayAsset = 'FALCON' | 'F-USDC'

export interface ParsedTxAmount {
  display: string
  asset: TxDisplayAsset
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
    const value = String((amount as { value: unknown }).value)
    const n = parseFloat(value)
    if (!Number.isFinite(n)) return null
    return {
      display: n.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 8,
      }),
      asset: 'F-USDC',
    }
  }

  return null
}