// Consensus cycle for the 3D map: which seats vote and which seat packs each
// round, and when the phases fire. Pure, so it is unit-tested.
//
// Real when the node exposes it (status.sealed_committee / next_committee /
// lottery_winner_next, passed through /api/scan as `committee`). Otherwise a
// deterministic rotation over the online, lottery-ready seats, flagged
// `estimated` so the UI can say so.

import type { ScanData } from '@/lib/scan-types'

export interface Round {
  /** Height this round produces. */
  height: number
  voters: string[]
  packer: string
  /** Votes needed to seal (commit_need, default 4). */
  need: number
  /** true = committee guessed by rotation, not reported by the node. */
  estimated: boolean
}

export function eligibleSeats(d: Pick<ScanData, 'validators' | 'online_seats'>): string[] {
  const online = new Set(d.online_seats ?? [])
  return (d.validators ?? [])
    .filter((v) => !v.jailed && v.lottery_ready !== false && (online.size === 0 || online.has(v.account)))
    .map((v) => v.account)
    .sort()
}

/** Deterministic rotation: `size` consecutive seats starting at height mod n. */
export function rotationCommittee(seats: string[], height: number, size: number): string[] {
  const n = seats.length
  if (!n) return []
  const k = Math.min(n, Math.max(1, size))
  const start = ((height % n) + n) % n
  return Array.from({ length: k }, (_, i) => seats[(start + i) % n])
}

type RoundInput = Pick<ScanData, 'height' | 'validators' | 'online_seats' | 'lottery_winner' | 'committee'> & {
  committee_size?: number
  commit_need?: number
}

/** The round currently being voted: it produces height + 1. */
export function nextRound(d: RoundInput): Round {
  const need = d.commit_need || 4
  const c = d.committee
  if (c && c.next_committee.length) {
    const packer = c.next_packer || c.next_committee[0]
    return { height: d.height + 1, voters: c.next_committee, packer, need, estimated: false }
  }
  const voters = rotationCommittee(eligibleSeats(d), d.height + 1, d.committee_size || 6)
  const packer = d.lottery_winner && voters.includes(d.lottery_winner) ? d.lottery_winner : (voters[0] ?? '')
  return { height: d.height + 1, voters, packer, need, estimated: true }
}

/** The round that just sealed the tip, when the node reports its committee. */
export function sealedRound(d: RoundInput & Pick<ScanData, 'last_pack'>): Round | null {
  const c = d.committee
  if (!c || !c.sealed_committee.length) return null
  return { height: d.height, voters: c.sealed_committee, packer: d.last_pack?.packer || '', need: d.commit_need || 4, estimated: false }
}

/** EWMA of the block interval (ms) from observed (height, time) pairs; clamped 0.8–20 s. */
export function nextInterval(prevMs: number, dHeight: number, dtMs: number): number {
  if (!(dHeight > 0) || !(dtMs > 0)) return prevMs
  const sample = dtMs / dHeight
  const v = prevMs > 0 ? prevMs * 0.7 + sample * 0.3 : sample
  return Math.min(20_000, Math.max(800, v))
}

export type Phase = 'beam' | 'vote' | 'pulse' | 'seal'

/**
 * Phase at `t` ms since the round started, for an expected interval `T`.
 * beam 0–20 %, vote (voters lit) 20–55 %, pulse (votes fly to packer) 55–100 %,
 * then 'pulse' holds until the real block arrives and the scene plays 'seal'.
 */
export function phaseAt(t: number, T: number): { phase: Phase; u: number } {
  const f = T > 0 ? t / T : 1
  if (f < 0.2) return { phase: 'beam', u: f / 0.2 }
  if (f < 0.55) return { phase: 'vote', u: (f - 0.2) / 0.35 }
  return { phase: 'pulse', u: Math.min(1, (f - 0.55) / 0.45) }
}
