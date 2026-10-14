'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Environment, Html, Lightformer, OrbitControls, PerformanceMonitor, RoundedBox } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import type { MapLayout, Vec3 } from '@/lib/netmap-layout'
import { bulgeCount, HUB_BASE_DY, HUB_CORE_TOP_DY, pipePoints, railRoute, ringFill } from '@/lib/netmap-layout'
import { phaseAt, type Round } from '@/lib/netmap-consensus'
import type { PollEvent } from '@/hooks/useNetworkFeed'
import WatcherRing, { type WatcherRingEvent } from '@/components/netmap/WatcherRing'

export const COLORS = {
  copper: '#C07838',
  gold: '#D4922A',
  goldHot: '#FFC060',
  bg: '#020617',
  panel: '#0F172A',
  steel: '#1E293B',
  cream: '#E0DBCA',
  green: '#22C55E',
  greenHot: '#4ADE80',
  idle: '#2F4A3E',
  grey: '#475569',
}

export interface SeatView {
  online: boolean
  jailed: boolean
  lag: number | null
}

export interface ConsensusView {
  round: Round | null
  /** Expected block interval, ms (EWMA of observed heights). */
  intervalMs: number
  /** Element the scene writes the current phase into (no React render per frame). */
  phaseRef?: React.MutableRefObject<HTMLSpanElement | null>
}

export interface SceneProps {
  layout: MapLayout
  seats: Record<string, SeatView>
  event: PollEvent | null
  maxBulges: number
  selected: string | null
  onSelect: (id: string) => void
  fpsRef?: React.MutableRefObject<HTMLSpanElement | null>
  watchers?: { epoch: string[]; live: string[]; cap: number; event: WatcherRingEvent | null }
  consensus?: ConsensusView
  /** Activated wallets (status.accounts_count via /api/scan), null if not reported. */
  walletCount?: number | null
  /** Live tx/s for the wallet beam. */
  tps?: number | null
}

/** Beam bulge size from live tx/s: 0.7 at idle → 2.0 at ≥ 60 tx/s (log scale). */
export function walletBeamSize(tps: number | null): number {
  if (tps == null || !(tps > 0)) return 0.7
  return Math.min(2, 0.7 + (1.3 * Math.log1p(tps)) / Math.log1p(60))
}

const FLASH_S = 1.4
const BULGE_S = 1.25
const SEAL_S = 0.85
const VOTE_FLY_S = 1.3

/** Shared, mutable animation state read inside useFrame (no React renders per frame). */
interface Anim {
  flash: Map<string, { t: number; fill: number }>
  hubFlash: number
  /** 0..1 eased role intensity per seat, written by ConsensusCycle. */
  voter: Map<string, number>
  packer: Map<string, number>
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
const v3 = (p: Vec3) => new THREE.Vector3(...p)

function pipeCurve(hub: Vec3, seat: Vec3): THREE.QuadraticBezierCurve3 {
  const [a, c, b] = pipePoints(hub, seat)
  return new THREE.QuadraticBezierCurve3(v3(a), v3(c), v3(b))
}

// ── Pipes ──────────────────────────────────────────────────────────────────

const Pipe = memo(function Pipe({ curve, active, radius = 0.04 }: { curve: THREE.Curve<THREE.Vector3>; active: boolean; radius?: number }) {
  const geo = useMemo(() => new THREE.TubeGeometry(curve, 64, radius, 8, false), [curve, radius])
  const core = useMemo(() => new THREE.TubeGeometry(curve, 64, radius * 0.35, 6, false), [curve, radius])
  useEffect(() => () => { geo.dispose(); core.dispose() }, [geo, core])
  return (
    <group>
      <mesh geometry={geo} raycast={noRay}>
        <meshPhysicalMaterial
          color={active ? COLORS.copper : COLORS.grey}
          metalness={0.2}
          roughness={0.15}
          transmission={0}
          transparent
          opacity={active ? 0.28 : 0.1}
          depthWrite={false}
        />
      </mesh>
      <mesh geometry={core} raycast={noRay}>
        <meshBasicMaterial color={active ? COLORS.copper : COLORS.grey} transparent opacity={active ? 0.7 : 0.2} depthWrite={false} />
      </mesh>
    </group>
  )
})

// ── Bulges (tx beams) ──────────────────────────────────────────────────────

interface Bulge {
  curve: THREE.Curve<THREE.Vector3>
  start: number
  size: number
}

function Bulges({
  curves,
  ingress,
  event,
  cap,
  seats,
  tps,
}: {
  curves: Map<string, THREE.Curve<THREE.Vector3>>
  ingress: THREE.Curve<THREE.Vector3> | null
  event: PollEvent | null
  cap: number
  seats: Record<string, SeatView>
  /** Live tx/s (60s window); sizes the wallet → hub beam. */
  tps: number | null
}) {
  const tpsRef = useRef(tps)
  tpsRef.current = tps
  const mesh = useRef<THREE.InstancedMesh>(null)
  const live = useRef<Bulge[]>([])
  const clock = useThree((st) => st.clock)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const seatsRef = useRef(seats)
  seatsRef.current = seats

  useEffect(() => {
    if (!event || event.newTxs <= 0) return
    const now = clock.elapsedTime
    const list = live.current
    const push = (curve: THREE.Curve<THREE.Vector3>, n: number, delay: number, spread: number, size: number) => {
      for (let i = 0; i < n && list.length < cap; i++) list.push({ curve, start: now + delay + (i / Math.max(1, n)) * spread, size })
    }
    // Txs enter at wallet services and beam into the hub (count = 1 per 10 new txs,
    // size grows with the live tx rate), then the hub gossips them out to every online seat.
    if (ingress) push(ingress, bulgeCount(event.newTxs, 10), 0, 0.6, walletBeamSize(tpsRef.current))
    const online = [...curves.keys()].filter((id) => seatsRef.current[id]?.online && !seatsRef.current[id]?.jailed)
    const per = online.length ? event.newTxs / online.length : 0
    for (const id of online) push(curves.get(id)!, bulgeCount(per, 4), 0.35, 0.9, 0.8)
  }, [event, curves, ingress, cap, clock])

  useFrame((st) => {
    const m = mesh.current
    if (!m) return
    const now = st.clock.elapsedTime
    const list = live.current
    let w = 0
    for (let i = 0; i < list.length; i++) {
      const b = list[i]
      const u = (now - b.start) / BULGE_S
      if (u > 1) continue
      list[w++] = b
      if (u < 0) dummy.scale.setScalar(0)
      else {
        b.curve.getPointAt(ease(u), tmp)
        dummy.position.copy(tmp)
        dummy.scale.setScalar(0.075 * b.size * (0.6 + 0.5 * Math.sin(Math.PI * u)))
      }
      dummy.updateMatrix()
      m.setMatrixAt(w - 1, dummy.matrix)
    }
    list.length = w
    m.count = w
    m.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, cap]} frustumCulled={false} raycast={noRay}>
      <sphereGeometry args={[1, 12, 10]} />
      <meshBasicMaterial color={new THREE.Color(COLORS.gold).multiplyScalar(2.2)} toneMapped={false} />
    </instancedMesh>
  )
}

