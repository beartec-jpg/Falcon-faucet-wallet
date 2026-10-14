'use client'

import { memo, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { MapLayout, Vec3 } from '@/lib/netmap-layout'
import { bulgeCount, ringFill } from '@/lib/netmap-layout'
import type { PollEvent } from '@/hooks/useNetworkFeed'
import WatcherRing, { type WatcherRingEvent } from '@/components/netmap/WatcherRing'

export const COLORS = {
  copper: '#C07838',
  gold: '#D4922A',
  bg: '#020617',
  panel: '#0F172A',
  cream: '#E0DBCA',
  green: '#22C55E',
  grey: '#475569',
  red: '#7F1D1D',
}

export interface SeatView {
  online: boolean
  jailed: boolean
  lag: number | null
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
}

const FLASH_S = 1.4
const BULGE_S = 1.1

/** Shared, mutable animation state read inside useFrame (no React renders per frame). */
interface Anim {
  flash: Map<string, { t: number; fill: number }>
  hubFlash: number
}

function curveFor(a: Vec3, b: Vec3): THREE.QuadraticBezierCurve3 {
  const va = new THREE.Vector3(...a)
  const vb = new THREE.Vector3(...b)
  const ctrl = new THREE.Vector3(vb.x * 0.55, (va.y + vb.y) * 0.5 + 0.6, (va.z + vb.z) * 0.5 + 0.8)
  return new THREE.QuadraticBezierCurve3(va, ctrl, vb)
}

// ── Pipes ──────────────────────────────────────────────────────────────────

const Pipe = memo(function Pipe({ curve, active }: { curve: THREE.Curve<THREE.Vector3>; active: boolean }) {
  const geo = useMemo(() => new THREE.TubeGeometry(curve, 48, 0.045, 6, false), [curve])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <mesh geometry={geo}>
      <meshBasicMaterial
        color={active ? COLORS.copper : COLORS.grey}
        transparent
        opacity={active ? 0.55 : 0.18}
        depthWrite={false}
      />
    </mesh>
  )
})

// ── Bulges (transactions) ──────────────────────────────────────────────────

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
}: {
  curves: Map<string, THREE.Curve<THREE.Vector3>>
  ingress: THREE.Curve<THREE.Vector3> | null
  event: PollEvent | null
  cap: number
}) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const live = useRef<Bulge[]>([])
  const clock = useThree((st) => st.clock)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const tmp = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    if (!event) return
    const now = clock.elapsedTime
    const list = live.current
    const push = (curve: THREE.Curve<THREE.Vector3>, n: number, spread: number, size: number) => {
      for (let i = 0; i < n && list.length < cap; i++) {
        list.push({ curve, start: now + (i / Math.max(1, n)) * spread, size })
      }
    }
    // Ingress: everything sealed since the last poll entered via the loadgen box.
    if (ingress) push(ingress, bulgeCount(event.newTxs, 16), 0.8, 1)
    // Down the pipe of each block's packer, sized by that block's txs.
    const per = event.blocks.length ? event.newTxs / event.blocks.length : 0
    event.blocks.forEach((b, i) => {
      const c = b.packer ? curves.get(b.packer) : undefined
      if (!c) return
      const txs = b.txs ?? per
      push(c, bulgeCount(txs, 10), 0.6, 1 + Math.min(1, txs / 150))
      void i
    })
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
      if (u < 0) {
        dummy.scale.setScalar(0)
      } else {
        b.curve.getPointAt(u, tmp)
        dummy.position.copy(tmp)
        dummy.scale.setScalar(0.09 * b.size * (0.7 + 0.6 * Math.sin(Math.PI * u)))
      }
      dummy.updateMatrix()
      m.setMatrixAt(w - 1, dummy.matrix)
    }
    list.length = w
    m.count = w
    m.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, cap]} frustumCulled={false}>
      <sphereGeometry args={[1, 10, 8]} />
      <meshBasicMaterial color={COLORS.gold} toneMapped={false} />
    </instancedMesh>
  )
}

// ── Seats ──────────────────────────────────────────────────────────────────

const RING_SEGMENTS = 48

function useFlash(anim: Anim, id: string, isHub: boolean) {
  return (now: number) => {
    const f = isHub ? { t: anim.hubFlash, fill: 0 } : anim.flash.get(id)
    const age = f ? now - f.t : Infinity
    return { k: age >= 0 && age < FLASH_S ? 1 - age / FLASH_S : 0, f }
  }
}

const hover = {
  onPointerOver: () => (document.body.style.cursor = 'pointer'),
  onPointerOut: () => (document.body.style.cursor = ''),
}
const noRay = () => null

