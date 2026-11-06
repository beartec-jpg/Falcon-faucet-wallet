// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
//
// Durable fill index for explorer history (P2). Does NOT claim to be a chain archive.
// Sources fills from the node's RECENT_FILLS ring (≤200) via backfill; retains across
// process restart when a store path is configured. Opaque cursors; identical fills keep
// distinct ids via height-local index.

import { createHash } from 'crypto'
import { honestSealTimes } from './mappers'
import { amount, type Amount } from './amounts'

export type RawFill = {
  height: number
  asset: string
  side: string
  price: unknown
  base: unknown
  quote: unknown
  taker: string
  maker: string
  maker_order?: number | null
  taker_order?: number | null
  /** Optional node physics stamp — never Date()'d as UTC. */
  sealed_at_ms?: number
  sealed_utc_ms?: number
  sealed_utc_quality?: string
  tip_hash?: string
}

export type FillRecord = {
  /** Stable id: f_<height>_<idx>_<content12> — idx preserves identical-fill multiplicity. */
  fill_id: string
  height: number
  /** Canonical tip/block hash known at ingest when provided; else null (honest gap). */
  block_hash: string | null
  pair: string
  side: string
  price: Amount
  amount: Amount
  total: Amount
  taker: string
  maker: string
  maker_order: number | null
  taker_order: number | null
  /** Index among fills at the same height in deterministic ingest order (0-based). */
  height_index: number
  content_fingerprint: string
  sealed_at_ms: number | null
  sealed_at_quality: 'chain_physics' | 'unavailable'
  sealed_utc: string | null
  sealed_utc_ms: number | null
  sealed_utc_quality: string
  sealed_utc_source: 'signed_utc_v5' | 'none'
  observed_at: string
}

export type Coverage = {
  /** Inclusive height of earliest retained fill, or null if empty. */
  earliest_height: number | null
  /** Inclusive height of latest retained fill, or null if empty. */
  latest_height: number | null
  fill_count: number
  /** Heights in [earliest, latest] with zero fills recorded (may be empty books, not proof of missing). */
  sparse_heights_sample: number[]
  /** Honest: this store is fed from the node ring (≤200) unless an external backfill fed more. */
  source: 'node_recent_fills_ring' | 'mixed'
  /** Explicit non-claim. */
  is_full_archive: false
  ring_limit_note: 'Node RECENT_FILLS=200; this index retains what was ingested, not the full chain.'
}

function fingerprint(f: RawFill, heightIndex: number): string {
  const payload = [
    f.height,
    heightIndex,
    f.asset,
    f.side,
    String(f.price ?? ''),
    String(f.base ?? ''),
    String(f.quote ?? ''),
    f.taker,
    f.maker,
    f.maker_order ?? '',
    f.taker_order ?? '',
  ].join('|')
  return createHash('sha256').update(payload).digest('hex').slice(0, 12)
}

export function assignFillId(height: number, heightIndex: number, contentFp: string): string {
  return `f_${height}_${heightIndex}_${contentFp}`
}

/** Deterministic order: height asc, then height_index asc (ingest order within height). */
export function compareFills(a: FillRecord, b: FillRecord): number {
  if (a.height !== b.height) return a.height - b.height
  return a.height_index - b.height_index
}

export function encodeHistoryCursor(fillId: string): string {
  return Buffer.from(`h1:${fillId}`, 'utf8').toString('base64url')
}

export function decodeHistoryCursor(raw: string | null): string | null {
  if (raw == null || raw === '') return null
  try {
    const s = Buffer.from(raw, 'base64url').toString('utf8')
    if (!s.startsWith('h1:')) return null
    const id = s.slice(3)
    return /^f_\d+_\d+_[a-f0-9]{12}$/.test(id) ? id : null
  } catch {
    return null
  }
}

export class FillHistoryStore {
  private byId = new Map<string, FillRecord>()
  private order: string[] = []
  private heightCounts = new Map<number, number>()
  private source: Coverage['source'] = 'node_recent_fills_ring'

  constructor(private readonly maxRecords = 50_000) {}

  get size(): number {
    return this.order.length
  }

