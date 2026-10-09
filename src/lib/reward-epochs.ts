import type { NetworkKey } from '@/lib/networks'

/**
 * First claimable reward epoch, shared by the rewards page and
 * /api/rewards/overview. Testnet: Falcon-PL `pl-start-public-2300.sh`
 * FIRST_CLAIM=1. Mainnet: `economy.rs` FIRST_CLAIM_EPOCH = 8 (epochs 1–7 are
 * bootstrap).
 */
export function firstClaimEpoch(networkKey: NetworkKey): number {
  return networkKey === 'mainnet' ? 8 : 1
}
