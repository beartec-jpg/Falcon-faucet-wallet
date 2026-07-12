/** Pre-flight helpers for DEX limit orders vs AMM / book crossing. */

export type LimitSide = 'sell' | 'buy'

/** Price is FALCON per F-USDC (same as order form). */
export function limitOrderWouldCross(
  side: LimitSide,
  price: number,
  marketPrice: number | null | undefined,
  bestBid?: number | null,
  bestAsk?: number | null,
): boolean {
  if (!Number.isFinite(price) || price <= 0) return false
  if (side === 'sell') {
    if (marketPrice != null && marketPrice > 0 && price <= marketPrice * (1 + 1e-9)) return true
    if (bestBid != null && bestBid > 0 && price <= bestBid * (1 + 1e-9)) return true
  } else {
    if (marketPrice != null && marketPrice > 0 && price >= marketPrice * (1 - 1e-9)) return true
    if (bestAsk != null && bestAsk > 0 && price >= bestAsk * (1 - 1e-9)) return true
  }
  return false
}

/** Maker price that should rest (bps away from AMM mid). */
export function suggestMakerPrice(
  side: LimitSide,
  marketPrice: number,
  bpsAway = 50,
): string {
  const factor = side === 'sell' ? 1 + bpsAway / 10_000 : 1 - bpsAway / 10_000
  const px = marketPrice * factor
  if (!Number.isFinite(px) || px <= 0) return String(marketPrice)
  const digits = px >= 1 ? 4 : 6
  return px.toFixed(digits)
}

export function limitOrderPreflightReason(opts: {
  side: LimitSide
  price: number
  postOnly: boolean
  marketPrice: number | null | undefined
  bestBid?: number | null
  bestAsk?: number | null
}): string | null {
  const { side, price, postOnly, marketPrice, bestBid, bestAsk } = opts
  if (!Number.isFinite(price) || price <= 0) return 'Enter a valid price (FALCON per F-USDC).'

  const crosses = limitOrderWouldCross(side, price, marketPrice, bestBid, bestAsk)

  if (postOnly && crosses) {
    const hint =
      side === 'sell'
        ? suggestMakerPrice('sell', marketPrice ?? price)
        : suggestMakerPrice('buy', marketPrice ?? price)
    return side === 'sell'
      ? `Price is at or below market — Post only would be rejected on-chain. Raise your ask above ~${hint} FALCON per F-USDC, or uncheck Post only to fill instantly via the book/AMM.`
      : `Price is at or above market — Post only would be rejected on-chain. Lower your bid below ~${hint} FALCON per F-USDC, or uncheck Post only to fill instantly via the book/AMM.`
  }

  if (!postOnly && crosses && marketPrice != null) {
    return null // allow — user opted into instant fill; UI shows warning only
  }

  return null
}

export function explainOfferResult(
  engineResult: string | undefined,
  postOnly: boolean,
): string | null {
  if (engineResult === 'tecKILLED') {
    return postOnly
      ? 'Order rejected: Post only cannot cross the book or AMM at this price. Use a higher sell price or lower buy price, or tap “Maker price”.'
      : 'Order killed on-ledger (no matching liquidity at this price).'
  }
  if (engineResult === 'tecUNFUNDED_OFFER') {
    return 'Insufficient balance to fund this offer (check F-USDC or FALCON).'
  }
  return null
}