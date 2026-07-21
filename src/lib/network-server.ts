/**
 * Server-side network resolution (RPC URLs, faucet credentials).
 * Never expose faucet secrets to the client.
 */

import { DEFAULT_RPC_URL } from '@/lib/rpc'
import {
  getNetwork,
  isNetworkKey,
  type NetworkConfig,
  type NetworkKey,
} from '@/lib/networks'

export interface FaucetCredentials {
  account: string
  secret: string
  dripAmountQxrp: number
}

function rpcFromEnv(prefix: string, fallbacks: string[]): string {
  const direct = process.env[`${prefix}_RPC_URL`]?.trim()
  if (direct) return direct
  for (const fb of fallbacks) {
    const v = process.env[fb]?.trim()
    if (v) return v
  }
  return DEFAULT_RPC_URL
}

export function resolveNetworkKey(
  value: string | null | undefined,
  fallback: NetworkKey = 'testnet',
): NetworkKey {
  return isNetworkKey(value) ? value : fallback
}

function isUsableRpcUrl(url: string): boolean {
  const t = url.trim()
  return !!t && !t.includes('YOUR_NODE')
}

export function serverRpcUrl(networkKey: NetworkKey): string {
  const networkRpc = getNetwork(networkKey).rpcUrl
  if (networkKey === 'mainnet') {
    const fromEnv = rpcFromEnv('MAINNET', ['XRPLD_MAINNET_RPC_URL'])
    return isUsableRpcUrl(fromEnv) ? fromEnv : networkRpc
  }
  const fromEnv = rpcFromEnv('TESTNET', ['XRPLD_RPC_URL', 'XRPLD_TESTNET_RPC_URL'])
  return isUsableRpcUrl(fromEnv) ? fromEnv : networkRpc
}

export function serverNetworkConfig(networkKey: NetworkKey): NetworkConfig {
  const base = getNetwork(networkKey)
  const rpcUrl = serverRpcUrl(networkKey)
  return { ...base, rpcUrl: rpcUrl || base.rpcUrl }
}

export function serverSignerProxy(networkKey: NetworkKey): { url: string; token?: string } | null {
  const url =
    networkKey === 'mainnet'
      ? process.env.MAINNET_SIGNER_PROXY_URL?.trim()
      : process.env.TESTNET_SIGNER_PROXY_URL?.trim() ??
        process.env.SIGNER_PROXY_URL?.trim()
  if (!url) return null
  const token =
    networkKey === 'mainnet'
      ? process.env.MAINNET_SIGNER_PROXY_TOKEN?.trim()
      : process.env.TESTNET_SIGNER_PROXY_TOKEN?.trim() ??
        process.env.SIGNER_PROXY_TOKEN?.trim()
  return { url, token }
}

export function resolveFaucet(networkKey: NetworkKey): FaucetCredentials | null {
  if (networkKey === 'mainnet') {
    const account = process.env.MAINNET_FAUCET_ACCOUNT?.trim() ?? ''
    const secret = process.env.MAINNET_FAUCET_SECRET?.trim() ?? ''
    const drip = parseFloat(process.env.MAINNET_DRIP_AMOUNT_QXRP ?? process.env.MAINNET_DRIP_QXRP ?? '100')
    if (!account || !secret) return null
    return { account, secret, dripAmountQxrp: drip }
  }

  const account =
    process.env.TESTNET_FAUCET_ACCOUNT?.trim() ??
    process.env.FAUCET_ACCOUNT?.trim() ??
    ''
  const secret =
    process.env.TESTNET_FAUCET_SECRET?.trim() ??
    process.env.FAUCET_SECRET?.trim() ??
    ''
  const drip = parseFloat(
    process.env.TESTNET_DRIP_AMOUNT_QXRP ??
      process.env.DRIP_AMOUNT_QXRP ??
      '2000',
  )
  if (!account || !secret) return null
  return { account, secret, dripAmountQxrp: drip }
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1'
const ALLOW_INSECURE_TRANSPORT = process.env.ALLOW_INSECURE_TRANSPORT === 'true'

function assertSecureRpcUrl(url: string, method: string): void {
  if (!IS_PRODUCTION || ALLOW_INSECURE_TRANSPORT) return
  if (url.startsWith('http://')) {
    // submit (and all methods in prod) must not travel plaintext when signed blobs may be involved
    throw new Error(
      `Refusing RPC ${method} over plaintext HTTP in production. Use https:// or set ALLOW_INSECURE_TRANSPORT=true on a trusted network only.`,
    )
  }
}

export async function serverRpcCall<T>(
  networkKey: NetworkKey,
  method: string,
  params: Record<string, unknown> = {},
  options?: { allowError?: boolean },
): Promise<T> {
  const url = serverRpcUrl(networkKey)
  if (!url || url.includes('YOUR_NODE')) {
    throw new Error(`RPC not configured for ${networkKey}`)
  }

  // Always enforce TLS for submit; also block other methods in production over http.
  if (method === 'submit' || IS_PRODUCTION) {
    assertSecureRpcUrl(url, method)
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params: [params] }),
    cache: 'no-store',
  })

  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`)
  const body = await res.json()
  if (body.result?.error) {
    if (options?.allowError) return body.result as T
    throw new Error(body.result.error_message ?? body.result.error)
  }
  return body.result as T
}