/** Hub: a tower with a plinth, column, glowing core and two counter-rotating rings. */
function HubTower({
  id,
  pos,
  view,
  host,
  anim,
  selected,
  onSelect,
}: {
  id: string
  pos: Vec3
  view: SeatView
  host: string
  anim: Anim
  selected: boolean
  onSelect: (id: string) => void
}) {
  const coreMat = useRef<THREE.MeshStandardMaterial>(null)
  const halo = useRef<THREE.Mesh>(null)
  const haloMat = useRef<THREE.MeshBasicMaterial>(null)
  const ringA = useRef<THREE.Mesh>(null)
  const ringB = useRef<THREE.Mesh>(null)
  const core = useRef<THREE.Mesh>(null)
  const flash = useFlash(anim, id, true)
  const base = useMemo(() => new THREE.Color(view.online && !view.jailed ? COLORS.copper : COLORS.grey), [view.online, view.jailed])
  const gold = useMemo(() => new THREE.Color(COLORS.gold), [])
  const tmp = useMemo(() => new THREE.Color(), [])
  useFrame((st, dt) => {
    const { k } = flash(st.clock.elapsedTime)
    tmp.copy(base).lerp(gold, k)
    if (coreMat.current) {
      coreMat.current.emissive.copy(tmp)
      coreMat.current.emissiveIntensity = 0.7 + k * 1.4
    }
    if (haloMat.current && halo.current) {
      haloMat.current.color.copy(tmp)
      haloMat.current.opacity = 0.16 + k * 0.3
      halo.current.scale.setScalar(1.25 + k * 0.4)
    }
    if (core.current) core.current.rotation.y += dt * 0.5
    if (ringA.current) ringA.current.rotation.z += dt * (0.35 + k * 2)
    if (ringB.current) ringB.current.rotation.z -= dt * (0.5 + k * 2)
  })
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onSelect(id)
  }
  return (
    <group position={pos}>
      {/* plinth + column */}
      <mesh position={[0, -1.85, 0]} onClick={click} {...hover}>
        <cylinderGeometry args={[0.95, 1.1, 0.28, 6]} />
        <meshStandardMaterial color={COLORS.panel} metalness={0.6} roughness={0.4} emissive={COLORS.copper} emissiveIntensity={0.08} />
      </mesh>
      <mesh position={[0, -1.69, 0]} raycast={noRay}>
        <torusGeometry args={[0.98, 0.025, 6, 6]} />
        <meshBasicMaterial color={COLORS.copper} />
      </mesh>
      <mesh position={[0, -1.0, 0]} onClick={click} {...hover}>
        <cylinderGeometry args={[0.16, 0.3, 1.45, 8]} />
        <meshStandardMaterial color="#1E293B" metalness={0.7} roughness={0.35} />
      </mesh>
      {[-1.35, -0.95, -0.55].map((y) => (
        <mesh key={y} position={[0, y, 0]} raycast={noRay}>
          <torusGeometry args={[0.24 - (y + 1.35) * 0.08, 0.018, 6, 16]} />
          <meshBasicMaterial color={COLORS.gold} />
        </mesh>
      ))}
      {/* core */}
      <mesh ref={core} onClick={click} {...hover}>
        <icosahedronGeometry args={[0.5, 1]} />
        <meshStandardMaterial ref={coreMat} color={COLORS.copper} metalness={0.5} roughness={0.25} flatShading />
      </mesh>
      <mesh ref={halo} raycast={noRay}>
        <sphereGeometry args={[0.55, 16, 12]} />
        <meshBasicMaterial ref={haloMat} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={ringA} rotation={[Math.PI / 2.4, 0, 0]} raycast={noRay}>
        <torusGeometry args={[0.92, 0.035, 8, 64]} />
        <meshStandardMaterial color={COLORS.copper} metalness={0.8} roughness={0.3} emissive={COLORS.copper} emissiveIntensity={0.35} />
      </mesh>
      <mesh ref={ringB} rotation={[Math.PI / 1.7, 0.5, 0]} raycast={noRay}>
        <torusGeometry args={[1.18, 0.022, 8, 64, Math.PI * 1.6]} />
        <meshBasicMaterial color={COLORS.gold} />
      </mesh>
      {selected && (
        <mesh position={[0, -1.7, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={noRay}>
          <torusGeometry args={[1.25, 0.025, 6, 48]} />
          <meshBasicMaterial color={COLORS.cream} />
        </mesh>
      )}
      <Html position={[0, -2.35, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div className="netmap-plate netmap-plate-hub">
          <div className="netmap-plate-kicker">HUB</div>
          <div className="netmap-label-name">{id}</div>
          <div className="netmap-label-sub">{host}</div>
        </div>
      </Html>
    </group>
  )
}


/** Validator: a small chassis with a status light, activity LEDs, lag bar and a packer ring. */
function ValidatorUnit({
  id,
  pos,
  view,
  host,
  location,
  confirmed,
  anim,
  selected,
  onSelect,
}: {
  id: string
  pos: Vec3
  view: SeatView
  host: string
  location: string
  confirmed: boolean
  anim: Anim
  selected: boolean
  onSelect: (id: string) => void
}) {
  const light = useRef<THREE.MeshBasicMaterial>(null)
  const halo = useRef<THREE.Mesh>(null)
  const haloMat = useRef<THREE.MeshBasicMaterial>(null)
  const leds = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const ring = useRef<THREE.Mesh>(null)
  const ringMat = useRef<THREE.MeshBasicMaterial>(null)
  const trim = useRef<THREE.MeshBasicMaterial>(null)
  const lastFill = useRef(-1)
  const flash = useFlash(anim, id, false)
  const live = view.online && !view.jailed
  const base = useMemo(() => new THREE.Color(live ? COLORS.green : view.jailed ? '#64748B' : COLORS.grey), [live, view.jailed])
  const gold = useMemo(() => new THREE.Color(COLORS.gold), [])
  const dim = useMemo(() => new THREE.Color('#1E293B'), [])
  const tmp = useMemo(() => new THREE.Color(), [])
  const lagFrac = view.lag == null ? 0 : Math.min(1, view.lag / 10)
  const lagColor = view.lag == null ? COLORS.grey : view.lag <= 1 ? COLORS.green : view.lag <= 3 ? COLORS.gold : '#EF4444'

  useFrame((st, dt) => {
    const now = st.clock.elapsedTime
    const { k, f } = flash(now)
    tmp.copy(base).lerp(gold, k)
    if (light.current) light.current.color.copy(tmp)
    if (trim.current) trim.current.color.copy(k > 0 ? tmp : live ? base : dim)
    if (haloMat.current && halo.current) {
      const pulse = live ? 0.22 + 0.08 * Math.sin(now * 2.4 + pos[0]) : 0.04
      haloMat.current.color.copy(tmp)
      haloMat.current.opacity = pulse + k * 0.5
      halo.current.scale.setScalar(1 + k * 1.2)
    }
    // Activity LEDs: chase while this seat's block flash is active, idle glow when online.
    for (let i = 0; i < 3; i++) {
      const m = leds.current[i]
      if (!m) continue
      const on = k > 0 ? Math.floor(now * 12) % 3 === i : live && i === 0
      m.color.copy(on ? (k > 0 ? gold : base) : dim)
    }
    if (ring.current && ringMat.current && f) {
      if (f.fill !== lastFill.current) {
        lastFill.current = f.fill
        ring.current.geometry.dispose()
        ring.current.geometry = new THREE.TorusGeometry(0.62, 0.04, 6, RING_SEGMENTS, Math.PI * 2 * f.fill)
      }
      ringMat.current.opacity = k
      ring.current.visible = k > 0
      ring.current.rotation.z += dt * 1.5
    }
  })

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onSelect(id)
  }

  return (
    <group position={pos}>
      {/* chassis */}
      <mesh onClick={click} {...hover}>
        <boxGeometry args={[0.72, 0.4, 0.5]} />
        <meshStandardMaterial color={COLORS.panel} metalness={0.55} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.205, 0]} raycast={noRay}>
        <boxGeometry args={[0.74, 0.02, 0.52]} />
        <meshBasicMaterial ref={trim} color={COLORS.copper} />
      </mesh>
      {/* status light */}
      <mesh position={[0.22, 0.29, 0.1]} raycast={noRay}>
        <sphereGeometry args={[0.075, 12, 10]} />
        <meshBasicMaterial ref={light} toneMapped={false} />
      </mesh>
      <mesh ref={halo} position={[0.22, 0.29, 0.1]} raycast={noRay}>
        <sphereGeometry args={[0.2, 12, 10]} />
        <meshBasicMaterial ref={haloMat} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* activity LEDs on the front face */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[-0.24 + i * 0.1, 0.06, 0.256]} raycast={noRay}>
          <boxGeometry args={[0.06, 0.04, 0.01]} />
          <meshBasicMaterial ref={(m) => { leds.current[i] = m }} toneMapped={false} />
        </mesh>
      ))}
      {/* lag bar: empty = in sync, full = 10+ blocks behind */}
      <mesh position={[0, -0.08, 0.256]} raycast={noRay}>
        <boxGeometry args={[0.56, 0.035, 0.008]} />
        <meshBasicMaterial color="#1E293B" />
      </mesh>
      {lagFrac > 0 && (
        <mesh position={[-0.28 + 0.28 * lagFrac, -0.08, 0.261]} raycast={noRay}>
          <boxGeometry args={[0.56 * lagFrac, 0.035, 0.008]} />
          <meshBasicMaterial color={lagColor} />
        </mesh>
      )}
      <mesh ref={ring} position={[0, -0.22, 0]} rotation={[Math.PI / 2, 0, 0]} visible={false} raycast={noRay}>
        <torusGeometry args={[0.62, 0.04, 6, RING_SEGMENTS, 0.01]} />
        <meshBasicMaterial ref={ringMat} color={COLORS.gold} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      {selected && (
        <mesh position={[0, -0.22, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={noRay}>
          <torusGeometry args={[0.5, 0.018, 6, 48]} />
          <meshBasicMaterial color={COLORS.cream} />
        </mesh>
      )}
      <Html position={[0, -0.52, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div className="netmap-label" data-off={!live ? '1' : undefined}>
          <div className="netmap-label-name">{id}</div>
          <div className="netmap-tag" data-todo={confirmed ? undefined : '1'}>{location}</div>
          {host && <div className="netmap-label-sub">{host}</div>}
        </div>
      </Html>
    </group>
  )
}

/** Loadgen / ingress: a funnel with emitter rings that pulse when new txs are sealed. */
function LoadgenNode({ pos, label, event }: { pos: Vec3; label: string; event: PollEvent | null }) {
  const rings = useRef<(THREE.Mesh | null)[]>([])
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const clock = useThree((st) => st.clock)
  const pulseAt = useRef(-10)
  useEffect(() => {
    if (event && event.newTxs > 0) pulseAt.current = clock.elapsedTime
  }, [event, clock])
  useFrame((st) => {
    const age = st.clock.elapsedTime - pulseAt.current
    for (let i = 0; i < 2; i++) {
      const u = Math.max(0, Math.min(1, (age - i * 0.15) / 0.9))
      const r = rings.current[i]
      const m = mats.current[i]
      if (!r || !m) continue
      r.scale.setScalar(1 + u * 1.6)
      m.opacity = u < 1 ? (1 - u) * 0.8 : 0
    }
  })
  return (
    <group position={pos}>
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.38, 0.12, 0.45, 12, 1, true]} />
        <meshStandardMaterial color={COLORS.panel} emissive={COLORS.gold} emissiveIntensity={0.35} metalness={0.6} roughness={0.35} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.33, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.38, 0.025, 6, 32]} />
        <meshBasicMaterial color={COLORS.gold} />
      </mesh>
      <mesh position={[0, -0.18, 0]}>
        <boxGeometry args={[0.55, 0.12, 0.55]} />
        <meshStandardMaterial color="#1E293B" metalness={0.6} roughness={0.4} />
      </mesh>
      {[0, 1].map((i) => (
        <mesh key={i} ref={(m) => { rings.current[i] = m }} position={[0, 0.33, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.38, 0.015, 6, 32]} />
          <meshBasicMaterial ref={(m) => { mats.current[i] = m }} color={COLORS.gold} transparent opacity={0} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
      <Html position={[0, -0.5, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className="netmap-plate netmap-plate-ingress">
          <div className="netmap-plate-kicker">INGRESS · LOADGEN</div>
          <div className="netmap-label-sub">{label}</div>
        </div>
      </Html>
    </group>
  )
}

// ── Location platforms ─────────────────────────────────────────────────────

function Platform({ center, width, yaw, label, confirmed }: { center: Vec3; width: number; yaw: number; label: string; confirmed: boolean }) {
  return (
    <group position={center} rotation={[0, yaw, 0]}>
      <mesh>
        <boxGeometry args={[width * 2, 0.08, 1.3]} />
        <meshStandardMaterial color={COLORS.panel} emissive={confirmed ? COLORS.copper : COLORS.grey} emissiveIntensity={0.12} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.045, 0.66]}>
        <boxGeometry args={[width * 2, 0.02, 0.02]} />
        <meshBasicMaterial color={confirmed ? COLORS.copper : COLORS.grey} />
      </mesh>
      <Html position={[0, -0.3, 1.05]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className="netmap-loc">
          {label}
          {!confirmed && <span className="netmap-todo">TODO confirm</span>}
        </div>
      </Html>
    </group>
  )
}

// ── Background ─────────────────────────────────────────────────────────────

function Stars() {
  const geo = useMemo(() => {
    const n = 700
    const p = new Float32Array(n * 3)
    let s = 7
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < n; i++) {
      const r = 40 + rnd() * 30
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
      <pointsMaterial color={COLORS.cream} size={0.12} sizeAttenuation transparent opacity={0.5} depthWrite={false} />
    </points>
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
    anim.hubFlash = now
    for (const b of event.blocks) {
      if (b.txs != null) recentMax.current = Math.max(recentMax.current * 0.98, b.txs)
    }
    const tip = event.blocks[event.blocks.length - 1]
    for (const b of event.blocks) {
      if (!b.packer) continue
      const key = b.packer === layout.hub.id ? '__hub__' : b.packer
      if (key === '__hub__') continue
      anim.flash.set(b.packer, { t: now - (b === tip ? 0 : 0.4), fill: ringFill(b.txs ?? 0, recentMax.current) })
    }
  }, [event, anim, layout.hub.id, clock])
  return null
}

// ── Scene ──────────────────────────────────────────────────────────────────

export default function NetworkScene({ layout, seats, event, maxBulges, selected, onSelect, fpsRef, watchers }: SceneProps) {
  const anim = useRef<Anim>({ flash: new Map(), hubFlash: -10 }).current
  const curves = useMemo(() => {
    const m = new Map<string, THREE.Curve<THREE.Vector3>>()
    for (const s of layout.seats) m.set(s.id, curveFor(layout.hub.pos, s.pos))
    return m
  }, [layout])
  const ingressCurve = useMemo(() => {
    if (!layout.ingress) return null
    const seat = layout.seats.find((s) => s.id === layout.ingress!.seat)
    if (!seat) return null
    const a = new THREE.Vector3(...layout.ingress.pos)
    const b = new THREE.Vector3(...seat.pos)
    const c = new THREE.Vector3(...layout.hub.pos)
    // loadgen → ingress seat → hub
    return new THREE.CatmullRomCurve3([a, b.clone().add(new THREE.Vector3(0, 0.1, 0)), new THREE.Vector3(b.x * 0.6, (b.y + c.y) * 0.5, (b.z + c.z) * 0.5 + 1.2), c])
  }, [layout])

  const hubView = seats[layout.hub.id] ?? { online: false, jailed: false, lag: null }
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 8.5, 21], fov: 42, near: 0.1, far: 200 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={() => undefined}
    >
      <color attach="background" args={[COLORS.bg]} />
      <fog attach="fog" args={[COLORS.bg, 22, 60]} />
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 9, 4]} intensity={60} color={COLORS.cream} />
      <pointLight position={[-10, 2, 8]} intensity={25} color={COLORS.copper} />
      <Stars />
      <AnimDriver event={event} anim={anim} layout={layout} />
      {layout.groups.map((g) => (
        <Platform key={g.id} center={g.center} width={g.width} yaw={g.yaw} label={g.label} confirmed={g.confirmed} />
      ))}
      {layout.seats.map((s) => {
        const v = seats[s.id]
        return <Pipe key={`p-${s.id}`} curve={curves.get(s.id)!} active={Boolean(v?.online && !v.jailed)} />
      })}
      {ingressCurve && <Pipe curve={ingressCurve} active />}
      {layout.ingress && <LoadgenNode pos={layout.ingress.pos} label={layout.ingress.label} event={event} />}
      {watchers && (
        <WatcherRing center={layout.hub.pos} epoch={watchers.epoch} live={watchers.live} cap={watchers.cap} event={watchers.event} />
      )}
      <Bulges curves={curves} ingress={ingressCurve} event={event} cap={maxBulges} />
      <HubTower
        id={layout.hub.id}
        pos={layout.hub.pos}
        view={hubView}
        host={layout.hub.host}
        anim={anim}
        selected={selected === layout.hub.id}
        onSelect={onSelect}
      />
      {layout.seats.map((s) => (
        <ValidatorUnit
          key={s.id}
          id={s.id}
          pos={s.pos}
          view={seats[s.id] ?? { online: false, jailed: false, lag: null }}
          host={s.host}
          location={s.locationLabel}
          confirmed={s.confirmed}
          anim={anim}
          selected={selected === s.id}
          onSelect={onSelect}
        />
      ))}
      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={8}
        maxDistance={34}
        maxPolarAngle={Math.PI * 0.62}
        target={[0, 0.9, -2.5]}
        autoRotate
        autoRotateSpeed={0.12}
      />
      <FpsMeter target={fpsRef} />
    </Canvas>
  )
}
