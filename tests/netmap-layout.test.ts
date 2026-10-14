import { describe, expect, it } from 'vitest'
import { NETWORK_MAP_CONFIG } from '@/config/network-map'
import { bezier, HUB_CORE_TOP_DY, layoutMap, pipePoints, railRoute, segDist, type Vec3 } from '@/lib/netmap-layout'

// Live seat set as of 2026-10-14 (9 online + 6 jailed, which the map hides).
const SEATS = ['falcon-node', 'scottspersonalnode', 'v1', 'v10', 'v11', 'v12', 'v13', 'v3', 'v6'].map((id) => ({ id, online: true }))
  .concat(['v2', 'v4', 'v5', 'v7', 'v8', 'v9'].map((id) => ({ id, online: false })))
const L = layoutMap(NETWORK_MAP_CONFIG, SEATS)

const poly = (pts: Vec3[]) => pts.slice(1).map((p, i) => [pts[i], p] as [Vec3, Vec3])
const pipe = (seat: Vec3, from = 0, n = 48) => {
  const P = pipePoints(L.hub.pos, seat)
  return Array.from({ length: n + 1 }, (_, i) => bezier(P, from + ((1 - from) * i) / n))
}
const distPolyPoint = (segs: [Vec3, Vec3][], p: Vec3) => Math.min(...segs.map(([a, b]) => segDist(a, b, p, p)))
const distPolyPoly = (a: [Vec3, Vec3][], b: [Vec3, Vec3][]) => Math.min(...a.flatMap(([p, q]) => b.map(([r, s]) => segDist(p, q, r, s))))

/** Chassis half-diagonal ≈ 0.5; a pipe/route closer than this to a unit's centre passes through it. */
const BODY = 0.6

describe('network map layout: nothing overlaps', () => {
  it('places every online seat and wallet services', () => {
    expect(L.seats.map((s) => s.id).sort()).toEqual(SEATS.filter((s) => s.online && s.id !== 'v11').map((s) => s.id).sort())
    expect(L.wallet?.label).toBe('Wallet services')
  })

  it('keeps units apart (≥ 2 units between centres)', () => {
    const all = [...L.seats.map((s) => s.pos), L.wallet!.pos]
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(segDist(all[i], all[i], all[j], all[j])).toBeGreaterThan(2)
  })

  it('no hub pipe passes through another unit', () => {
    for (const s of L.seats) {
      const segs = poly(pipe(s.pos))
      for (const o of L.seats) if (o.id !== s.id) expect(distPolyPoint(segs, o.pos)).toBeGreaterThan(BODY)
    }
  })

  it('hub pipes never touch each other once clear of the plinth', () => {
    const segs = L.seats.map((s) => poly(pipe(s.pos, 0.12)))
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) expect(distPolyPoly(segs[i], segs[j])).toBeGreaterThan(0.12)
  })

  it('wallet services sits above the hub and beams straight into it, crossing nothing', () => {
    const w = L.wallet!.pos
    const h = L.hub.pos
    expect(w[0]).toBe(h[0])
    expect(w[2]).toBe(h[2])
    const ringY = h[1] + 1.45
    expect(w[1] - 0.62).toBeGreaterThan(ringY + 1.5)
    const beam: [Vec3, Vec3][] = [[[w[0], w[1] - 0.62, w[2]], [h[0], h[1] + HUB_CORE_TOP_DY, h[2]]]]
    // Beam runs down the ring's axis: 3.6 from the ring everywhere.
    const R = 3.6
    const ring = poly(Array.from({ length: 97 }, (_, i) => [h[0] + Math.cos((i / 96) * Math.PI * 2) * R, ringY, h[2] + Math.sin((i / 96) * Math.PI * 2) * R] as Vec3))
    expect(distPolyPoly(beam, ring)).toBeGreaterThan(3.5)
    // Pipes all leave below the core, so the beam never meets them.
    for (const s of L.seats) expect(distPolyPoly(beam, poly(pipe(s.pos)))).toBeGreaterThan(0.6)
    for (const s of L.seats) expect(distPolyPoint(beam, s.pos)).toBeGreaterThan(5)
  })

  it('watcher ring clears the hub rings and every pipe', () => {
    const R = 3.6
    const c: Vec3 = [L.hub.pos[0], L.hub.pos[1] + 1.45, L.hub.pos[2]]
    const ring = poly(Array.from({ length: 97 }, (_, i) => [c[0] + Math.cos((i / 96) * Math.PI * 2) * R, c[1], c[2] + Math.sin((i / 96) * Math.PI * 2) * R] as Vec3))
    for (const s of L.seats) expect(distPolyPoly(ring, poly(pipe(s.pos)))).toBeGreaterThan(1)
    expect(R - 1.14).toBeGreaterThan(2)
  })

  it('vote routes run along the rail without passing through other units', () => {
    for (const a of L.seats) for (const b of L.seats) {
      if (a.id === b.id) continue
      const segs = poly(railRoute(a.pos, b.pos)).slice(1, -1)
      for (const o of L.seats) if (o.id !== a.id && o.id !== b.id) expect(distPolyPoint(segs, o.pos)).toBeGreaterThan(BODY)
    }
  })
})
