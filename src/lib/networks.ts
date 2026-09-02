/**
 * Falcon PL network registry — pre-public beta 2300 + mainnet (later).
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
  /** Faucet drip in FPL (legacy JSON alias: dripAmountQxrp). */
  dripAmountFpl: number
  /** @deprecated Prefer dripAmountFpl — kept for live clients. */
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

/** First defined finite number among env names (FPL preferred, then legacy QXRP). */
export function envNumberFirst(names: readonly string[], fallback: number): number {
  for (const name of names) {
    const v = process.env[name]
    if (v == null || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

/** Public testnet is Falcon PL 2300. Retired 1001 / 2200 env pins must not win. */
function envTestnetNetworkId(): number {
  const n = envInt('NEXT_PUBLIC_TESTNET_NETWORK_ID', 2300)
  if (n === 1001 || n === 2200) return 2300
  return n
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

const TESTNET_DRIP_FPL = envNumberFirst(
  [
    'NEXT_PUBLIC_TESTNET_DRIP_FPL',
    'NEXT_PUBLIC_DRIP_AMOUNT_FPL',
    'NEXT_PUBLIC_TESTNET_DRIP_QXRP',
    'NEXT_PUBLIC_DRIP_AMOUNT_QXRP',
  ],
  2000,
)

const TESTNET: NetworkConfig = {
  key: 'testnet',
  name: envStr('NEXT_PUBLIC_TESTNET_NAME', 'Falcon PL 2300'),
  shortName: 'Testnet',
  networkId: envTestnetNetworkId(),
  rpcUrl: envStr(
    'NEXT_PUBLIC_TESTNET_RPC_URL',
    envStr('NEXT_PUBLIC_RPC_URL', '192.241.247.158:19311'),
  ),
  dripAmountFpl: TESTNET_DRIP_FPL,
  dripAmountQxrp: TESTNET_DRIP_FPL,
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

const MAINNET_DRIP_FPL = envNumberFirst(
  ['NEXT_PUBLIC_MAINNET_DRIP_FPL', 'NEXT_PUBLIC_MAINNET_DRIP_QXRP'],
  100,
)

const MAINNET: NetworkConfig = {
  key: 'mainnet',
  name: envStr('NEXT_PUBLIC_MAINNET_NAME', 'Falcon PL'),
  shortName: 'Mainnet',
  networkId: envInt('NEXT_PUBLIC_MAINNET_NETWORK_ID', 1),
  rpcUrl: envStr('NEXT_PUBLIC_MAINNET_RPC_URL', ''),
  dripAmountFpl: MAINNET_DRIP_FPL,
  dripAmountQxrp: MAINNET_DRIP_FPL,
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
export const MAINNET_FAUCET_BOOTSTRAP_FPL = envNumberFirst(
  ['MAINNET_FAUCET_BOOTSTRAP_FPL', 'MAINNET_FAUCET_BOOTSTRAP_QXRP'],
  25_000_000,
)
/** @deprecated Prefer MAINNET_FAUCET_BOOTSTRAP_FPL */
export const MAINNET_FAUCET_BOOTSTRAP_QXRP = MAINNET_FAUCET_BOOTSTRAP_FPL