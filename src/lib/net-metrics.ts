// Pure network-metric helpers shared by the explorer UI, the network map and the
// 24h sampler cron. Everything here derives from the PL `status_req` body that
// /api/scan already exposes: cumulative counters (txs_sealed, ledgers_sealed),
// mempool, online seats and each seat's last advertised tip / pack count.

import type { ScanData } from '@/lib/scan-types'

export interface SeatSample {
  id: string
  /** Last tip this seat advertised to the mesh (0 = not advertised). */
  tip: number
  packs: number
  online: boolean
  jailed: boolean
  perf: number | null
}

export interface NetSample {
  /** Sample time, ms since epoch (client clock for the UI, server clock in cron). */
  t: number
  height: number
  txs_sealed: number
  ledgers_sealed: number
  mempool: number
  peers: number
  online: number
  last_pack_txs: number
  last_pack_packer: string
  min_fee: number
  fee_multiplier: number
  seats: SeatSample[]
}

export interface NetRates {
  /** Sealed transactions per second over the window. */
  tps: number
  /** Sealed blocks per minute over the window. */
  blocks_min: number
  /** Average transactions per sealed block over the window. */
  txs_per_block: number
  /** Window actually covered, ms. */
  span_ms: number
}

const fin = (v: unknown, d = 0): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return typeof n === 'number' && Number.isFinite(n) ? n : d
}

export function sampleFromScan(d: ScanData, t = Date.now()): NetSample {
  const online = new Set(d.online_seats ?? [])
  return {
    t,
    height: fin(d.height, fin(d.validated_ledger)),
    txs_sealed: fin(d.metrics?.txs_sealed),
    ledgers_sealed: fin(d.metrics?.ledgers_sealed, fin(d.height)),
    mempool: fin(d.mempool),
    peers: fin(d.peers),
    online: online.size,
    last_pack_txs: fin(d.last_pack?.txs),
    last_pack_packer: d.last_pack?.packer ?? '',
    min_fee: fin(d.current_fee_drops),
    fee_multiplier: fin(d.fee_multiplier, 1),
    seats: (d.validators ?? []).map((v) => ({
      id: v.account,
      tip: fin(v.ledger_index),
      packs: fin(v.pack_count),
      online: online.has(v.account),
      jailed: Boolean(v.jailed),
      perf: v.perf == null ? null : fin(v.perf, Number.NaN),
    })),
  }
}

/** Rate between two samples, or null if they do not form a valid forward interval. */
export function rateBetween(a: NetSample, b: NetSample): NetRates | null {
  const dt = b.t - a.t
  if (!(dt > 0)) return null
  const dTx = b.txs_sealed - a.txs_sealed
  const dL = b.ledgers_sealed - a.ledgers_sealed
  // Counter reset (node restart / failover to a seat with a different counter): skip.
  if (dTx < 0 || dL < 0) return null
  return {
    tps: dTx / (dt / 1000),
    blocks_min: dL / (dt / 60_000),
    txs_per_block: dL > 0 ? dTx / dL : 0,
    span_ms: dt,
  }
}

/**
 * Rate over the newest `windowMs` of a time-ordered sample list. Uses the oldest
 * sample inside the window as the base, so a 60s window over 4s polls averages
 * ~15 intervals. Falls back to the last two samples when the list is short.
 */
export function windowRate(samples: NetSample[], windowMs: number): NetRates | null {
  if (samples.length < 2) return null
  const last = samples[samples.length - 1]
  const cutoff = last.t - windowMs
  let base = samples[samples.length - 2]
  for (let i = samples.length - 2; i >= 0; i--) {
    if (samples[i].t < cutoff) break
    base = samples[i]
  }
  return rateBetween(base, last)
}

/** Per-seat lag behind the network tip, null when the seat does not advertise a tip. */
export function seatLag(height: number, seat: SeatSample): number | null {
  if (!seat.tip) return null
  return Math.max(0, height - seat.tip)
}

// ── 24h series keys ─────────────────────────────────────────────────────────

export const NET_KEYS = [
  'tps',
  'blocks_min',
  'txs_per_block',
  'mempool',
  'mempool_in',
  'peers',
  'online',
  'height',
  'txs_sealed',
  'min_fee',
  'fee_multiplier',
] as const
export type NetKey = (typeof NET_KEYS)[number]
export type SeatMetric = 'tip' | 'lag' | 'packs_min' | 'perf'
export const SEAT_METRICS: SeatMetric[] = ['tip', 'lag', 'packs_min', 'perf']

export const seatKey = (id: string, m: SeatMetric) => `seat.${id}.${m}`

export function parseSeatKey(k: string): { id: string; metric: SeatMetric } | null {
  const m = /^seat\.(.+)\.(tip|lag|packs_min|perf)$/.exec(k)
  return m ? { id: m[1], metric: m[2] as SeatMetric } : null
}

export const SERIES_LABELS: Record<string, string> = {
  tps: 'Network tx/s (sealed)',
  blocks_min: 'Blocks / min',
  txs_per_block: 'Txs / block',
  mempool: 'Mempool size (txs waiting)',
  mempool_in: 'Mempool intake (tx/s, est.)',
  peers: 'Peers',
  online: 'Online seats',
  height: 'Height',
  txs_sealed: 'Txs sealed (total)',
  min_fee: 'Min fee (FPL)',
  fee_multiplier: 'Fee tier (×)',
  tip: 'Advertised tip',
  lag: 'Tip lag (blocks)',
  packs_min: 'Packs / min',
  perf: 'Perf score',
  cpu: 'CPU',
}

export function seriesLabel(key: string): string {
  const s = parseSeatKey(key)
  if (s) return `${s.id} · ${SERIES_LABELS[s.metric]}`
  return SERIES_LABELS[key] ?? key
}

/**
 * Flatten one interval (a → b) into series values: network rates, current gauges,
 * and per-seat lag / packs-per-minute / perf. Used by both the client ring buffer
 * and the server cron so the two histories line up.
 */
export function seriesValues(a: NetSample | null, b: NetSample): Record<string, number> {
  const out: Record<string, number> = {
    mempool: b.mempool,
    peers: b.peers,
    online: b.online,
    height: b.height,
    txs_sealed: b.txs_sealed,
    min_fee: b.min_fee,
    fee_multiplier: b.fee_multiplier,
  }
  const r = a ? rateBetween(a, b) : null
  if (r && a) {
    out.tps = round(r.tps, 2)
    // Intake = what was sealed plus how much the mempool grew (evictions/rejects not counted).
    out.mempool_in = round(Math.max(0, r.tps + (b.mempool - a.mempool) / (r.span_ms / 1000)), 2)
    out.blocks_min = round(r.blocks_min, 2)
    if (r.blocks_min > 0) out.txs_per_block = round(r.txs_per_block, 1)
  }
  const prev = new Map((a?.seats ?? []).map((s) => [s.id, s]))
  for (const s of b.seats) {
    const lag = seatLag(b.height, s)
    if (lag != null) out[seatKey(s.id, 'lag')] = lag
    if (s.tip) out[seatKey(s.id, 'tip')] = s.tip
    if (s.perf != null && Number.isFinite(s.perf)) out[seatKey(s.id, 'perf')] = round(s.perf, 4)
    const p = prev.get(s.id)
    if (a && p && b.t > a.t && s.packs >= p.packs) {
      out[seatKey(s.id, 'packs_min')] = round((s.packs - p.packs) / ((b.t - a.t) / 60_000), 2)
    }
  }
  return out
}

function round(v: number, dp: number): number {
  const f = 10 ** dp
  return Math.round(v * f) / f
}
