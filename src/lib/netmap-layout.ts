// Pure layout for the 3D network map: hub on top, location groups on an arc below.

import type { MapLocation, NetworkMapConfig } from '@/config/network-map'

export type Vec3 = [number, number, number]

export interface PlacedSeat {
  id: string
  host: string
  locationId: string
  locationLabel: string
  note?: string
  pos: Vec3
  /** Rotation about Y: the unit's front faces away from the hub. */
  yaw: number
}

export interface PlacedGroup {
  id: string
  label: string
  center: Vec3
  /** Platform half-width along the group's tangent. */
  width: number
  /** Rotation about Y so the platform faces the hub. */
  yaw: number
}

export interface MapLayout {
  hub: { id: string; host: string; pos: Vec3 }
  seats: PlacedSeat[]
  groups: PlacedGroup[]
  /** Wallet services node, straight above the hub on its axis. */
  wallet: { label: string; sub: string; pos: Vec3 } | null
}

const HUB_Y = 5.2
const GROUP_Y = -1.6
const RADIUS = 12
const SEAT_GAP = 2.4
/** Hub plinth rim radius: pipes leave from here, not through the tower. */
export const HUB_RIM = 0.95
export const HUB_BASE_DY = -1.75
/**
 * Wallet services sits on the hub's vertical axis, above the watcher ring
 * (ring: hub + 1.45, r 3.6). Its beam drops straight down the axis through the
 * ring's empty centre into the top of the hub core, so it crosses nothing.
 */
export const WALLET_DY = 3.9
/** Beam ends at the top of the hub core (core radius 0.5). */
export const HUB_CORE_TOP_DY = 0.6

/**
 * @param statusSeats seats present in the live status (any order). Seats not in
 *        config are placed in an "Unplaced" group; offline unplaced seats are
 *        dropped unless `showUnplacedOffline`.
 */
export function layoutMap(
  cfg: NetworkMapConfig,
  statusSeats: { id: string; online: boolean }[],
): MapLayout {
  const configured = new Set<string>([cfg.hub.seat])
  const active = new Set(statusSeats.filter((s) => s.online).map((s) => s.id))
  const locs: MapLocation[] = cfg.locations.map((l) => ({
    ...l,
    // Only active seats: drop placed seats that status reports offline, jailed or absent.
    hosts: l.hosts.map((h) => ({ ...h, seats: h.seats.filter((s) => s !== cfg.hub.seat && (!statusSeats.length || active.has(s))) })),
  }))
  for (const l of locs) for (const h of l.hosts) h.seats.forEach((s) => configured.add(s))
  const extra = statusSeats
    .filter((s) => !configured.has(s.id) && (s.online || cfg.showUnplacedOffline))
    .map((s) => s.id)
    .sort()
  if (extra.length) {
    locs.push({ id: 'unplaced', label: '', hosts: [{ host: '', seats: extra }] })
  }
  const groups = locs.filter((l) => l.hosts.some((h) => h.seats.length))

  // Spread groups over a front-facing arc, weighting arc share by seat count.
  const counts = groups.map((g) => g.hosts.reduce((n, h) => n + h.seats.length, 0))
  const total = counts.reduce((a, b) => a + b, 0) || 1
  const arc = Math.min(Math.PI * 0.64, 0.24 * (total + groups.length))
  let cursor = -arc / 2
  const placedGroups: PlacedGroup[] = []
  const seats: PlacedSeat[] = []
  groups.forEach((g, gi) => {
    const share = (arc * (counts[gi] + 1)) / (total + groups.length)
    const theta = cursor + share / 2
    cursor += share
    // theta = 0 is straight in front of the camera (+z).
    const cx = Math.sin(theta) * RADIUS
    const cz = Math.cos(theta) * RADIUS - 2.5
    const tx = Math.cos(theta)
    const tz = -Math.sin(theta)
    const n = counts[gi]
    const flat = g.hosts.flatMap((h) => h.seats.map((s) => ({ s, h })))
    flat.forEach(({ s, h }, i) => {
      const off = (i - (n - 1) / 2) * SEAT_GAP
      seats.push({
        id: s,
        host: h.host,
        note: h.note,
        locationId: g.id,
        locationLabel: g.label,
        pos: [cx + tx * off, GROUP_Y, cz + tz * off],
        yaw: theta,
      })
    })
    placedGroups.push({
      id: g.id,
      label: g.label,
      center: [cx, GROUP_Y - 0.55, cz],
      width: Math.max(1.2, (n * SEAT_GAP) / 2 + 0.2),
      yaw: theta,
    })
  })

  return {
    hub: { id: cfg.hub.seat, host: cfg.hub.host, pos: [0, HUB_Y, -2.5] },
    seats,
    groups: placedGroups,
    wallet: cfg.wallet ? { label: cfg.wallet.label, sub: cfg.wallet.sub, pos: [0, HUB_Y + WALLET_DY, -2.5] } : null,
  }
}

