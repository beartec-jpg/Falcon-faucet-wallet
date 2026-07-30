/** Simple USD spot prices for multi-chain portfolio total (best-effort). */

export type SpotPrices = {
  eth: number
  btc: number
  bnb: number
  usdc: number
}

const DEFAULTS: SpotPrices = {
  eth: 0,
  btc: 0,
  bnb: 0,
  usdc: 1,
}

/** CoinGecko free simple price — fails soft to zeros. */
export async function fetchSpotPrices(): Promise<SpotPrices> {
  try {
    const url =
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin,binancecoin&vs_currencies=usd'
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return { ...DEFAULTS }
    const j = (await r.json()) as Record<string, { usd?: number }>
    return {
      eth: j.ethereum?.usd ?? 0,
      btc: j.bitcoin?.usd ?? 0,
      bnb: j.binancecoin?.usd ?? 0,
      usdc: 1,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function multiChainUsdTotal(
  bals: { eth: number | null; usdc: number | null; btc: number | null; bnb: number | null },
  prices: SpotPrices,
): number | null {
  const parts: number[] = []
  if (bals.usdc != null) parts.push(bals.usdc * prices.usdc)
  if (bals.eth != null && prices.eth > 0) parts.push(bals.eth * prices.eth)
  if (bals.btc != null && prices.btc > 0) parts.push(bals.btc * prices.btc)
  if (bals.bnb != null && prices.bnb > 0) parts.push(bals.bnb * prices.bnb)
  if (parts.length === 0) return null
  // If we only have USDC known, still show that
  if (prices.eth <= 0 && prices.btc <= 0 && prices.bnb <= 0) {
    return bals.usdc
  }
  return parts.reduce((a, b) => a + b, 0)
}
