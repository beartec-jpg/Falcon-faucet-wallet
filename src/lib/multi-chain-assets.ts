/**
 * Wallet catalogs:
 * - Falcon Wallet = native FPL + Falcon IOUs (F-USDC, FETH, FBTC, FBNB)
 * - Multi-chain = native deposit rows (ETH, USDC, BTC, BNB, classic XRP)
 *   USDC is its own row (Ethereum USDC), not nested under ETH.
 *   XRP is today’s XRPL (secp/ed25519) — separate r… from Falcon-512.
 */

export type FalconAssetId = 'falcon' | 'fusdc' | 'feth' | 'fbtc' | 'fbnb'
export type NativeChainId = 'eth' | 'btc' | 'bnb' | 'xrp'
/** Multi-chain tab display rows (USDC separate from ETH; XRP = classic XRPL). */
export type MultiChainRowId = 'eth' | 'usdc' | 'btc' | 'bnb' | 'xrp'

export type MultiChainAssetId = FalconAssetId | NativeChainId | 'usdc'
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

/** Falcon PL balances (r…). */
export const FALCON_WALLET_ASSETS: FalconAssetDef[] = [
  {
    id: 'falcon',
    symbol: 'FPL',
    subtitle: 'Native · Falcon PL',
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
    subtitle: 'Bridged ETH on Falcon (via Bridge ← wrap ETH → lock WETH)',
    status: 'live',
    canSend: true,
    canReceive: true,
    canBridge: true,
    currency: 'ETH',
  },
  {
    id: 'fbtc',
    symbol: 'FBTC',
    subtitle: 'Bridged BTC on Falcon (SPV light client · multi-chain BTC → FBTC)',
    status: 'live',
    canSend: true,
    canReceive: true,
    canBridge: true,
    currency: 'BTC',
  },
  {
    id: 'fbnb',
    symbol: 'FBNB',
    subtitle: 'Bridged BNB on Falcon (via Bridge ← wrap BNB → lock WBNB on BSC testnet)',
    status: 'live',
    canSend: true,
    canReceive: true,
    canBridge: true,
    currency: 'BNB',
  },
]

export interface NativeChainWalletDef {
  id: MultiChainRowId
  symbol: string
  chainLabel: string
  subtitle: string
  status: MultiChainAssetStatus
  /** Same secp256k1 key as ETH for BNB / USDC (BIP-44 coin 60). */
  sharesEthKey?: boolean
  /** Native gas asset on that address (ETH/BNB/BTC). USDC is an ERC-20 on ETH. */
  isToken?: boolean
  canSend: boolean
  canReceive: boolean
  canBridge: boolean
}

/**
 * Multi-chain tab = one row per asset users care about.
 * USDC is separate from ETH (same 0x deposit address, own balance + bridge path).
 */
export const NATIVE_CHAIN_WALLETS: NativeChainWalletDef[] = [
  {
    id: 'eth',
    symbol: 'ETH',
    chainLabel: 'Ethereum',
    subtitle: 'Native ETH · gas & deposit · Bridge → FETH',
    status: 'live',
    canSend: true,
    canReceive: true,
    canBridge: true,
  },
  {
    id: 'usdc',
    symbol: 'USDC',
    chainLabel: 'Ethereum',
    subtitle: 'USDC on Ethereum · same 0x as ETH · Bridge → F-USDC',
    status: 'live',
    sharesEthKey: true,
    isToken: true,
    canSend: true,
    canReceive: true,
    canBridge: true,
  },
  {
    id: 'btc',
    symbol: 'BTC',
    chainLabel: 'Bitcoin',
    subtitle: 'Native BTC · testnet P2PKH · SPV Bridge → FBTC',
    status: 'live',
    canSend: true,
    canReceive: true,
    canBridge: true,
  },
  {
    id: 'bnb',
    symbol: 'BNB',
    chainLabel: 'BNB Smart Chain',
    subtitle: 'Same 0x as ETH · BSC testnet · Bridge → FBNB',
    status: 'live',
    sharesEthKey: true,
    canSend: true,
    canReceive: true,
    canBridge: true,
  },
  {
    id: 'xrp',
    symbol: 'XRP',
    chainLabel: 'XRP Ledger (classic)',
    subtitle: 'Today’s XRPL · own r… · Bridge In → FXRP on Falcon',
    status: 'live',
    canSend: true,
    canReceive: true,
    canBridge: true,
  },
]

/** @deprecated — multi-chain is native chains, not F-tokens */
export const MULTI_CHAIN_ASSETS = NATIVE_CHAIN_WALLETS

export type MultiChainAssetDef = FalconAssetDef | NativeChainWalletDef

export function falconAssetById(id: FalconAssetId): FalconAssetDef | undefined {
  return FALCON_WALLET_ASSETS.find((a) => a.id === id)
}

export function nativeChainById(id: MultiChainRowId): NativeChainWalletDef | undefined {
  return NATIVE_CHAIN_WALLETS.find((a) => a.id === id)
}

export function multiChainAssetById(id: MultiChainAssetId): MultiChainAssetDef | undefined {
  return (
    FALCON_WALLET_ASSETS.find((a) => a.id === id) ||
    NATIVE_CHAIN_WALLETS.find((a) => a.id === id)
  )
}
