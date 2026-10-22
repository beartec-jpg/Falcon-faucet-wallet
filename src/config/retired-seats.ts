/**
 * Seats that are retired but cannot be deregistered on chain (they stay in
 * status.validators, usually jailed). Hidden from /network/health: table,
 * KPIs and alerts. Extra ids can be added without a code change via the
 * comma-separated env RETIRED_SEATS (server side).
 */
export const RETIRED_SEATS: readonly string[] = ['v2', 'v4', 'v5', 'v7', 'v8', 'v9']

export function retiredSeats(env: string | undefined = typeof process !== 'undefined' ? process.env.RETIRED_SEATS : undefined): Set<string> {
  const extra = (env ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return new Set([...RETIRED_SEATS, ...extra])
}
