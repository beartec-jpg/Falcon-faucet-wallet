/**
 * Multi-chain wallet catalog (Phase 1 shell).
 * Live assets use real Falcon balances; coming_soon rows are UI placeholders
 * until lock-mint configs (FETH/FBTC/FBNB) ship.
 */

export type MultiChainAssetId = 'falcon' | 'fusdc' | 'feth' | 'fbtc' | 'fbnb'

export type MultiChainAssetStatus = 'live' | 'coming_soon'

export interface MultiChainAssetDef {
  id: MultiChainAssetId
  /** Falcon-side display symbol */
  symbol: string
  /** Short subtitle under the row */
  subtitle: string
  status: MultiChainAssetStatus
  /** Can send on Falcon ledger */
  canSendFalcon: boolean
  /** Can receive on Falcon r… */
  canReceiveFalcon: boolean
  /** Bridge in/out available */
  canBridge: boolean
  /** Native Falcon (no bridge) */
  isNative?: boolean
  /** Ledger IOU currency when live (empty for native) */
  currency?: string
  /** Coming-soon source chain label */
  sourceChainLabel?: string
}

/** Order of rows on Multi-chain home */
export const MULTI_CHAIN_ASSETS: MultiChainAssetDef[] = [
  {
    id: 'falcon',
    symbol: 'FALCON',
    subtitle: 'Native · Falcon Ledger',
    status: 'live',
    canSendFalcon: true,
    canReceiveFalcon: true,
    canBridge: false,
    isNative: true,
  },
  {
    id: 'fusdc',
    symbol: 'F-USDC',
    subtitle: 'Bridged USDC · Sepolia lock → Falcon',
    status: 'live',
    canSendFalcon: true,
    canReceiveFalcon: true,
    canBridge: true,
    currency: 'QUC',
    sourceChainLabel: 'Ethereum Sepolia',
  },
  {
    id: 'feth',
    symbol: 'FETH',
    subtitle: 'Coming soon · lock WETH → Falcon',
    status: 'coming_soon',
    canSendFalcon: false,
    canReceiveFalcon: false,
    canBridge: false,
    sourceChainLabel: 'Ethereum',
  },
  {
    id: 'fbtc',
    symbol: 'FBTC',
    subtitle: 'Coming soon · lock WBTC → Falcon (v1)',
    status: 'coming_soon',
    canSendFalcon: false,
    canReceiveFalcon: false,
    canBridge: false,
    sourceChainLabel: 'Ethereum (WBTC)',
  },
  {
    id: 'fbnb',
    symbol: 'FBNB',
    subtitle: 'Coming soon · lock BNB on BSC → Falcon',
    status: 'coming_soon',
    canSendFalcon: false,
    canReceiveFalcon: false,
    canBridge: false,
    sourceChainLabel: 'BNB Smart Chain',
  },
]

export function multiChainAssetById(id: MultiChainAssetId): MultiChainAssetDef | undefined {
  return MULTI_CHAIN_ASSETS.find((a) => a.id === id)
}
