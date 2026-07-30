/** Shared wallet UI helpers — token colours, totals, filters */

import type { FalconAssetId } from '@/lib/multi-chain-assets'
import type { MultiChainRowId } from '@/lib/wallet-row-visibility'

export const TOKEN_CHIP: Record<string, string> = {
  falcon: 'from-brand-400 to-brand-600 text-slate-950',
  fusdc: 'from-sky-400 to-blue-600 text-white',
  feth: 'from-violet-400 to-indigo-600 text-white',
  fbtc: 'from-orange-400 to-amber-600 text-slate-950',
  fbnb: 'from-yellow-300 to-amber-500 text-slate-950',
  eth: 'from-violet-400 to-indigo-600 text-white',
  usdc: 'from-sky-400 to-blue-600 text-white',
  btc: 'from-orange-400 to-amber-600 text-slate-950',
  bnb: 'from-yellow-300 to-amber-500 text-slate-950',
}

export function tokenChipClass(id: string): string {
  return TOKEN_CHIP[id] ?? 'from-slate-500 to-slate-700 text-white'
}

export function shortTokenLabel(id: string): string {
  const map: Record<string, string> = {
    falcon: 'F',
    fusdc: 'U',
    feth: 'E',
    fbtc: '₿',
    fbnb: 'B',
    eth: 'E',
    usdc: 'U',
    btc: '₿',
    bnb: 'B',
  }
  return map[id] ?? '?'
}

export type FalconBalances = {
  falcon: number
  fusdc: number
  feth: number
  fbtc: number
  fbnb: number
}

export function parseFalconBalances(account: {
  balance: number
  assets?: {
    fusdc?: { balance: number }
    tokens?: Array<{ currency: string; symbol: string; balance: number }>
  }
} | null): FalconBalances {
  const tokens = account?.assets?.tokens ?? []
  const find = (currency: string, symbol: string) =>
    tokens.find((t) => t.currency === currency || t.symbol === symbol)?.balance ?? 0
  return {
    falcon: account?.balance ?? 0,
    fusdc: account?.assets?.fusdc?.balance ?? 0,
    feth: find('ETH', 'FETH'),
    fbtc: find('BTC', 'FBTC'),
    fbnb: find('BNB', 'FBNB'),
  }
}

export function falconRowBalance(id: FalconAssetId, b: FalconBalances): number {
  return b[id] ?? 0
}

export function multiRowBalance(
  id: MultiChainRowId,
  vals: { eth: number | null; usdc: number | null; btc: number | null; bnb: number | null },
): number | null {
  if (id === 'eth') return vals.eth
  if (id === 'usdc') return vals.usdc
  if (id === 'btc') return vals.btc
  return vals.bnb
}
