/**
 * Wallet catalogs:
 * - Falcon Wallet = native FALCON + Falcon IOUs (F-USDC, later FETH/FBTC/FBNB)
 * - Multi-chain = native deposit wallets (ETH, BTC, BNB) that feed Bridge
 */

export type FalconAssetId = 'falcon' | 'fusdc' | 'feth' | 'fbtc' | 'fbnb'
export type NativeChainId = 'eth' | 'btc' | 'bnb'

export type MultiChainAssetId = FalconAssetId | NativeChainId

export type MultiChainAssetStatus = 'live' | 'coming_soon'

export interface FalconAssetDef {
  id: FalconAssetId
  symbol: string
  subtitle: string
  status: MultiChainAssetStatus
  canSend: boolean
  canReceive: boolean
  canBridge: boolean
  isNative?: boolean
  currency?: string
}

/** Falcon Ledger balances (r…). */
export const FALCON_WALLET_ASSETS: FalconAssetDef[] = [
  {
    id: 'falcon',
    symbol: 'FALCON',
    subtitle: 'Native · Falcon Ledger',
    status: 'live',
    canSend: true,
    canReceive: true,
    canBridge: false,
    isNative: true,
  },
  {
    id: 'fusdc',
    symbol: 'F-USDC',
    subtitle: 'Bridged USDC on Falcon (via Bridge ← ETH wallet)',
    status: 'live',
    canSend: true,
    canReceive: true,
    canBridge: true,
    currency: 'QUC',
  },
  {
    id: 'feth',
    symbol: 'FETH',
    subtitle: 'Scaffold ready · WETH lock + issuer deploy next (see bridges.json feth-sepolia)',
    status: 'coming_soon',
    canSend: false,
    canReceive: false,
    canBridge: false,
    currency: 'ETH',
  },
  {
    id: 'fbtc',
    symbol: 'FBTC',
    subtitle: 'Coming soon · wrapped BTC on Falcon',
    status: 'coming_soon',
    canSend: false,
    canReceive: false,
    canBridge: false,
  },
  {
    id: 'fbnb',
    symbol: 'FBNB',
    subtitle: 'Coming soon · wrapped BNB on Falcon',
    status: 'coming_soon',
    canSend: false,
    canReceive: false,
    canBridge: false,
  },
]

export interface NativeChainWalletDef {
  id: NativeChainId
  symbol: string
  chainLabel: string
  subtitle: string
  status: MultiChainAssetStatus
  /** Same secp256k1 key as ETH for BNB (BIP-44 coin 60). */
  sharesEthKey?: boolean
  canSend: boolean
  canReceive: boolean
  canBridge: boolean
}

/**
 * Multi-chain tab = native wallets. Bridge locks from these addresses
 * and mints F-assets onto Falcon Wallet.
 */
export const NATIVE_CHAIN_WALLETS: NativeChainWalletDef[] = [
  {
    id: 'eth',
    symbol: 'ETH',
    chainLabel: 'Ethereum',
    subtitle: 'Native ETH · deposit / gas · Bridge uses this wallet for USDC/ETH locks',
    status: 'live',
    canSend: true,
    canReceive: true,
    canBridge: true,
  },
  {
    id: 'btc',
    symbol: 'BTC',
    chainLabel: 'Bitcoin',
    subtitle: 'Native BTC · testnet P2PKH · balance + send live. Bridge → FBTC later.',
    status: 'live',
    canSend: true,
    canReceive: true,
    canBridge: false,
  },
  {
    id: 'bnb',
    symbol: 'BNB',
    chainLabel: 'BNB Smart Chain',
    subtitle: 'Same 0x as ETH · BSC balances (bridge to FBNB later)',
    status: 'live',
    sharesEthKey: true,
    canSend: true,
    canReceive: true,
    canBridge: false,
  },
]

/** @deprecated — multi-chain is native chains, not F-tokens */
export const MULTI_CHAIN_ASSETS = NATIVE_CHAIN_WALLETS

export type MultiChainAssetDef = FalconAssetDef | NativeChainWalletDef

export function falconAssetById(id: FalconAssetId): FalconAssetDef | undefined {
  return FALCON_WALLET_ASSETS.find((a) => a.id === id)
}

export function nativeChainById(id: NativeChainId): NativeChainWalletDef | undefined {
  return NATIVE_CHAIN_WALLETS.find((a) => a.id === id)
}

export function multiChainAssetById(id: MultiChainAssetId): MultiChainAssetDef | undefined {
  return (
    FALCON_WALLET_ASSETS.find((a) => a.id === id) ||
    NATIVE_CHAIN_WALLETS.find((a) => a.id === id)
  )
}