// ── Consensus cycle ────────────────────────────────────────────────────────

const TRAIL = 9
const MAX_PULSES = 12

interface Pulse {
  curve: THREE.Curve<THREE.Vector3>
  start: number
  dur: number
  kind: 'vote' | 'seal'
}

/**
 * Drives the per-round story:
 *  beam  – txs flow hub → seats (Bulges, on each real block)
 *  vote  – this round's committee lights green, its packer gold
 *  pulse – each voter fires a travelling glow along the rail to the packer
 *  seal  – when the real next block lands, the packer sends a sealed package
 *          up its pipe to the hub, then the next round starts.
 * Membership comes from the node when exposed; timing is estimated from the
 * observed block cadence (the node does not publish per-vote times).
 */
function ConsensusCycle({
  layout,
  curves,
  view,
  event,
  anim,
}: {
  layout: MapLayout
  curves: Map<string, THREE.Curve<THREE.Vector3>>
  view: ConsensusView
  event: PollEvent | null
  anim: Anim
}) {
  const clock = useThree((st) => st.clock)
  const mesh = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const col = useMemo(() => ({ vote: new THREE.Color(COLORS.greenHot).multiplyScalar(2.4), seal: new THREE.Color(COLORS.goldHot).multiplyScalar(3) }), [])
  const pos = useMemo(() => {
    const m = new Map<string, Vec3>()
    for (const s of layout.seats) m.set(s.id, s.pos)
    return m
  }, [layout])
  const st = useRef({ round: null as Round | null, start: 0, fired: false, pulses: [] as Pulse[] })
  const viewRef = useRef(view)
  viewRef.current = view

  const routeCache = useRef(new Map<string, THREE.Curve<THREE.Vector3>>())
  useEffect(() => routeCache.current.clear(), [layout])
  const route = (from: string, to: string): THREE.Curve<THREE.Vector3> | null => {
    const key = `${from}>${to}`
    const hit = routeCache.current.get(key)
    if (hit) return hit
    let c: THREE.Curve<THREE.Vector3> | null = null
    if (to === layout.hub.id) {
      // Packer is the hub itself: the vote climbs the voter's own pipe.
      const p = curves.get(from)
      if (p) c = new ReversedCurve(p)
    } else if (from === layout.hub.id) {
      const p = curves.get(to)
      if (p) c = p
    } else {
      const a = pos.get(from)
      const b = pos.get(to)
      if (a && b) c = new THREE.CatmullRomCurve3(railRoute(a, b).map(v3), false, 'centripetal', 0.5)
    }
    if (c) routeCache.current.set(key, c)
    return c
  }

  const fireVotes = (r: Round, now: number, dur: number) => {
    r.voters.forEach((v, i) => {
      if (v === r.packer) return
      const c = route(v, r.packer)
      if (c && st.current.pulses.length < MAX_PULSES) st.current.pulses.push({ curve: c, start: now + i * 0.06, dur, kind: 'vote' })
    })
  }

  // A real new block: finish the old round's votes fast if they had not flown, then seal.
  useEffect(() => {
    if (!event) return
    const s = st.current
    const now = clock.elapsedTime
    const prev = s.round
    let sealAt = now
    if (prev && !s.fired) {
      fireVotes(prev, now, 0.45)
      s.fired = true
      sealAt = now + 0.45
    }
    const tip = event.blocks[event.blocks.length - 1]
    const packer = tip?.packer ?? prev?.packer ?? null
    if (packer && packer !== layout.hub.id) {
      const p = curves.get(packer)
      if (p) s.pulses.push({ curve: new ReversedCurve(p), start: sealAt, dur: SEAL_S, kind: 'seal' })
    }
    anim.hubFlash = sealAt + (packer === layout.hub.id ? 0 : SEAL_S)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event])

  // New round (from the poll that produced the new height): restart the cycle after the seal.
  const roundKey = view.round ? `${view.round.height}|${view.round.packer}|${view.round.voters.join(',')}` : ''
  useEffect(() => {
    const s = st.current
    const r = viewRef.current.round
    if (!r) return
    const now = clock.elapsedTime
    const changedHeight = !s.round || s.round.height !== r.height
    s.round = r
    if (changedHeight) {
      s.start = now + SEAL_S
      s.fired = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundKey])

  useFrame((frame, dt) => {
    const s = st.current
    const now = frame.clock.elapsedTime
    const r = s.round
    const T = Math.max(1.2, (viewRef.current.intervalMs || 3000) / 1000 - SEAL_S)
    const t = now - s.start
    const ph = r && t >= 0 ? phaseAt(t, T) : { phase: 'seal' as const, u: 0 }
    if (r && !s.fired && ph.phase === 'pulse') {
      fireVotes(r, now, Math.min(VOTE_FLY_S, T * 0.42))
      s.fired = true
    }
    // Roles: voters fade in during 'vote', stay lit through 'pulse'; dim in 'beam'/'seal'.
    const target = ph.phase === 'vote' ? ease(ph.u * 3) : ph.phase === 'pulse' ? 1 : ph.phase === 'beam' ? ease(ph.u) * 0.35 : 0.15
    const voters = new Set(r?.voters ?? [])
    const k = 1 - Math.exp(-dt * 8)
    const ids = [layout.hub.id, ...layout.seats.map((x) => x.id)]
    for (const id of ids) {
      const vt = voters.has(id) ? target : 0
      const pt = r && id === r.packer ? Math.max(0.35, target) : 0
      anim.voter.set(id, (anim.voter.get(id) ?? 0) + (vt - (anim.voter.get(id) ?? 0)) * k)
      anim.packer.set(id, (anim.packer.get(id) ?? 0) + (pt - (anim.packer.get(id) ?? 0)) * k)
    }
    const el = viewRef.current.phaseRef?.current
    if (el) {
      const label = !r ? 'waiting' : t < 0 ? 'seal' : ph.phase
      if (el.dataset.p !== label) {
        el.dataset.p = label
        el.textContent = label
      }
    }

    const m = mesh.current
    if (!m) return
    let w = 0
    let n = 0
    const list = s.pulses
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      const u = (now - p.start) / p.dur
      if (u > 1.15) continue
      list[w++] = p
      for (let j = 0; j < TRAIL; j++) {
        const uu = u - j * 0.03
        if (uu < 0 || uu > 1) {
          dummy.scale.setScalar(0)
        } else {
          p.curve.getPointAt(ease(uu), tmp)
          dummy.position.copy(tmp)
          const head = p.kind === 'seal' ? 0.22 : 0.14
          dummy.scale.setScalar(head * (1 - j / TRAIL) * (j === 0 ? 1 : 0.8))
        }
        dummy.updateMatrix()
        m.setMatrixAt(n, dummy.matrix)
        m.setColorAt(n, p.kind === 'seal' ? col.seal : col.vote)
        n++
      }
      // Arrival: tag the target so the unit can flash.
      if (u >= 1 && p.kind === 'seal') anim.hubFlash = Math.max(anim.hubFlash, p.start + p.dur)
    }
    list.length = w
    m.count = n
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX_PULSES * TRAIL]} frustumCulled={false} raycast={noRay}>
      <sphereGeometry args={[1, 12, 10]} />
      <meshBasicMaterial toneMapped={false} transparent opacity={0.95} depthWrite={false} blending={THREE.AdditiveBlending} />
    </instancedMesh>
  )
}

class ReversedCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private readonly c: THREE.Curve<THREE.Vector3>) {
    super()
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    return this.c.getPoint(1 - t, target)
  }
  getPointAt(u: number, target = new THREE.Vector3()) {
    return this.c.getPointAt(1 - u, target)
  }
}

/** Faint ground rail inside the arc that vote pulses run along. */
function ConsensusRail({ layout }: { layout: MapLayout }) {
  const geo = useMemo(() => {
    const sorted = [...layout.seats].sort((a, b) => Math.atan2(a.pos[0], a.pos[2] + 2.5) - Math.atan2(b.pos[0], b.pos[2] + 2.5))
    if (sorted.length < 2) return null
    const pts = railRoute(sorted[0].pos, sorted[sorted.length - 1].pos, 48).slice(2, -2).map(v3)
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.012, 5, false)
  }, [layout])
  useEffect(() => () => geo?.dispose(), [geo])
  if (!geo) return null
  return (
    <mesh geometry={geo} raycast={noRay}>
      <meshBasicMaterial color={COLORS.green} transparent opacity={0.16} depthWrite={false} />
    </mesh>
  )
}

// ── Seats ──────────────────────────────────────────────────────────────────

const RING_SEGMENTS = 48

function useFlash(anim: Anim, id: string, isHub: boolean) {
  return (now: number) => {
    const f = isHub ? { t: anim.hubFlash, fill: 0 } : anim.flash.get(id)
    const age = f ? now - f.t : Infinity
    return { k: age >= 0 && age < FLASH_S ? Math.pow(1 - age / FLASH_S, 1.6) : 0, f }
  }
}

