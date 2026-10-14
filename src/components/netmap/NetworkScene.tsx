'use client'

import { memo, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { MapLayout, Vec3 } from '@/lib/netmap-layout'
import { bulgeCount, ringFill } from '@/lib/netmap-layout'
import type { PollEvent } from '@/hooks/useNetworkFeed'

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

function SeatNode({
  id,
  pos,
  view,
  label,
  sub,
  anim,
  selected,
  onSelect,
  isHub,
}: {
  id: string
  pos: Vec3
  view: SeatView
  label: string
  sub: string
  anim: Anim
  selected: boolean
  onSelect: (id: string) => void
  isHub?: boolean
}) {
  const core = useRef<THREE.Mesh>(null)
  const halo = useRef<THREE.Mesh>(null)
  const ring = useRef<THREE.Mesh>(null)
  const coreMat = useRef<THREE.MeshStandardMaterial>(null)
  const haloMat = useRef<THREE.MeshBasicMaterial>(null)
  const ringMat = useRef<THREE.MeshBasicMaterial>(null)
  const lastFill = useRef(-1)
  const t = useRef(0)
  const base = useMemo(
    () => new THREE.Color(view.jailed || !view.online ? COLORS.grey : isHub ? COLORS.copper : COLORS.green),
    [view.jailed, view.online, isHub],
  )
  const gold = useMemo(() => new THREE.Color(COLORS.gold), [])
  const tmp = useMemo(() => new THREE.Color(), [])
  const r = isHub ? 0.62 : 0.36

  useFrame((st, dt) => {
    t.current = st.clock.elapsedTime
    const f = isHub ? { t: anim.hubFlash, fill: 0 } : anim.flash.get(id)
    const age = f ? t.current - f.t : Infinity
    const k = age >= 0 && age < FLASH_S ? 1 - age / FLASH_S : 0
    tmp.copy(base).lerp(gold, k)
    if (coreMat.current) {
      coreMat.current.color.copy(tmp)
      coreMat.current.emissive.copy(tmp)
      coreMat.current.emissiveIntensity = (view.online ? 0.55 : 0.08) + k * 1.6
    }
    if (haloMat.current && halo.current) {
      const pulse = view.online && !view.jailed ? 0.5 + 0.12 * Math.sin(t.current * 2.4 + pos[0]) : 0.08
      haloMat.current.color.copy(tmp)
      haloMat.current.opacity = Math.min(0.7, pulse * 0.3 + k * (isHub ? 0.25 : 0.45))
      halo.current.scale.setScalar((isHub ? 1.35 : 1.6) + k * 0.6)
    }
    if (core.current && isHub) core.current.rotation.y += dt * 0.4
    if (ring.current && ringMat.current && f && !isHub) {
      if (f.fill !== lastFill.current) {
        lastFill.current = f.fill
        ring.current.geometry.dispose()
        ring.current.geometry = new THREE.TorusGeometry(r * 1.9, 0.045, 6, RING_SEGMENTS, Math.PI * 2 * f.fill)
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
      <mesh ref={core} onClick={click} onPointerOver={() => (document.body.style.cursor = 'pointer')} onPointerOut={() => (document.body.style.cursor = '')}>
        {isHub ? <icosahedronGeometry args={[r, 1]} /> : <sphereGeometry args={[r, 24, 16]} />}
        <meshStandardMaterial ref={coreMat} roughness={0.35} metalness={0.4} flatShading={isHub} />
      </mesh>
      <mesh ref={halo} raycast={() => null}>
        <sphereGeometry args={[r, 16, 12]} />
        <meshBasicMaterial ref={haloMat} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {!isHub && (
        <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]} visible={false} raycast={() => null}>
          <torusGeometry args={[r * 1.9, 0.045, 6, RING_SEGMENTS, 0.01]} />
          <meshBasicMaterial ref={ringMat} color={COLORS.gold} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      {selected && (
        <mesh rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
          <torusGeometry args={[r * 1.45, 0.02, 6, 48]} />
          <meshBasicMaterial color={COLORS.cream} />
        </mesh>
      )}
      <Html position={[0, -(r + 0.32), 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div className="netmap-label" data-off={!view.online || view.jailed ? '1' : undefined}>
          <div className="netmap-label-name">{label}</div>
          <div className="netmap-label-sub">{sub}</div>
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

export default function NetworkScene({ layout, seats, event, maxBulges, selected, onSelect, fpsRef }: SceneProps) {
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
      {layout.ingress && (
        <group position={layout.ingress.pos}>
          <mesh>
            <boxGeometry args={[0.5, 0.3, 0.5]} />
            <meshStandardMaterial color={COLORS.panel} emissive={COLORS.gold} emissiveIntensity={0.4} />
          </mesh>
          <Html position={[0, -0.45, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
            <div className="netmap-label">
              <div className="netmap-label-sub">{layout.ingress.label}</div>
            </div>
          </Html>
        </group>
      )}
      <Bulges curves={curves} ingress={ingressCurve} event={event} cap={maxBulges} />
      <SeatNode
        id={layout.hub.id}
        pos={layout.hub.pos}
        view={hubView}
        label={`${layout.hub.id} · hub`}
        sub={layout.hub.host}
        anim={anim}
        selected={selected === layout.hub.id}
        onSelect={onSelect}
        isHub
      />
      {layout.seats.map((s) => (
        <SeatNode
          key={s.id}
          id={s.id}
          pos={s.pos}
          view={seats[s.id] ?? { online: false, jailed: false, lag: null }}
          label={s.id}
          sub={[s.host, s.locationLabel].filter(Boolean).join(' · ')}
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
