/**
 * On-ledger swap quoting — AMM constant-product math (mainnet-style).
 */

import type { NetworkKey } from '@/lib/networks'
import { serverNetworkConfig, serverRpcCall } from '@/lib/network-server'
import { ammAmountIn, ammAmountOut, applySlippage } from '@/lib/swap/amm-math'
import { fetchWalletAssets } from '@/lib/swap/wallet-assets'

const DROPS_PER_XRP = 1_000_000
const DEFAULT_SLIPPAGE_BPS = 50

export interface SwapQuote {
  source: 'amm' | 'dex'
  price: number
  inputAmount: number
  outputAmount: number
  minOutputAmount: number
  tradingFeeBps: number
  pool?: {
    xrp: number
    token: number
    type: 'amm' | 'dex'
  }
}

export interface UsdcTokenRef {
  currency: string
  issuer: string
}

async function ammPool(
  networkKey: NetworkKey,
  currency: string,
  issuer: string,
): Promise<{ price: number; xrpPool: number; tokenPool: number; tradingFee: number } | null> {
  // Transport/RPC failures propagate (caller maps to a 502 "node unavailable");
  // a genuinely absent AMM returns null ("no liquidity").
  const r = await serverRpcCall<{ amm?: Record<string, unknown>; error?: string }>(
    networkKey,
    'amm_info',
    {
      asset: { currency: 'XRP' },
      asset2: { currency, issuer },
      ledger_index: 'validated',
    },
    { allowError: true },
  )
  if (r?.error || !r?.amm) return null
  const amm = r.amm
  const xrpDrops = typeof amm.amount === 'string' ? amm.amount : '0'
  const amount2 = amm.amount2 as { value?: string } | undefined
  const xrpAmt = parseInt(xrpDrops, 10) / DROPS_PER_XRP
  const tokAmt = parseFloat(amount2?.value ?? '0')
  if (tokAmt <= 0) return null
  return {
    price: xrpAmt / tokAmt,
    xrpPool: xrpAmt,
    tokenPool: tokAmt,
    tradingFee: typeof amm.trading_fee === 'number' ? amm.trading_fee : 0,
  }
}

async function dexQuote(
  networkKey: NetworkKey,
  currency: string,
  issuer: string,
): Promise<{ price: number; xrpPool: number; tokenPool: number } | null> {
  try {
    const bookR = await serverRpcCall<{ offers?: Array<Record<string, unknown>> }>(
      networkKey,
      'book_offers',
      {
        taker_gets: { currency, issuer },
        taker_pays: { currency: 'XRP' },
        limit: 20,
        ledger_index: 'validated',
      },
    )
    const offers = bookR?.offers ?? []
    if (offers.length === 0) return null
    const best = offers[0]
    const qual = parseFloat(String(best.quality ?? '0'))
    const price = qual > 0 ? qual / DROPS_PER_XRP : 0
    let totalToken = 0
    let totalXrp = 0
    for (const o of offers) {
      const gets = o.TakerGets as { value?: string } | string | undefined
      const pays = o.TakerPays as string | undefined
      if (typeof gets === 'object' && gets?.value) {
        totalToken += parseFloat(gets.value)
      }
      if (typeof pays === 'string') {
        totalXrp += parseInt(pays, 10) / DROPS_PER_XRP
      }
    }
    return { price, xrpPool: totalXrp, tokenPool: totalToken }
  } catch {
    return null
  }
}

/** Instant swap direction — amount is always FALCON. */
export type SwapDirection = 'sell_falcon' | 'buy_falcon'

/** @deprecated Use sell_falcon / buy_falcon */
export type LegacySwapDirection = 'buy' | 'sell'

function normalizeDirection(direction: SwapDirection | LegacySwapDirection): SwapDirection {
  if (direction === 'sell_falcon' || direction === 'buy_falcon') return direction
  // Legacy: buy = spend FALCON → F-USDC; sell = spend F-USDC → FALCON
  return direction === 'buy' ? 'sell_falcon' : 'buy_falcon'
}

export async function quoteSwap(
  networkKey: NetworkKey,
  token: UsdcTokenRef,
  direction: SwapDirection | LegacySwapDirection,
  amount: number,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
): Promise<SwapQuote | null> {
  if (amount <= 0 || !token.issuer) return null

  const dir = normalizeDirection(direction)
  const amm = await ammPool(networkKey, token.currency, token.issuer)
  const dex = amm ? null : await dexQuote(networkKey, token.currency, token.issuer)

  if (amm) {
    let output: number
    if (dir === 'sell_falcon') {
      output = ammAmountOut(amm.xrpPool, amm.tokenPool, amount, amm.tradingFee)
    } else {
      output = ammAmountIn(amm.tokenPool, amm.xrpPool, amount, amm.tradingFee)
    }
    if (output <= 0) return null
    const minOut = applySlippage(output, slippageBps, dir === 'sell_falcon' ? 'min' : 'max')
    return {
      source: 'amm',
      price: amm.price,
      inputAmount: amount,
      outputAmount: output,
      minOutputAmount: minOut,
      tradingFeeBps: amm.tradingFee,
      pool: { xrp: amm.xrpPool, token: amm.tokenPool, type: 'amm' },
    }
  }

  if (!dex || dex.price <= 0) return null
  const slip = 1 - slippageBps / 10_000
  if (dir === 'sell_falcon') {
    const output = amount / dex.price * slip
    return {
      source: 'dex',
      price: dex.price,
      inputAmount: amount,
      outputAmount: output,
      minOutputAmount: output,
      tradingFeeBps: 0,
      pool: { xrp: dex.xrpPool, token: dex.tokenPool, type: 'dex' },
    }
  }
  const output = amount / dex.price / slip
  return {
    source: 'dex',
    price: dex.price,
    inputAmount: amount,
    outputAmount: output,
    minOutputAmount: output,
    tradingFeeBps: 0,
    pool: { xrp: dex.xrpPool, token: dex.tokenPool, type: 'dex' },
  }
}

export async function getUsdcMarket(
  networkKey: NetworkKey,
  token: UsdcTokenRef,
  address?: string,
) {
  const cfg = serverNetworkConfig(networkKey)
  const amm = await ammPool(networkKey, token.currency, token.issuer)
  const dex = amm ? null : await dexQuote(networkKey, token.currency, token.issuer)
  const market = amm ?? dex

  let userBalance: { balance: number; limit: number } | null = null
  if (address && token.issuer) {
    const assets = await fetchWalletAssets(networkKey, address).catch(() => null)
    if (assets?.fusdc.hasTrustLine) {
      userBalance = { balance: assets.fusdc.balance, limit: 10_000_000 }
    }
  }

  return {
    network: networkKey,
    networkId: cfg.networkId,
    token: {
      symbol: 'F-USDC',
      currency: token.currency,
      issuer: token.issuer,
      configured: !!token.issuer,
    },
    market: market
      ? {
          type: amm ? ('amm' as const) : ('dex' as const),
          price: market.price,
          xrpPool: market.xrpPool,
          tokenPool: market.tokenPool,
          tradingFee: amm?.tradingFee ?? 0,
        }
      : null,
    userBalance,
  }
}