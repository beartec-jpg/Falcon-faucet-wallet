// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
//
// Amounts are always strings in base units plus a decimal string, so no client loses precision.

import { big } from '@/lib/pl-exact-json'

/** Base-unit decimals per PL asset (same table the wallet uses in pl-book.ts). */
export const ASSET_DECIMALS: Record<string, number> = { FPL: 0, BTC: 8, BTC4: 8, ETH: 18, USDC: 6 }

export function decimalsOf(asset: string): number {
  return ASSET_DECIMALS[asset.toUpperCase()] ?? 0
}

/** Exact decimal string with no grouping and no trailing zeros, e.g. "12.5". */
export function toDecimalString(raw: bigint | string | number, decimals: number): string {
  const n = big(raw)
  const neg = n < 0n
  const a = neg ? -n : n
  if (decimals === 0) return `${neg ? '-' : ''}${a}`
  const base = 10n ** BigInt(decimals)
  const frac = (a % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${neg ? '-' : ''}${a / base}${frac ? `.${frac}` : ''}`
}

export type Amount = { asset: string; raw: string; decimals: number; value: string }

export function amount(asset: string, raw: unknown): Amount {
  const d = decimalsOf(asset)
  const r = big(raw).toString()
  return { asset, raw: r, decimals: d, value: toDecimalString(r, d) }
}
