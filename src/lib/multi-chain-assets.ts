/**
 * Wallet asset catalogs.
 * Falcon wallet = FALCON + Falcon IOUs (F-USDC).
 * Multi-chain = FETH / FBTC / FBNB (and future wraps).
 * Rows use Send + Receive + Bridge (Bridge opens unified bridge UI).
 */

export type MultiChainAssetId = 'falcon' | 'fusdc' | 'feth' | 'fbtc' | 'fbnb'

export type MultiChainAssetStatus = 'live' | 'coming_soon'

export interface MultiChainAssetDef {
  id: MultiChainAssetId
  symbol: string
  subtitle: string
  status: MultiChainAssetStatus
  canSendFalcon: boolean
  canReceiveFalcon: boolean
  /** Opens Bridge panel (lock-mint). Native FALCON has no bridge. */
  canBridge: boolean
  isNative?: boolean
  currency?: string
  sourceChainLabel?: string
}

/** Assets on the Falcon Ledger wallet (r…). */
export const FALCON_WALLET_ASSETS: MultiChainAssetDef[] = [
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
    subtitle: 'USDC locked on Sepolia → F-USDC on Falcon',
    status: 'live',
    canSendFalcon: true,
    canReceiveFalcon: true,
    canBridge: true,
    currency: 'QUC',
    sourceChainLabel: 'Ethereum Sepolia',
  },
]

/** Multi-chain / external wrapped assets. */
export const MULTI_CHAIN_ASSETS: MultiChainAssetDef[] = [
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

export const ALL_WALLET_ASSETS = [...FALCON_WALLET_ASSETS, ...MULTI_CHAIN_ASSETS]

export function multiChainAssetById(id: MultiChainAssetId): MultiChainAssetDef | undefined {
  return ALL_WALLET_ASSETS.find((a) => a.id === id)
}
