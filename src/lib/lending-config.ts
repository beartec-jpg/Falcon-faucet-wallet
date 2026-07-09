/** Testnet lending manifest — vault + loan broker IDs (public/config/lending.json). */

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

/** Server-side: read manifest from public folder. */
export async function loadLendingManifestServer(): Promise<LendingManifest | null> {
  try {
    const fs = await import('fs/promises')
    const path = await import('path')
    const file = path.join(process.cwd(), 'public', 'config', 'lending.json')
    const raw = await fs.readFile(file, 'utf8')
    const data = JSON.parse(raw) as LendingManifest
    if (!data.vault_id || !data.loan_broker_id) return null
    return data
  } catch {
    return null
  }
}