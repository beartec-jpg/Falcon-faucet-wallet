/** Testnet lending manifest — vault + loan broker IDs (public/config/lending.json). */

import lendingManifestJson from '../../public/config/lending.json'

export interface LendingManifest {
  network_id: number
  rpc_url: string
  issued_at?: string
  asset: {
    symbol: string
    currency: string
    issuer: string
  }
  broker_owner: string
  vault_id: string
  loan_broker_id: string
  interest_rate_tenth_bps: number
  /** 7-day PoPL epoch length in seconds (default 604800). */
  epoch_duration_seconds?: number
  epochs_per_year?: number
  default_loan_epochs?: number
  payment_interval: number
  payment_total: number
  grace_period: number
}

let cached: LendingManifest | null = null

export async function loadLendingManifest(): Promise<LendingManifest | null> {
  if (cached) return cached
  try {
    const res = await fetch('/config/lending.json', { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as LendingManifest
    if (!data.vault_id || !data.loan_broker_id || !data.broker_owner) return null
    cached = data
    return data
  } catch {
    return null
  }
}

/** Server-side: bundled at build time (Vercel serverless has no public/ on disk). */
export async function loadLendingManifestServer(): Promise<LendingManifest | null> {
  const data = lendingManifestJson as LendingManifest
  if (!data.vault_id || !data.loan_broker_id) return null
  return data
}