/** Fill fraction for the packer ring: block txs vs. the biggest recent block (floor 100). */
export function ringFill(txs: number, recentMax: number): number {
  const denom = Math.max(100, recentMax)
  return Math.max(0.04, Math.min(1, txs / denom))
}

/** Bulges for an interval of `newTxs` sealed txs: 1 per 10 txs, at least 1, at most `cap`. */
export function bulgeCount(newTxs: number, cap: number): number {
  if (!(newTxs > 0)) return 0
  return Math.max(1, Math.min(cap, Math.ceil(newTxs / 10)))
}

/** Pipe start for a seat: the hub plinth rim on the side facing that seat. */
export function hubRimPoint(hub: Vec3, seat: Vec3): Vec3 {
  const dx = seat[0] - hub[0]
  const dz = seat[2] - hub[2]
  const l = Math.hypot(dx, dz) || 1
  return [hub[0] + (dx / l) * HUB_RIM, hub[1] + HUB_BASE_DY, hub[2] + (dz / l) * HUB_RIM]
}

/** Minimum distance between segments p1-p2 and q1-q2 (for overlap checks in tests). */
export function segDist(p1: Vec3, p2: Vec3, q1: Vec3, q2: Vec3): number {
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const d1 = sub(p2, p1), d2 = sub(q2, q1), r = sub(p1, q1)
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r)
  let s = 0, t = 0
  const c = dot(d1, r), b = dot(d1, d2), den = a * e - b * b
  s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0
  t = e > 1e-9 ? (b * s + f) / e : 0
  if (t < 0) { t = 0; s = a > 1e-9 ? Math.min(1, Math.max(0, -c / a)) : 0 }
  else if (t > 1) { t = 1; s = a > 1e-9 ? Math.min(1, Math.max(0, (b - c) / a)) : 0 }
  const pc: Vec3 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s]
  const qc: Vec3 = [q1[0] + d2[0] * t, q1[1] + d2[1] * t, q1[2] + d2[2] * t]
  const w = sub(pc, qc)
  return Math.sqrt(dot(w, w))
}

export const SEAT_TOP_DY = 0.22
export const RAIL_INSET = 1.25
export const RAIL_DY = -0.38
/** Arc centre on the ground plane (the hub stands above it). */
export const ARC_CENTER: [number, number] = [0, -2.5]

/** Hub → seat pipe as quadratic Bézier points [start, control, end]. */
export function pipePoints(hub: Vec3, seat: Vec3): [Vec3, Vec3, Vec3] {
  const a = hubRimPoint(hub, seat)
  const b: Vec3 = [seat[0], seat[1] + SEAT_TOP_DY, seat[2]]
  // Control point sits in the same vertical plane as a→b, so pipes to
  // different seats never cross (each stays in its own azimuth plane).
  const c: Vec3 = [a[0] + (b[0] - a[0]) * 0.62, a[1] - 0.25, a[2] + (b[2] - a[2]) * 0.62]
  return [a, c, b]
}

export function bezier(p: [Vec3, Vec3, Vec3], t: number): Vec3 {
  const u = 1 - t
  return [0, 1, 2].map((i) => u * u * p[0][i] + 2 * u * t * p[1][i] + t * t * p[2][i]) as Vec3
}

/** Angle of a ground point around ARC_CENTER (0 = toward camera, +x positive). */
export function arcAngle(p: Vec3): number {
  return Math.atan2(p[0] - ARC_CENTER[0], p[2] - ARC_CENTER[1])
}

/**
 * Vote route from one seat to another along the consensus rail: drop from the
 * voter's front-inner edge to the rail (inside the arc, below every pipe), run
 * along it, rise to the packer. Returns control points for a smooth spline.
 */
export function railRoute(from: Vec3, to: Vec3, steps = 10): Vec3[] {
  const ra = Math.hypot(from[0] - ARC_CENTER[0], from[2] - ARC_CENTER[1]) - RAIL_INSET
  const rb = Math.hypot(to[0] - ARC_CENTER[0], to[2] - ARC_CENTER[1]) - RAIL_INSET
  const a0 = arcAngle(from)
  const a1 = arcAngle(to)
  const y = from[1] + RAIL_DY
  const at = (ang: number, r: number, yy: number): Vec3 => [ARC_CENTER[0] + Math.sin(ang) * r, yy, ARC_CENTER[1] + Math.cos(ang) * r]
  const pts: Vec3[] = [[from[0], from[1] + 0.05, from[2]], at(a0, ra + 0.75, y + 0.12)]
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    pts.push(at(a0 + (a1 - a0) * t, ra + (rb - ra) * t, y))
  }
  pts.push(at(a1, rb + 0.75, y + 0.12), [to[0], to[1] + 0.05, to[2]])
  return pts
}
