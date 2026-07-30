/**
 * Per-wallet-tab asset row visibility (localStorage).
 * Falcon tab: FALCON / F-USDC / FETH / FBTC / FBNB
 * Multi-chain tab: ETH / USDC / BTC / BNB (USDC is its own row)
 */

import type { FalconAssetId } from '@/lib/multi-chain-assets'

export type MultiChainRowId = 'eth' | 'usdc' | 'btc' | 'bnb'

const FALCON_KEY = 'falcon-wallet-visible-falcon-v1'
const MULTI_KEY = 'falcon-wallet-visible-multi-v1'

export const FALCON_ROW_IDS: FalconAssetId[] = ['falcon', 'fusdc', 'feth', 'fbtc', 'fbnb']
export const MULTI_ROW_IDS: MultiChainRowId[] = ['eth', 'usdc', 'btc', 'bnb']

export const FALCON_ROW_LABELS: Record<FalconAssetId, string> = {
  falcon: 'FALCON',
  fusdc: 'F-USDC',
  feth: 'FETH',
  fbtc: 'FBTC',
  fbnb: 'FBNB',
}

export const MULTI_ROW_LABELS: Record<MultiChainRowId, string> = {
  eth: 'ETH',
  usdc: 'USDC',
  btc: 'BTC',
  bnb: 'BNB',
}

function defaultMap<T extends string>(ids: readonly T[]): Record<T, boolean> {
  return Object.fromEntries(ids.map((id) => [id, true])) as Record<T, boolean>
}

function loadMap<T extends string>(
  key: string,
  ids: readonly T[],
): Record<T, boolean> {
  const base = defaultMap(ids)
  if (typeof window === 'undefined') return base
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return base
    const parsed = JSON.parse(raw) as Partial<Record<T, boolean>>
    for (const id of ids) {
      if (typeof parsed[id] === 'boolean') base[id] = parsed[id]!
    }
  } catch {
    /* ignore */
  }
  return base
}

function saveMap<T extends string>(key: string, map: Record<T, boolean>) {
  try {
    localStorage.setItem(key, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

export function loadFalconVisibility(): Record<FalconAssetId, boolean> {
  return loadMap(FALCON_KEY, FALCON_ROW_IDS)
}

export function saveFalconVisibility(map: Record<FalconAssetId, boolean>) {
  saveMap(FALCON_KEY, map)
}

export function loadMultiVisibility(): Record<MultiChainRowId, boolean> {
  return loadMap(MULTI_KEY, MULTI_ROW_IDS)
}

export function saveMultiVisibility(map: Record<MultiChainRowId, boolean>) {
  saveMap(MULTI_KEY, map)
}
