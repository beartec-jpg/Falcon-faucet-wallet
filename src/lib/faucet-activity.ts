// Faucet claims as a tracker source (Neon `faucet_claims`, written by /api/faucet).
// The hashed IP is used ONLY to group linked accounts for scoring. It never
// leaves the server: no API response, page or CSV includes it.

import { getSql, isDbConfigured } from '@/lib/db'

export interface FaucetDay {
  account: string
  day: string
  claims: number
}

export interface FaucetLink {
  account: string
  /** Internal only. */
  ip_hash: string
}

export interface FaucetSource {
  days(sinceDay: string): Promise<FaucetDay[]>
  links(sinceDay: string): Promise<FaucetLink[]>
}

type Row = Record<string, unknown>

export function pgFaucetSource(): FaucetSource {
  return {
    async days(since) {
      if (!isDbConfigured()) return []
      try {
        const rows = (await getSql()`SELECT address, day_utc::text AS day, count(*)::int AS n FROM faucet_claims
          WHERE network = 'testnet' AND day_utc >= ${since}::date GROUP BY address, day_utc`) as Row[]
        return rows.map((r) => ({ account: String(r.address), day: String(r.day), claims: Number(r.n) }))
      } catch (e) {
        console.error('[tracker] faucet_claims days', e)
        return []
      }
    },
    async links(since) {
      if (!isDbConfigured()) return []
      try {
        const rows = (await getSql()`SELECT DISTINCT address, ip_hash FROM faucet_claims
          WHERE network = 'testnet' AND ip_hash IS NOT NULL AND ip_hash <> '' AND day_utc >= ${since}::date`) as Row[]
        return rows.map((r) => ({ account: String(r.address), ip_hash: String(r.ip_hash) }))
      } catch (e) {
        console.error('[tracker] faucet_claims links', e)
        return []
      }
    },
  }
}

export function memoryFaucetSource(days: FaucetDay[] = [], links: FaucetLink[] = []): FaucetSource {
  return {
    async days(since) {
      return days.filter((d) => d.day >= since)
    },
    async links() {
      return links
    },
  }
}
