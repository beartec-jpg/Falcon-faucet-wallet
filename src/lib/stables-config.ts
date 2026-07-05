/**
 * Runtime stablecoin issuer config — env vars override fetched manifest.
 */

import { getNetwork, type NetworkConfig, type NetworkKey } from './networks'

export interface StablesManifest {
  network_id?: number
  rpc_url?: string
  tokens?: Array<{
    symbol: string
    currency: string
    issuer: string
    liquidity?: string
  }>
  env?: Record<string, string>
}

let cachedManifest: StablesManifest | null = null
let fetchPromise: Promise<StablesManifest | null> | null = null

export async function fetchStablesManifest(): Promise<StablesManifest | null> {
  if (cachedManifest) return cachedManifest
  if (fetchPromise) return fetchPromise
  fetchPromise = (async () => {
    try {
      const res = await fetch('/config/testnet-stables.json', { cache: 'no-store' })
      if (!res.ok) return null
      cachedManifest = (await res.json()) as StablesManifest
      return cachedManifest
    } catch {
      return null
    }
  })()
  return fetchPromise
}

/** Merge env-based network tokens with on-chain manifest issuers when env is empty. */
export async function resolveNetworkTokens(networkKey: NetworkKey): Promise<NetworkConfig['tokens']> {
  const base = getNetwork(networkKey).tokens
  if (networkKey !== 'testnet') return base
  if (base.every((t) => t.issuer)) return base

  const manifest = await fetchStablesManifest()
  if (!manifest?.tokens?.length) return base

  return base.map((tok) => {
    const fromManifest = manifest.tokens!.find(
      (m) => m.symbol === tok.symbol || m.currency === tok.currency,
    )
    if (!tok.issuer && fromManifest?.issuer) {
      return { ...tok, issuer: fromManifest.issuer, currency: fromManifest.currency || tok.currency }
    }
    return tok
  })
}