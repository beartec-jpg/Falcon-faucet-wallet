// Pure layout for the 3D network map: hub on top, location groups on an arc below.

import type { MapLocation, NetworkMapConfig } from '@/config/network-map'

export type Vec3 = [number, number, number]

export interface PlacedSeat {
  id: string
  host: string
  locationId: string
  locationLabel: string
  confirmed: boolean
  note?: string
  pos: Vec3
}

export interface PlacedGroup {
  id: string
  label: string
  confirmed: boolean
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
  ingress: { seat: string; label: string; pos: Vec3 } | null
}

const HUB_Y = 5.2
const GROUP_Y = -1.6
const RADIUS = 9.5
const SEAT_GAP = 2.1

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
  const locs: MapLocation[] = cfg.locations.map((l) => ({
    ...l,
    hosts: l.hosts.map((h) => ({ ...h, seats: h.seats.filter((s) => s !== cfg.hub.seat) })),
  }))
  for (const l of locs) for (const h of l.hosts) h.seats.forEach((s) => configured.add(s))
  const extra = statusSeats
    .filter((s) => !configured.has(s.id) && (s.online || cfg.showUnplacedOffline))
    .map((s) => s.id)
    .sort()
  if (extra.length) {
    locs.push({ id: 'unplaced', label: 'Unplaced (add to config)', confirmed: false, hosts: [{ host: '', seats: extra }] })
  }
  const groups = locs.filter((l) => l.hosts.some((h) => h.seats.length))

  // Spread groups over a front-facing arc, weighting arc share by seat count.
  const counts = groups.map((g) => g.hosts.reduce((n, h) => n + h.seats.length, 0))
  const total = counts.reduce((a, b) => a + b, 0) || 1
  const arc = Math.min(Math.PI * 1.15, 0.4 * (total + groups.length))
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
        confirmed: g.confirmed,
        pos: [cx + tx * off, GROUP_Y, cz + tz * off],
      })
    })
    placedGroups.push({
      id: g.id,
      label: g.label,
      confirmed: g.confirmed,
      center: [cx, GROUP_Y - 0.55, cz],
      width: Math.max(1.2, (n * SEAT_GAP) / 2 + 0.3),
      yaw: theta,
    })
  })

  const ing = cfg.ingress ? seats.find((s) => s.id === cfg.ingress!.seat) : null
  return {
    hub: { id: cfg.hub.seat, host: cfg.hub.host, pos: [0, HUB_Y, -2.5] },
    seats,
    groups: placedGroups,
    ingress: ing && cfg.ingress
      ? { seat: ing.id, label: cfg.ingress.label, pos: [ing.pos[0] * 1.18, GROUP_Y - 2.4, ing.pos[2] * 1.18] }
      : null,
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
