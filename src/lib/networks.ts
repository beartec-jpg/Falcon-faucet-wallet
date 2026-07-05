/**
 * Falcon Ledger network registry — testnet + mainnet (pre-launch).
 *
 * Launch decisions still required (see .env.example MAINNET LAUNCH section):
 *   - MAINNET_NETWORK_ID (must differ from 1001)
 *   - MAINNET_RPC_URL + genesis validator endpoints
 *   - MAINNET_FAUCET_* funded from genesis circulating tranche
 *   - Mainnet stablecoin issuers after genesis issue script
 */

export type NetworkKey = 'testnet' | 'mainnet'

export interface NetworkToken {
  symbol: string
  currency: string
  issuer: string
}

export interface NetworkConfig {
  key: NetworkKey
  /** Header / UI label */
  name: string
  shortName: string
  networkId: number
  /** Public RPC (browser may read; server uses env override) */
  rpcUrl: string
  dripAmountQxrp: number
  explorerUrl: string
  tokens: NetworkToken[]
  /** false = show in switcher but faucet/send disabled until go-live */
  live: boolean
  badge: 'testnet' | 'mainnet'
  /** Shown when network is not yet live */
  comingSoonMessage?: string
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name]
  if (!v) return fallback
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

function envStr(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback
}

/** Whether signed txs must include NetworkID (custom networks > 1024). */
export function txRequiresNetworkId(networkId: number): boolean {
  return networkId > 1024
}

export function networkIdForTx(networkId: number): number | undefined {
  return txRequiresNetworkId(networkId) ? networkId : undefined
}

const TESTNET: NetworkConfig = {
  key: 'testnet',
  name: envStr('NEXT_PUBLIC_TESTNET_NAME', 'Falcon Ledger Testnet'),
  shortName: 'Testnet',
  networkId: envInt('NEXT_PUBLIC_TESTNET_NETWORK_ID', 1001),
  rpcUrl: envStr(
    'NEXT_PUBLIC_TESTNET_RPC_URL',
    envStr('NEXT_PUBLIC_RPC_URL', 'http://46.224.0.140:6005'),
  ),
  dripAmountQxrp: envInt('NEXT_PUBLIC_TESTNET_DRIP_QXRP', envInt('NEXT_PUBLIC_DRIP_AMOUNT_QXRP', 2000)),
  explorerUrl: envStr('NEXT_PUBLIC_TESTNET_EXPLORER_URL', envStr('NEXT_PUBLIC_EXPLORER_URL', '')),
  tokens: [
    {
      symbol: 'F-USDC',
      currency: envStr('NEXT_PUBLIC_TESTNET_USDC_CURRENCY', envStr('NEXT_PUBLIC_QUSDC_CURRENCY', 'QUC')),
      issuer: envStr('NEXT_PUBLIC_TESTNET_USDC_ISSUER', envStr('NEXT_PUBLIC_QUSDC_ISSUER', '')),
    },
  ],
  live: true,
  badge: 'testnet',
}

const MAINNET: NetworkConfig = {
  key: 'mainnet',
  name: envStr('NEXT_PUBLIC_MAINNET_NAME', 'Falcon Ledger'),
  shortName: 'Mainnet',
  networkId: envInt('NEXT_PUBLIC_MAINNET_NETWORK_ID', 1),
  rpcUrl: envStr('NEXT_PUBLIC_MAINNET_RPC_URL', ''),
  dripAmountQxrp: envInt('NEXT_PUBLIC_MAINNET_DRIP_QXRP', 100),
  explorerUrl: envStr('NEXT_PUBLIC_MAINNET_EXPLORER_URL', ''),
  tokens: [
    {
      symbol: 'USDC',
      currency: envStr('NEXT_PUBLIC_MAINNET_USDC_CURRENCY', 'USC'),
      issuer: envStr('NEXT_PUBLIC_MAINNET_USDC_ISSUER', ''),
    },
  ],
  live: envStr('NEXT_PUBLIC_MAINNET_LIVE', 'false') === 'true',
  badge: 'mainnet',
  comingSoonMessage: envStr(
    'NEXT_PUBLIC_MAINNET_COMING_SOON',
    'Mainnet launches soon. Use Testnet to try the wallet.',
  ),
}

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  testnet: TESTNET,
  mainnet: MAINNET,
}

export const DEFAULT_NETWORK_KEY: NetworkKey = 'testnet'

export function isNetworkKey(v: string | null | undefined): v is NetworkKey {
  return v === 'testnet' || v === 'mainnet'
}

export function getNetwork(key: string | null | undefined): NetworkConfig {
  return isNetworkKey(key) ? NETWORKS[key] : NETWORKS[DEFAULT_NETWORK_KEY]
}

/** Genesis bootstrap: recommended mainnet faucet seed from circulating allocation (2% = 4B total). */
export const MAINNET_FAUCET_BOOTSTRAP_QXRP = envInt('MAINNET_FAUCET_BOOTSTRAP_QXRP', 25_000_000)