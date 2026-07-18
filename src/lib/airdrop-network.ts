/**
 * Airdrop scoring is mainnet-only.
 * Testnet faucet/validators/LP must never write into airdrop allocations or snapshots
 * that could be paid in mainnet FALCON.
 */

import type { NetworkKey } from '@/lib/networks'

export const AIRDROP_SCORING_NETWORK = 'mainnet' as const

export type AirdropScoringNetwork = typeof AIRDROP_SCORING_NETWORK

export function isAirdropScoringNetwork(
  raw: string | null | undefined,
): raw is AirdropScoringNetwork {
  return (raw ?? '').toLowerCase() === AIRDROP_SCORING_NETWORK
}

/**
 * Resolve and enforce mainnet for snapshot / freeze / recompute.
 * Rejects testnet and unknown values explicitly (no silent fallback to testnet).
 */
export function requireAirdropScoringNetwork(
  ...candidates: Array<string | null | undefined>
): { ok: true; network: AirdropScoringNetwork; networkKey: NetworkKey } | { ok: false; error: string } {
  const raw = candidates.find((c) => c != null && String(c).trim() !== '')
  const n = (raw ?? AIRDROP_SCORING_NETWORK).toString().trim().toLowerCase()

  if (n === 'testnet') {
    return {
      ok: false,
      error:
        'Airdrop scoring refuses testnet. Only mainnet activity (post-genesis) counts toward mainnet FALCON airdrop. Use network=mainnet.',
    }
  }
  if (n !== 'mainnet') {
    return {
      ok: false,
      error: `Invalid airdrop network "${raw}". Only mainnet is allowed for scoring/snapshots.`,
    }
  }
  return {
    ok: true,
    network: AIRDROP_SCORING_NETWORK,
    networkKey: 'mainnet',
  }
}
