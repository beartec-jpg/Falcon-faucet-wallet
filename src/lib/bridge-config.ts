/**
 * Sepolia USDC → Falcon USDC bridge configuration.
 * Deposits use an external EVM wallet — Falcon wallet only needs the Falcon address.
 */

export interface SepoliaBridgeConfig {
  chain_id: number
  chain_name: string
  rpc_url: string
  explorer_url: string
  usdc_token: string
  lock_contract: string
  usdc_decimals: number
  /** Sepolia WETH (canonical) for FETH bridge-in */
  weth_token?: string
  /** Separate FalconCollateralLock deployed with WETH as collateral token */
  weth_lock_contract?: string
  weth_decimals?: number
  /**
   * How many blocks back the WithdrawalReleased watcher scans from the chain tip.
   * Optional; when omitted a chain-appropriate default is used (deeper on mainnet
   * for reorg safety). Env-overridable server-side via RELEASE_LOOKBACK_BLOCKS.
   */
  release_lookback_blocks?: number
}

export interface FalconBridgeToken {
  network_id: number
  rpc_url?: string
  token_symbol: string
  token_currency: string
  token_issuer: string
}

export interface FethBridgeMeta {
  token_symbol: string
  token_currency: string
  token_issuer: string
  status?: string
}

export interface BscBridgeConfig {
  chain_id: number
  chain_name: string
  rpc_url: string
  explorer_url: string
  wbnb_token: string
  lock_contract: string | null
  wbnb_decimals: number
}

export interface FbnbBridgeMeta {
  token_symbol: string
  token_currency: string
  token_issuer: string
  status?: string
}

export interface UsdcBridgeManifest {
  version: number
  status: string
  description: string
  sepolia: SepoliaBridgeConfig
  bsc_testnet?: BscBridgeConfig
  falcon: FalconBridgeToken
  feth?: FethBridgeMeta
  fbnb?: FbnbBridgeMeta
  deposit_flow: {
    type: string
    steps: string[]
    note: string
  }
  withdraw_flow?: {
    memo_type: string
    relay_script: string
    note: string
  }
}

export function fethLockReady(cfg: UsdcBridgeManifest | null): boolean {
  return !!(
    cfg?.sepolia?.weth_lock_contract?.match(/^0x[a-fA-F0-9]{40}$/) &&
    cfg?.sepolia?.weth_token?.match(/^0x[a-fA-F0-9]{40}$/) &&
    cfg?.feth?.token_issuer?.match(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/)
  )
}

export function fbnbLockReady(cfg: UsdcBridgeManifest | null): boolean {
  return !!(
    cfg?.bsc_testnet?.lock_contract?.match(/^0x[a-fA-F0-9]{40}$/) &&
    cfg?.bsc_testnet?.wbnb_token?.match(/^0x[a-fA-F0-9]{40}$/) &&
    cfg?.fbnb?.token_issuer?.match(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/)
  )
}

let cached: UsdcBridgeManifest | null = null

export async function fetchBridgeConfig(): Promise<UsdcBridgeManifest | null> {
  if (cached) return cached
  try {
    const res = await fetch('/config/usdc-bridge.json', { cache: 'no-store' })
    if (!res.ok) return null
    cached = (await res.json()) as UsdcBridgeManifest
    return cached
  } catch {
    return null
  }
}

/** ABI fragments used by the in-app Sepolia bridge */
export const DEPOSIT_ABI = [
  'function deposit(uint256 amount, string falconAccount) external returns (bytes32 depositId)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'event DepositCreated(bytes32 indexed depositId, address indexed sender, uint256 amount, string falconAccount)',
] as const

export function lockContractReady(cfg: UsdcBridgeManifest | null): boolean {
  return !!cfg?.sepolia?.lock_contract?.match(/^0x[a-fA-F0-9]{40}$/)
}

export function etherscanAddressUrl(explorer: string, address: string): string {
  return `${explorer.replace(/\/$/, '')}/address/${address}`
}

export function etherscanTokenUrl(explorer: string, token: string): string {
  return `${explorer.replace(/\/$/, '')}/token/${token}`
}