const hover = {
  onPointerOver: () => (document.body.style.cursor = 'pointer'),
  onPointerOut: () => (document.body.style.cursor = ''),
}
const noRay = () => null

/** Hub: plinth, column, glowing core and two counter-rotating rings. */
function HubTower({ id, pos, view, host, anim, selected, onSelect }: { id: string; pos: Vec3; view: SeatView; host: string; anim: Anim; selected: boolean; onSelect: (id: string) => void }) {
  const coreMat = useRef<THREE.MeshStandardMaterial>(null)
  const halo = useRef<THREE.Mesh>(null)
  const haloMat = useRef<THREE.MeshBasicMaterial>(null)
  const ringA = useRef<THREE.Mesh>(null)
  const ringB = useRef<THREE.Mesh>(null)
  const core = useRef<THREE.Mesh>(null)
  const roleMat = useRef<THREE.MeshBasicMaterial>(null)
  const flash = useFlash(anim, id, true)
  const base = useMemo(() => new THREE.Color(view.online && !view.jailed ? COLORS.copper : COLORS.grey), [view.online, view.jailed])
  const gold = useMemo(() => new THREE.Color(COLORS.goldHot), [])
  const green = useMemo(() => new THREE.Color(COLORS.greenHot), [])
  const tmp = useMemo(() => new THREE.Color(), [])
  useFrame((st, dt) => {
    const { k } = flash(st.clock.elapsedTime)
    const pk = anim.packer.get(id) ?? 0
    const vk = anim.voter.get(id) ?? 0
    tmp.copy(base).lerp(gold, Math.max(k, pk * 0.8))
    if (coreMat.current) {
      coreMat.current.emissive.copy(tmp)
      coreMat.current.emissiveIntensity = 0.9 + k * 2.6 + pk * 1.2
    }
    if (haloMat.current && halo.current) {
      haloMat.current.color.copy(tmp)
      haloMat.current.opacity = 0.12 + k * 0.35
      halo.current.scale.setScalar(1.2 + k * 0.5)
    }
    if (roleMat.current) {
      roleMat.current.color.copy(pk > vk ? gold : green).multiplyScalar(1.6)
      roleMat.current.opacity = Math.max(pk, vk) * 0.9
    }
    if (core.current) core.current.rotation.y += dt * 0.45
    if (ringA.current) ringA.current.rotation.z += dt * (0.3 + k * 1.6)
    if (ringB.current) ringB.current.rotation.z -= dt * (0.42 + k * 1.6)
  })
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onSelect(id)
  }
  return (
    <group position={pos}>
      <mesh position={[0, HUB_BASE_DY - 0.1, 0]} onClick={click} {...hover}>
        <cylinderGeometry args={[1.0, 1.15, 0.26, 48]} />
        <meshPhysicalMaterial color={COLORS.panel} metalness={0.75} roughness={0.32} clearcoat={0.6} clearcoatRoughness={0.3} />
      </mesh>
      <mesh position={[0, HUB_BASE_DY + 0.04, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={noRay}>
        <torusGeometry args={[0.98, 0.018, 8, 64]} />
        <meshBasicMaterial color={new THREE.Color(COLORS.copper).multiplyScalar(1.4)} toneMapped={false} />
      </mesh>
      {/* role ring: green when the hub's seat votes, gold when it packs */}
      <mesh position={[0, HUB_BASE_DY + 0.06, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={noRay}>
        <torusGeometry args={[1.12, 0.03, 8, 64]} />
        <meshBasicMaterial ref={roleMat} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, -0.95, 0]} onClick={click} {...hover}>
        <cylinderGeometry args={[0.14, 0.28, 1.4, 24]} />
        <meshPhysicalMaterial color={COLORS.steel} metalness={0.85} roughness={0.25} clearcoat={0.5} />
      </mesh>
      {[-1.3, -0.95, -0.6].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={noRay}>
          <torusGeometry args={[0.24 - (y + 1.3) * 0.08, 0.012, 6, 32]} />
          <meshBasicMaterial color={new THREE.Color(COLORS.gold).multiplyScalar(1.3)} toneMapped={false} />
        </mesh>
      ))}
      <mesh ref={core} onClick={click} {...hover}>
        <icosahedronGeometry args={[0.5, 1]} />
        <meshStandardMaterial ref={coreMat} color={COLORS.copper} metalness={0.55} roughness={0.22} flatShading toneMapped={false} />
      </mesh>
      <mesh ref={halo} raycast={noRay}>
        <sphereGeometry args={[0.56, 24, 16]} />
        <meshBasicMaterial ref={haloMat} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={ringA} rotation={[Math.PI / 2.4, 0, 0]} raycast={noRay}>
        <torusGeometry args={[0.9, 0.028, 10, 96]} />
        <meshPhysicalMaterial color={COLORS.copper} metalness={0.9} roughness={0.2} emissive={COLORS.copper} emissiveIntensity={0.45} />
      </mesh>
      <mesh ref={ringB} rotation={[Math.PI / 1.7, 0.5, 0]} raycast={noRay}>
        <torusGeometry args={[1.14, 0.016, 8, 96, Math.PI * 1.6]} />
        <meshBasicMaterial color={new THREE.Color(COLORS.gold).multiplyScalar(1.5)} toneMapped={false} />
      </mesh>
      {selected && (
        <mesh position={[0, HUB_BASE_DY, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={noRay}>
          <torusGeometry args={[1.3, 0.02, 6, 64]} />
          <meshBasicMaterial color={COLORS.cream} />
        </mesh>
      )}
      <Html position={[-1.55, -0.55, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none', transform: 'translate(-100%, -50%)' }}>
        <div className="netmap-plate netmap-plate-hub">
          <div className="netmap-plate-kicker">HUB · ARCHIVE</div>
          <div className="netmap-label-name">{id}</div>
          <div className="netmap-label-sub">{host}</div>
        </div>
      </Html>
    </group>
  )
}

/** Validator: chassis with status light, activity LEDs, lag bar, role ring and packer fill ring. */
function ValidatorUnit({ id, pos, yaw, view, host, anim, selected, onSelect }: { id: string; pos: Vec3; yaw: number; view: SeatView; host: string; anim: Anim; selected: boolean; onSelect: (id: string) => void }) {
  const light = useRef<THREE.MeshBasicMaterial>(null)
  const halo = useRef<THREE.Mesh>(null)
  const haloMat = useRef<THREE.MeshBasicMaterial>(null)
  const leds = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const ring = useRef<THREE.Mesh>(null)
  const ringMat = useRef<THREE.MeshBasicMaterial>(null)
  const role = useRef<THREE.Mesh>(null)
  const roleMat = useRef<THREE.MeshBasicMaterial>(null)
  const trim = useRef<THREE.MeshBasicMaterial>(null)
  const lid = useRef<THREE.MeshPhysicalMaterial>(null)
  const label = useRef<HTMLDivElement>(null)
  const lastFill = useRef(-1)
  const flash = useFlash(anim, id, false)
  const live = view.online && !view.jailed
  const c = useMemo(
    () => ({
      idle: new THREE.Color(live ? COLORS.idle : COLORS.grey),
      green: new THREE.Color(COLORS.greenHot).multiplyScalar(1.8),
      gold: new THREE.Color(COLORS.goldHot).multiplyScalar(2),
      dim: new THREE.Color(COLORS.steel),
      copper: new THREE.Color(COLORS.copper),
    }),
    [live],
  )
  const tmp = useMemo(() => new THREE.Color(), [])
  const lagFrac = view.lag == null ? 0 : Math.min(1, view.lag / 10)
  const lagColor = view.lag == null ? COLORS.grey : view.lag <= 1 ? COLORS.green : view.lag <= 3 ? COLORS.gold : '#EF4444'

  useFrame((st, dt) => {
    const now = st.clock.elapsedTime
    const { k, f } = flash(now)
    const vk = live ? (anim.voter.get(id) ?? 0) : 0
    const pk = live ? (anim.packer.get(id) ?? 0) : 0
    tmp.copy(c.idle).lerp(c.green, vk).lerp(c.gold, Math.max(pk, k))
    if (light.current) light.current.color.copy(tmp)
    if (lid.current) {
      lid.current.emissive.copy(tmp)
      lid.current.emissiveIntensity = live ? 0.06 + 0.22 * Math.max(vk, pk, k) : 0
    }
    if (trim.current) trim.current.color.copy(live ? (vk > 0.05 || pk > 0.05 || k > 0 ? tmp : c.copper) : c.dim)
    if (haloMat.current && halo.current) {
      const breathe = live ? 0.06 + 0.03 * Math.sin(now * 2 + pos[0]) : 0.02
      haloMat.current.color.copy(tmp)
      haloMat.current.opacity = breathe + vk * 0.3 + Math.max(pk, k) * 0.45
      halo.current.scale.setScalar(1 + vk * 0.4 + Math.max(pk, k) * 0.9)
    }
    if (role.current && roleMat.current) {
      roleMat.current.color.copy(pk > vk * 0.9 ? c.gold : c.green)
      roleMat.current.opacity = Math.max(vk, pk) * 0.85
      role.current.rotation.z += dt * (0.4 + pk)
    }
    for (let i = 0; i < 3; i++) {
      const m = leds.current[i]
      if (!m) continue
      const on = k > 0 ? Math.floor(now * 12) % 3 === i : live && (i === 0 || (vk > 0.5 && Math.floor(now * 4 + i) % 3 === 0))
      m.color.copy(on ? tmp : c.dim)
    }
    if (ring.current && ringMat.current && f) {
      if (f.fill !== lastFill.current) {
        lastFill.current = f.fill
        ring.current.geometry.dispose()
        ring.current.geometry = new THREE.TorusGeometry(0.66, 0.03, 6, RING_SEGMENTS, Math.PI * 2 * f.fill)
      }
      ringMat.current.opacity = k
      ring.current.visible = k > 0
      ring.current.rotation.z += dt * 1.2
    }
    const el = label.current
    if (el) {
      const r = pk > 0.5 ? 'pack' : vk > 0.5 ? 'vote' : ''
      if (el.dataset.role !== r) el.dataset.role = r
    }
  })

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onSelect(id)
  }

  return (
    <group position={pos} rotation={[0, yaw, 0]}>
      <mesh onClick={click} {...hover}>
        <boxGeometry args={[0.76, 0.4, 0.52]} />
        <meshPhysicalMaterial color="#1A2740" metalness={0.65} roughness={0.35} clearcoat={0.7} clearcoatRoughness={0.25} />
      </mesh>
      {/* lit edge strip along the front of the lid (role colour) */}
      <mesh position={[0, 0.2, 0.262]} raycast={noRay}>
        <boxGeometry args={[0.76, 0.018, 0.012]} />
        <meshBasicMaterial ref={trim} color={COLORS.copper} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.203, 0]} raycast={noRay}>
        <boxGeometry args={[0.7, 0.006, 0.46]} />
        <meshPhysicalMaterial ref={lid} color="#16233A" metalness={0.6} roughness={0.4} clearcoat={0.4} />
      </mesh>
      {/* status light */}
      <mesh position={[0.26, 0.27, 0.12]} raycast={noRay}>
        <sphereGeometry args={[0.06, 16, 12]} />
        <meshBasicMaterial ref={light} toneMapped={false} />
      </mesh>
      <mesh ref={halo} position={[0.26, 0.27, 0.12]} raycast={noRay}>
        <sphereGeometry args={[0.18, 16, 12]} />
        <meshBasicMaterial ref={haloMat} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[-0.25 + i * 0.1, 0.07, 0.262]} raycast={noRay}>
          <boxGeometry args={[0.06, 0.035, 0.01]} />
          <meshBasicMaterial ref={(m) => { leds.current[i] = m }} toneMapped={false} />
        </mesh>
      ))}
      <mesh position={[0, -0.07, 0.262]} raycast={noRay}>
        <boxGeometry args={[0.58, 0.03, 0.008]} />
        <meshBasicMaterial color={COLORS.steel} />
      </mesh>
      {lagFrac > 0 && (
        <mesh position={[-0.29 + 0.29 * lagFrac, -0.07, 0.267]} raycast={noRay}>
          <boxGeometry args={[0.58 * lagFrac, 0.03, 0.008]} />
          <meshBasicMaterial color={lagColor} />
        </mesh>
      )}
      <mesh ref={role} position={[0, -0.21, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={noRay}>
        <torusGeometry args={[0.56, 0.022, 8, 64]} />
        <meshBasicMaterial ref={roleMat} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={ring} position={[0, -0.21, 0]} rotation={[Math.PI / 2, 0, 0]} visible={false} raycast={noRay}>
        <torusGeometry args={[0.66, 0.03, 6, RING_SEGMENTS, 0.01]} />
        <meshBasicMaterial ref={ringMat} color={new THREE.Color(COLORS.gold).multiplyScalar(2)} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      {selected && (
        <mesh position={[0, -0.21, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={noRay}>
          <torusGeometry args={[0.46, 0.014, 6, 48]} />
          <meshBasicMaterial color={COLORS.cream} />
        </mesh>
      )}
      <Html position={[0, -0.55, 0.15]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={label} className="netmap-label" data-off={!live ? '1' : undefined}>
          <div className="netmap-label-name">{id}</div>
          {host && <div className="netmap-label-sub">{host}</div>}
        </div>
      </Html>
    </group>
  )
}

/**
 * Wallet services: a small 3D wallet (body, flap, clasp, card) floating above
 * the hub. Txs enter the network here and beam down into the hub.
 */
function WalletServices({ pos, label, sub, activated, event }: { pos: Vec3; label: string; sub: string; activated: number | null; event: PollEvent | null }) {
  const g = useRef<THREE.Group>(null)
  const clasp = useRef<THREE.MeshBasicMaterial>(null)
  const ringRef = useRef<THREE.Mesh>(null)
  const ringMat = useRef<THREE.MeshBasicMaterial>(null)
  const clock = useThree((st) => st.clock)
  const pulseAt = useRef(-10)
  const goldC = useMemo(() => new THREE.Color(COLORS.gold).multiplyScalar(1.4), [])
  const hotC = useMemo(() => new THREE.Color(COLORS.goldHot).multiplyScalar(2.6), [])
  useEffect(() => {
    if (event && event.newTxs > 0) pulseAt.current = clock.elapsedTime
  }, [event, clock])
  useFrame((st) => {
    const now = st.clock.elapsedTime
    const k = Math.max(0, 1 - (now - pulseAt.current) / 0.9)
    if (g.current) {
      g.current.position.y = pos[1] + Math.sin(now * 0.9) * 0.06
      g.current.rotation.y = Math.sin(now * 0.35) * 0.35
    }
    if (clasp.current) clasp.current.color.copy(goldC).lerp(hotC, k)
    if (ringRef.current && ringMat.current) {
      const u = 1 - k
      ringRef.current.scale.setScalar(1 + u * 1.2)
      ringMat.current.opacity = k * 0.7
    }
  })
  return (
    <group>
      <group ref={g} position={pos} scale={1.35}>
        {/* body */}
        <RoundedBox args={[1.25, 0.82, 0.26]} radius={0.09} smoothness={4} raycast={noRay}>
          <meshPhysicalMaterial color="#7A4822" metalness={0.2} roughness={0.5} emissive="#3A1E0A" emissiveIntensity={0.35} clearcoat={0.6} clearcoatRoughness={0.35} sheen={0.4} sheenColor="#C07838" />
        </RoundedBox>
        {/* card peeking out of the top */}
        <mesh position={[-0.12, 0.42, -0.02]} rotation={[0, 0, 0.06]} raycast={noRay}>
          <boxGeometry args={[0.78, 0.22, 0.03]} />
          <meshPhysicalMaterial color="#E0DBCA" metalness={0.3} roughness={0.3} clearcoat={1} />
        </mesh>
        <mesh position={[-0.12, 0.47, -0.003]} rotation={[0, 0, 0.06]} raycast={noRay}>
          <boxGeometry args={[0.7, 0.03, 0.005]} />
          <meshBasicMaterial color={COLORS.copper} />
        </mesh>
        {/* flap */}
        <RoundedBox args={[0.5, 0.36, 0.08]} radius={0.05} smoothness={3} position={[0.42, 0.02, 0.15]} raycast={noRay}>
          <meshPhysicalMaterial color="#734522" metalness={0.15} roughness={0.5} clearcoat={0.7} />
        </RoundedBox>
        {/* clasp: glows when txs enter */}
        <mesh position={[0.5, 0.02, 0.2]} rotation={[Math.PI / 2, 0, 0]} raycast={noRay}>
          <cylinderGeometry args={[0.06, 0.06, 0.03, 24]} />
          <meshBasicMaterial ref={clasp} toneMapped={false} />
        </mesh>
      </group>
      {/* emitter ring under the wallet, pulsing on each new batch of txs */}
      <mesh ref={ringRef} position={[pos[0], pos[1] - 0.65, pos[2]]} rotation={[Math.PI / 2, 0, 0]} raycast={noRay}>
        <torusGeometry args={[0.32, 0.012, 6, 48]} />
        <meshBasicMaterial ref={ringMat} color={hotC} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      <Html position={[pos[0] + 1.25, pos[1] + 0.1, pos[2]]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none', transform: 'translate(0, -50%)' }}>
        <div className="netmap-plate netmap-plate-wallet">
          <div className="netmap-plate-kicker">{label.toUpperCase()}</div>
          <div className="netmap-label-name">{activated == null ? '—' : activated.toLocaleString('en-US')} activated wallets</div>
          <div className="netmap-label-sub">{sub}</div>
        </div>
      </Html>
    </group>
  )
}

// ── Location platforms ─────────────────────────────────────────────────────

function Platform({ center, width, yaw, label, confirmed }: { center: Vec3; width: number; yaw: number; label: string; confirmed: boolean }) {
  const edge = confirmed ? COLORS.copper : COLORS.grey
  return (
    <group position={center} rotation={[0, yaw, 0]}>
      <mesh raycast={noRay}>
        <boxGeometry args={[width * 2, 0.07, 1.2]} />
        <meshPhysicalMaterial color={COLORS.panel} metalness={0.4} roughness={0.55} clearcoat={0.3} transparent opacity={0.92} />
      </mesh>
      <mesh position={[0, 0.04, 0.6]} raycast={noRay}>
        <boxGeometry args={[width * 2, 0.012, 0.012]} />
        <meshBasicMaterial color={new THREE.Color(edge).multiplyScalar(1.3)} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.04, -0.6]} raycast={noRay}>
        <boxGeometry args={[width * 2, 0.008, 0.008]} />
        <meshBasicMaterial color={edge} transparent opacity={0.5} />
      </mesh>
      <Html position={[0, -0.12, 1.0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className="netmap-loc">
          {label}
        </div>
      </Html>
    </group>
  )
}

// ── Background ─────────────────────────────────────────────────────────────

function Stars() {
  const geo = useMemo(() => {
    const n = 900
    const p = new Float32Array(n * 3)
    let s = 7
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < n; i++) {
      const r = 45 + rnd() * 30
      const th = rnd() * Math.PI * 2
      const ph = Math.acos(2 * rnd() - 1)
      p[i * 3] = r * Math.sin(ph) * Math.cos(th)
      p[i * 3 + 1] = r * Math.cos(ph)
      p[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    return g
  }, [])
  return (
    <points geometry={geo}>
      <pointsMaterial color={COLORS.cream} size={0.1} sizeAttenuation transparent opacity={0.45} depthWrite={false} />
    </points>
  )
}

function Floor() {
  return (
    <group position={[0, -2.3, -2.5]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={noRay}>
        <circleGeometry args={[17, 96]} />
        <meshStandardMaterial color="#030A1C" metalness={0.3} roughness={0.9} transparent opacity={0.85} />
      </mesh>
      <gridHelper args={[34, 34, '#0E2033', '#0A1626']} position={[0, 0.005, 0]} />
    </group>
  )
}

function FpsMeter({ target }: { target?: React.MutableRefObject<HTMLSpanElement | null> }) {
  const acc = useRef({ n: 0, t: 0 })
  useFrame((_, dt) => {
    const a = acc.current
    a.n++
    a.t += dt
    if (a.t >= 0.5) {
      if (target?.current) target.current.textContent = `${Math.round(a.n / a.t)} fps`
      a.n = 0
      a.t = 0
    }
  })
  return null
}

function AnimDriver({ event, anim, layout }: { event: PollEvent | null; anim: Anim; layout: MapLayout }) {
  const clock = useThree((st) => st.clock)
  const recentMax = useRef(0)
  useEffect(() => {
    if (!event) return
    const now = clock.elapsedTime
    for (const b of event.blocks) if (b.txs != null) recentMax.current = Math.max(recentMax.current * 0.98, b.txs)
    const tip = event.blocks[event.blocks.length - 1]
    for (const b of event.blocks) {
      if (!b.packer || b.packer === layout.hub.id) continue
      anim.flash.set(b.packer, { t: now - (b === tip ? 0 : 0.4), fill: ringFill(b.txs ?? 0, recentMax.current) })
    }
  }, [event, anim, layout.hub.id, clock])
  return null
}

// ── Scene ──────────────────────────────────────────────────────────────────

export default function NetworkScene({ layout, seats, event, maxBulges, selected, onSelect, fpsRef, watchers, consensus, walletCount, tps }: SceneProps) {
  const anim = useRef<Anim>({ flash: new Map(), hubFlash: -10, voter: new Map(), packer: new Map() }).current
  const [fx, setFx] = useState(true)
  const [dpr, setDpr] = useState(1.5)
  const curves = useMemo(() => {
    const m = new Map<string, THREE.Curve<THREE.Vector3>>()
    for (const s of layout.seats) m.set(s.id, pipeCurve(layout.hub.pos, s.pos))
    return m
  }, [layout])
  const walletCurve = useMemo(() => {
    if (!layout.wallet) return null
    // Straight down the hub axis: wallet underside → through the watcher ring's empty centre → top of the hub core.
    const w = layout.wallet.pos
    const h = layout.hub.pos
    return new THREE.LineCurve3(new THREE.Vector3(w[0], w[1] - 0.62, w[2]), new THREE.Vector3(h[0], h[1] + HUB_CORE_TOP_DY, h[2]))
  }, [layout])

  const hubView = seats[layout.hub.id] ?? { online: false, jailed: false, lag: null }
  return (
    <Canvas
      dpr={dpr}
      camera={{ position: [-1.4, 10.5, 27], fov: 40, near: 0.1, far: 200 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={() => undefined}
    >
      <PerformanceMonitor
        onDecline={() => {
          setDpr(1)
          setFx(false)
        }}
        onIncline={() => setDpr(1.5)}
      />
      <color attach="background" args={[COLORS.bg]} />
      <fog attach="fog" args={[COLORS.bg, 26, 62]} />
      <ambientLight intensity={0.22} />
      <hemisphereLight args={['#C9D6FF', '#140A04', 0.35]} />
      <directionalLight position={[6, 12, 8]} intensity={1.1} color={COLORS.cream} />
      <pointLight position={[0, 6.5, -2.5]} intensity={22} distance={18} color={COLORS.copper} />
      <Environment resolution={64} frames={1}>
        <Lightformer form="rect" intensity={1.4} color="#E0DBCA" position={[0, 6, 6]} scale={[10, 2, 1]} />
        <Lightformer form="rect" intensity={0.8} color="#C07838" position={[-8, 2, -2]} scale={[2, 6, 1]} />
        <Lightformer form="ring" intensity={0.6} color="#4ADE80" position={[8, 1, 2]} scale={2} />
      </Environment>
      <Stars />
      <Floor />
      <AnimDriver event={event} anim={anim} layout={layout} />
      {layout.groups.map((g) => (
        <Platform key={g.id} center={g.center} width={g.width} yaw={g.yaw} label={g.label} confirmed={g.confirmed} />
      ))}
      <ConsensusRail layout={layout} />
      {layout.seats.map((s) => {
        const v = seats[s.id]
        return <Pipe key={`p-${s.id}`} curve={curves.get(s.id)!} active={Boolean(v?.online && !v.jailed)} />
      })}
      {walletCurve && <Pipe curve={walletCurve} active radius={0.03} />}
      {layout.wallet && <WalletServices pos={layout.wallet.pos} label={layout.wallet.label} sub={layout.wallet.sub} activated={walletCount ?? null} event={event} />}
      {watchers && (
        <WatcherRing center={layout.hub.pos} epoch={watchers.epoch} live={watchers.live} cap={watchers.cap} event={watchers.event} />
      )}
      <Bulges curves={curves} ingress={walletCurve} event={event} cap={maxBulges} seats={seats} tps={tps ?? null} />
      {consensus && <ConsensusCycle layout={layout} curves={curves} view={consensus} event={event} anim={anim} />}
      <HubTower id={layout.hub.id} pos={layout.hub.pos} view={hubView} host={layout.hub.host} anim={anim} selected={selected === layout.hub.id} onSelect={onSelect} />
      {layout.seats.map((s) => (
        <ValidatorUnit
          key={s.id}
          id={s.id}
          pos={s.pos}
          yaw={s.yaw}
          view={seats[s.id] ?? { online: false, jailed: false, lag: null }}
          host={s.host}
          anim={anim}
          selected={selected === s.id}
          onSelect={onSelect}
        />
      ))}
      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.06}
        minDistance={9}
        maxDistance={38}
        maxPolarAngle={Math.PI * 0.6}
        target={[-1.4, 0.9, -1.5]}
        autoRotate
        autoRotateSpeed={0.1}
      />
      {fx && (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur luminanceThreshold={0.85} luminanceSmoothing={0.2} intensity={0.85} radius={0.7} />
          <Vignette eskil={false} offset={0.25} darkness={0.55} />
        </EffectComposer>
      )}
      <FpsMeter target={fpsRef} />
    </Canvas>
  )
}
