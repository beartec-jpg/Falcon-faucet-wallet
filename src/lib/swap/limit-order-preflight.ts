/** Pre-flight helpers for DEX limit orders vs AMM / book crossing. */

export type LimitSide = 'sell' | 'buy'

/** Price is FALCON per F-USDC (same as order form). */
export function falconPerFusdcToInverse(price: number): number | null {
  if (!Number.isFinite(price) || price <= 0) return null
  return 1 / price
}

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
    // Cheaper ask (lower FALCON/F-USDC) crosses AMM and bids.
    if (marketPrice != null && marketPrice > 0 && price <= marketPrice * (1 + 1e-9)) return true
    if (bestBid != null && bestBid > 0 && price <= bestBid * (1 + 1e-9)) return true
  } else {
    // Richer bid (higher FALCON/F-USDC) crosses AMM and asks.
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

export function restingPriceHint(
  side: LimitSide,
  marketPrice: number | null | undefined,
): string | null {
  if (marketPrice == null || marketPrice <= 0) return null
  const maker = suggestMakerPrice(side, marketPrice)
  return side === 'sell'
    ? `List a sell on the book: enter more than ~${marketPrice.toFixed(2)} FALCON per F-USDC (try ${maker}). Lower numbers sell cheaper and hit the AMM.`
    : `List a buy on the book: enter less than ~${marketPrice.toFixed(2)} FALCON per F-USDC (try ${maker}). Higher numbers pay more and hit the AMM.`
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
  const mid = marketPrice ?? null
  const maker = mid != null ? suggestMakerPrice(side, mid) : null

  if (crosses && mid != null) {
    if (side === 'sell') {
      return `Your price ${price} is below AMM mid ~${mid.toFixed(2)} FALCON per F-USDC — this sells F-USDC too cheap and will execute immediately through the AMM, not rest on the book. Post only does not stop AMM fills. To list, use at least ~${maker ?? mid.toFixed(2)} (higher number = higher ask).`
    }
    return `Your price ${price} is above AMM mid ~${mid.toFixed(2)} FALCON per F-USDC — this bid pays too much and will execute immediately through the AMM. To list, use below ~${maker ?? mid.toFixed(2)} (lower number = lower bid).`
  }

  if (postOnly && crosses) {
    return null // covered above
  }

  return null
}

/** Block listing when price would cross AMM/book (rest intent). */
export function shouldBlockRestingOrder(
  side: LimitSide,
  price: number,
  marketPrice: number | null | undefined,
  bestBid?: number | null,
  bestAsk?: number | null,
): boolean {
  return limitOrderWouldCross(side, price, marketPrice, bestBid, bestAsk)
}

export function explainOfferResult(
  engineResult: string | undefined,
  postOnly: boolean,
): string | null {
  if (engineResult === 'tecKILLED') {
    return postOnly
      ? 'Order rejected on the DEX book (Post only). Adjust price further from AMM mid, or uncheck Post only.'
      : 'Order killed on-ledger (no matching liquidity at this price).'
  }
  if (engineResult === 'tecUNFUNDED_OFFER') {
    return 'Insufficient balance to fund this offer (check F-USDC or FALCON).'
  }
  return null
}