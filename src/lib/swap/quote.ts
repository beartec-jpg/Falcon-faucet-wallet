/**
 * On-ledger swap quoting — AMM pool, order book, or path_find.
 */

import type { NetworkKey } from '@/lib/networks'
import { serverNetworkConfig, serverRpcCall } from '@/lib/network-server'

const DROPS_PER_XRP = 1_000_000

export interface SwapQuote {
  source: 'amm' | 'dex' | 'path'
  price: number
  inputAmount: number
  outputAmount: number
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

async function ammQuote(
  networkKey: NetworkKey,
  currency: string,
  issuer: string,
): Promise<{ price: number; xrpPool: number; tokenPool: number; tradingFee: number } | null> {
  try {
    const r = await serverRpcCall<{ amm?: Record<string, unknown> }>(networkKey, 'amm_info', {
      asset: { currency: 'XRP' },
      asset2: { currency, issuer },
      ledger_index: 'validated',
    })
    if (!r?.amm) return null
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
  } catch {
    return null
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

export async function quoteSwap(
  networkKey: NetworkKey,
  token: UsdcTokenRef,
  direction: 'buy' | 'sell',
  amount: number,
  slippageBps = 100,
): Promise<SwapQuote | null> {
  if (amount <= 0 || !token.issuer) return null

  const amm = await ammQuote(networkKey, token.currency, token.issuer)
  const dex = amm ? null : await dexQuote(networkKey, token.currency, token.issuer)
  const source = amm ? amm : dex
  if (!source || source.price <= 0) return null

  const slip = 1 - slippageBps / 10_000
  const src = amm ? ('amm' as const) : ('dex' as const)

  if (direction === 'buy') {
    const output = (amount / source.price) * slip
    return {
      source: src,
      price: source.price,
      inputAmount: amount,
      outputAmount: output,
      tradingFeeBps: amm?.tradingFee ?? 0,
      pool: {
        xrp: source.xrpPool,
        token: source.tokenPool,
        type: src,
      },
    }
  }

  const output = amount * source.price * slip
  return {
    source: src,
    price: source.price,
    inputAmount: amount,
    outputAmount: output,
    tradingFeeBps: amm?.tradingFee ?? 0,
    pool: {
      xrp: source.xrpPool,
      token: source.tokenPool,
      type: src,
    },
  }
}

export async function getUsdcMarket(
  networkKey: NetworkKey,
  token: UsdcTokenRef,
  address?: string,
) {
  const cfg = serverNetworkConfig(networkKey)
  const amm = await ammQuote(networkKey, token.currency, token.issuer)
  const dex = amm ? null : await dexQuote(networkKey, token.currency, token.issuer)
  const market = amm ?? dex

  let userBalance: { balance: number; limit: number } | null = null
  if (address && token.issuer) {
    try {
      const r = await serverRpcCall<{
        lines?: Array<{ currency: string; account: string; balance: string; limit: string }>
      }>(networkKey, 'account_lines', {
        account: address,
        ledger_index: 'validated',
      })
      const line = (r?.lines ?? []).find(
        (l) => l.currency === token.currency && l.account === token.issuer,
      )
      if (line) {
        userBalance = { balance: parseFloat(line.balance), limit: parseFloat(line.limit) }
      }
    } catch { /* ignore */ }
  }

  return {
    network: networkKey,
    networkId: cfg.networkId,
    token: {
      symbol: 'USDC',
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