  /** Ingest a batch of raw fills from one height window. Preserves multiplicity. */
  ingest(raws: RawFill[], observedAtMs = Date.now(), blockHashByHeight?: Map<number, string>): number {
    let added = 0
    // Group by height preserving input order for height_index
    const byH = new Map<number, RawFill[]>()
    for (const r of raws) {
      const h = Number(r.height) || 0
      if (h <= 0) continue
      const list = byH.get(h) || []
      list.push(r)
      byH.set(h, list)
    }
    const heights = [...byH.keys()].sort((a, b) => a - b)
    for (const h of heights) {
      const list = byH.get(h)!
      let idx = this.heightCounts.get(h) || 0
      for (const r of list) {
        const fp = fingerprint(r, idx)
        const fillId = assignFillId(h, idx, fp)
        if (this.byId.has(fillId)) {
          idx += 1
          continue
        }
        const times = honestSealTimes({
          physicsMs: Number(r.sealed_at_ms) || Number.NaN,
          utcMs: Number(r.sealed_utc_ms) || Number.NaN,
          utcQuality: r.sealed_utc_quality || 'unavailable',
          observedAtMs,
        })
        const base = (r.asset || 'FPL').toUpperCase()
        const rec: FillRecord = {
          fill_id: fillId,
          height: h,
          block_hash: blockHashByHeight?.get(h) ?? (r.tip_hash ? String(r.tip_hash) : null),
          pair: `${base}-FPL`,
          side: String(r.side || '').toLowerCase(),
          price: amount('FPL', r.price ?? 0),
          amount: amount(base, r.base ?? 0),
          total: amount('FPL', r.quote ?? 0),
          taker: String(r.taker || ''),
          maker: String(r.maker || ''),
          maker_order: r.maker_order == null || !Number.isFinite(Number(r.maker_order)) ? null : Number(r.maker_order),
          taker_order: r.taker_order == null || !Number.isFinite(Number(r.taker_order)) ? null : Number(r.taker_order),
          height_index: idx,
          content_fingerprint: fp,
          sealed_at_ms: times.sealed_at_ms,
          sealed_at_quality: times.sealed_at_quality,
          sealed_utc: times.sealed_utc,
          sealed_utc_ms: times.sealed_utc_ms,
          sealed_utc_quality: times.sealed_utc_quality,
          sealed_utc_source: times.sealed_utc_source,
          observed_at: times.observed_at,
        }
        this.byId.set(fillId, rec)
        this.order.push(fillId)
        idx += 1
        added += 1
      }
      this.heightCounts.set(h, idx)
    }
    this.trim()
    return added
  }

  private trim(): void {
    while (this.order.length > this.maxRecords) {
      const id = this.order.shift()!
      this.byId.delete(id)
    }
  }

  coverage(): Coverage {
    if (this.order.length === 0) {
      return {
        earliest_height: null,
        latest_height: null,
        fill_count: 0,
        sparse_heights_sample: [],
        source: this.source,
        is_full_archive: false,
        ring_limit_note: 'Node RECENT_FILLS=200; this index retains what was ingested, not the full chain.',
      }
    }
    const heights = this.order.map((id) => this.byId.get(id)!.height)
    const earliest = Math.min(...heights)
    const latest = Math.max(...heights)
    const present = new Set(heights)
    const sparse: number[] = []
    for (let h = earliest; h <= latest && sparse.length < 32; h++) {
      if (!present.has(h)) sparse.push(h)
    }
    return {
      earliest_height: earliest,
      latest_height: latest,
      fill_count: this.order.length,
      sparse_heights_sample: sparse,
      source: this.source,
      is_full_archive: false,
      ring_limit_note: 'Node RECENT_FILLS=200; this index retains what was ingested, not the full chain.',
    }
  }

  /**
   * Page newest-first after optional cursor (cursor = last seen fill_id from previous page).
   * Opaque stable cursor semantics: resume strictly before that id in reverse chrono order.
   */
  page(opts: { limit: number; cursor?: string | null; pair?: string | null }): {
    items: FillRecord[]
    next_cursor: string | null
    coverage: Coverage
  } {
    const limit = Math.min(100, Math.max(1, opts.limit || 50))
    const pair = opts.pair ? opts.pair.toUpperCase() : null
    // newest first
    const sorted = [...this.order]
      .map((id) => this.byId.get(id)!)
      .filter(Boolean)
      .filter((r) => (pair ? r.pair === pair : true))
      .sort((a, b) => compareFills(b, a))
    let start = 0
    if (opts.cursor) {
      const idx = sorted.findIndex((r) => r.fill_id === opts.cursor)
      start = idx >= 0 ? idx + 1 : sorted.length
    }
    const slice = sorted.slice(start, start + limit)
    const next = start + limit < sorted.length && slice.length ? encodeHistoryCursor(slice[slice.length - 1].fill_id) : null
    return { items: slice, next_cursor: next, coverage: this.coverage() }
  }

  /** Serialize for restart retention. */
  dump(): FillRecord[] {
    return this.order.map((id) => this.byId.get(id)!).filter(Boolean)
  }

  load(rows: FillRecord[]): void {
    this.byId.clear()
    this.order = []
    this.heightCounts.clear()
    for (const r of rows) {
      if (!r?.fill_id) continue
      this.byId.set(r.fill_id, r)
      this.order.push(r.fill_id)
      const c = this.heightCounts.get(r.height) || 0
      this.heightCounts.set(r.height, Math.max(c, r.height_index + 1))
    }
    this.source = 'mixed'
    this.trim()
  }
}

/** Height→time path consistent with #187: physics never Unix; UTC only if utc_committed. */
export function heightTimeFromTipStatus(st: Record<string, unknown>, observedAtMs: number) {
  return honestSealTimes({
    physicsMs: Number(st.tip_sealed_at_ms) || Number.NaN,
    utcMs: Number(st.tip_sealed_utc_ms) || Number.NaN,
    utcQuality: String(st.tip_sealed_utc_quality || 'unavailable'),
    observedAtMs,
  })
}
