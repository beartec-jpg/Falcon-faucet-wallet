import type { MeshHead } from '@/lib/scan-types'

export function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

export function str(v: unknown, fallback = ''): string {
  return v == null ? fallback : String(v)
}

/**
 * One mesh head from a PL `status_req` body.
 * Height, peers, and commit are derived together so explorer / status / pl2300 match.
 */
export function meshHeadFromStatus(st: Record<string, unknown>): MeshHead {
  const height = num(st.tip_height)
  const online = Array.isArray(st.online_seats)
    ? (st.online_seats as unknown[]).map((x) => String(x))
    : []
  const peersRaw = num(st.peers, Number.NaN)
  const peers = Number.isFinite(peersRaw) ? peersRaw : online.length
  const commit_need = num(st.commit_need, 4)
  const committee_size = num(st.committee_size, 6)
  return {
    height,
    peers,
    commit: `${commit_need}-of-${committee_size}`,
    commit_need,
    committee_size,
    product_version: str(st.product_version),
    online_seats: online,
    server_state: online.length >= 4 ? 'live' : 'degraded',
  }
}
