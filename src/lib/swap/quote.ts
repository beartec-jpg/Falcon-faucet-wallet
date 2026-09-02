/**
 * On-ledger swap quoting — AMM constant-product math (mainnet-style).
 * Supports classic IOU stables and SPV FBTC MPT (sats ↔ BTC display).
 */

import type { NetworkKey } from '@/lib/networks'
import { serverNetworkConfig, serverRpcCall } from '@/lib/network-server'
import { ammAmountIn, ammAmountOut, applySlippage } from '@/lib/swap/amm-math'
import { fetchWalletAssets } from '@/lib/swap/wallet-assets'
import { isMptToken, type StableTokenRef } from '@/lib/swap/token-config'
import { satsToBtc } from '@/lib/xrpl-amount'

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

export type UsdcTokenRef = Pick<
  StableTokenRef,
  'currency' | 'issuer'
> &
  Partial<Pick<StableTokenRef, 'kind' | 'mptIssuanceId' | 'symbol' | 'displaySymbol' | 'decimals'>>

function asset2Params(token: UsdcTokenRef): Record<string, string> {
  if (isMptToken(token) && token.mptIssuanceId) {
    return { mpt_issuance_id: token.mptIssuanceId.toUpperCase() }
  }
  return { currency: token.currency, issuer: token.issuer }
}

function parseTokenPoolAmount(amount2: unknown, mpt: boolean): number {
  if (amount2 == null) return 0
  // MPT amount2 is often a bare integer string (sats)
  if (typeof amount2 === 'string') {
    const n = parseInt(amount2, 10)
    if (!Number.isFinite(n)) return 0
    return mpt ? satsToBtc(n) : parseFloat(amount2)
  }
  if (typeof amount2 === 'object') {
    const o = amount2 as { value?: string; mpt_issuance_id?: string }
    if (o.value != null) {
      const n = parseFloat(o.value)
      if (!Number.isFinite(n)) return 0
      // Some builds put integer sats in value for MPT
      if (mpt && /^\d+$/.test(String(o.value)) && n > 1e3) return satsToBtc(n)
      return n
    }
  }
  return 0
}

async function ammPool(
  networkKey: NetworkKey,
  token: UsdcTokenRef,
): Promise<{ price: number; xrpPool: number; tokenPool: number; tradingFee: number } | null> {
  if (!isMptToken(token) && !token.issuer) return null
  if (isMptToken(token) && !token.mptIssuanceId) return null

  const r = await serverRpcCall<{ amm?: Record<string, unknown>; error?: string }>(
    networkKey,
    'amm_info',
    {
      asset: { currency: 'XRP' },
      asset2: asset2Params(token),
      ledger_index: 'validated',
    },
    { allowError: true },
  )
  if (r?.error || !r?.amm) return null
  const amm = r.amm
  const xrpDrops = typeof amm.amount === 'string' ? amm.amount : '0'
  const xrpAmt = parseInt(xrpDrops, 10) / DROPS_PER_XRP
  const tokAmt = parseTokenPoolAmount(amm.amount2, isMptToken(token))
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
  token: UsdcTokenRef,
): Promise<{ price: number; xrpPool: number; tokenPool: number } | null> {
  // Order books for MPT are limited until MPTokensV2; skip DEX for MPT
  if (isMptToken(token) || !token.issuer) return null
  try {
    const bookR = await serverRpcCall<{ offers?: Array<Record<string, unknown>> }>(
      networkKey,
      'book_offers',
      {
        taker_gets: { currency: token.currency, issuer: token.issuer },
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

/** Instant swap direction — amount is always FPL. */
export type SwapDirection = 'sell_falcon' | 'buy_falcon'

/** @deprecated Use sell_falcon / buy_falcon */
export type LegacySwapDirection = 'buy' | 'sell'

function normalizeDirection(direction: SwapDirection | LegacySwapDirection): SwapDirection {
  if (direction === 'sell_falcon' || direction === 'buy_falcon') return direction
  return direction === 'buy' ? 'sell_falcon' : 'buy_falcon'
}

export async function quoteSwap(
  networkKey: NetworkKey,
  token: UsdcTokenRef,
  direction: SwapDirection | LegacySwapDirection,
  amount: number,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
): Promise<SwapQuote | null> {
  if (amount <= 0) return null
  if (!isMptToken(token) && !token.issuer) return null

  const dir = normalizeDirection(direction)
  const amm = await ammPool(networkKey, token)
  const dex = amm ? null : await dexQuote(networkKey, token)

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
    const output = (amount / dex.price) * slip
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
  const amm = await ammPool(networkKey, token)
  const dex = amm ? null : await dexQuote(networkKey, token)
  const market = amm ?? dex

  const display =
    token.displaySymbol ||
    token.symbol ||
    (token.currency === 'QUC' ? 'F-USDC' : token.currency)

  let userBalance: { balance: number; limit: number } | null = null
  if (address) {
    const assets = await fetchWalletAssets(networkKey, address).catch(() => null)
    if (isMptToken(token) && token.mptIssuanceId) {
      const row = assets?.tokens?.find(
        (t) =>
          t.mptIssuanceId?.toUpperCase() === token.mptIssuanceId?.toUpperCase() ||
          (t.spvMpt && (t.symbol === 'FBTC' || t.currency === 'BTC')),
      )
      if (row) {
        userBalance = { balance: row.balance, limit: 21_000_000 }
      } else {
        userBalance = { balance: 0, limit: 21_000_000 }
      }
    } else if (token.issuer) {
      const row =
        assets?.tokens?.find(
          (t) => t.currency === token.currency && t.issuer === token.issuer,
        ) ??
        (assets?.fusdc.currency === token.currency && assets.fusdc.issuer === token.issuer
          ? assets.fusdc
          : null)
      if (row?.hasTrustLine) {
        userBalance = { balance: row.balance, limit: 10_000_000 }
      }
    }
  }

  const configured = isMptToken(token) ? !!token.mptIssuanceId : !!token.issuer

  return {
    network: networkKey,
    networkId: cfg.networkId,
    token: {
      symbol: display,
      currency: token.currency,
      issuer: token.issuer,
      configured,
      kind: isMptToken(token) ? ('mpt' as const) : ('iou' as const),
      mptIssuanceId: token.mptIssuanceId,
      decimals: token.decimals ?? (isMptToken(token) ? 8 : 6),
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
    /** Hint for UI when SPV FBTC has no MPT AMM yet (needs MPTokensV2 + seed). */
    poolHint: isMptToken(token) && !market
      ? 'SPV FBTC pool not created yet. Requires MPTokensV2 enabled and an AMM seed (FPL + FBTC).'
      : undefined,
  }
}
