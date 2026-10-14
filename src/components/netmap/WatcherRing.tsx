'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { Vec3 } from '@/lib/netmap-layout'

export interface WatcherRingEvent {
  at: number
  joined: string[]
  pulsed: string[]
}

const RADIUS = 1.9
const FLY_S = 1.4
const PULSE_S = 0.9
const TILT = new THREE.Euler(Math.PI / 2.25, 0, 0.12)

/**
 * Orbit cloud around the hub: one particle per watcher account this epoch
 * (bright = heartbeated in the current slot, dim = epoch only), capped with '+N'.
 * New accounts fly in; a particle pulses when its watcher_work goes up.
 */
export default function WatcherRing({
  center,
  epoch,
  live,
  cap,
  event,
}: {
  center: Vec3
  epoch: string[]
  live: string[]
  cap: number
  event: WatcherRingEvent | null
}) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const ringMat = useRef<THREE.MeshBasicMaterial>(null)
  const clock = useThree((s) => s.clock)
  const joinedAt = useRef(new Map<string, number>())
  const pulseAt = useRef(new Map<string, number>())
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const v = useMemo(() => new THREE.Vector3(), [])
  const from = useMemo(() => new THREE.Vector3(), [])
  const q = useMemo(() => new THREE.Quaternion().setFromEuler(TILT), [])
  const liveSet = useMemo(() => new Set(live), [live])
  // Live watchers first so they are never the ones hidden behind '+N'.
  const shown = useMemo(
    () => [...epoch].sort((a, b) => Number(liveSet.has(b)) - Number(liveSet.has(a)) || a.localeCompare(b)).slice(0, cap),
    [epoch, liveSet, cap],
  )
  const extra = Math.max(0, epoch.length - shown.length)
  const colors = useMemo(() => ({ live: new THREE.Color('#F5E7C8'), idle: new THREE.Color('#7C4A22'), gold: new THREE.Color('#D4922A') }), [])
  const tmp = useMemo(() => new THREE.Color(), [])

  useEffect(() => {
    if (!event) return
    const now = clock.elapsedTime
    event.joined.forEach((a, i) => joinedAt.current.set(a, now + i * 0.15))
    event.pulsed.forEach((a) => pulseAt.current.set(a, now))
  }, [event, clock])

  useFrame((st) => {
    const m = mesh.current
    const now = st.clock.elapsedTime
    if (ringMat.current) ringMat.current.opacity = (live.length ? 0.35 : 0.12) + 0.05 * Math.sin(now * 1.3)
    if (!m) return
    const n = shown.length
    for (let i = 0; i < n; i++) {
      const id = shown[i]
      const ang = (i / Math.max(n, 1)) * Math.PI * 2 + now * 0.18
      v.set(Math.cos(ang) * RADIUS, Math.sin(ang) * RADIUS, Math.sin(ang * 3 + i) * 0.08).applyQuaternion(q)
      const j = joinedAt.current.get(id)
      if (j != null) {
        const u = (now - j) / FLY_S
        if (u < 1) {
          const e = 1 - Math.pow(1 - Math.max(0, u), 3)
          from.copy(v).normalize().multiplyScalar(9).setY(v.y + 4)
          v.lerpVectors(from, v, e)
        } else joinedAt.current.delete(id)
      }
      const p = pulseAt.current.get(id)
      const pk = p != null && now - p < PULSE_S ? 1 - (now - p) / PULSE_S : 0
      const isLive = liveSet.has(id)
      dummy.position.copy(v)
      dummy.scale.setScalar((isLive ? 0.085 : 0.055) * (1 + pk * 1.8))
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
      tmp.copy(isLive ? colors.live : colors.idle).lerp(colors.gold, pk)
      m.setColorAt(i, tmp)
    }
    m.count = n
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })

  return (
    <group position={center}>
      <mesh rotation={TILT} raycast={() => null}>
        <torusGeometry args={[RADIUS, 0.012, 6, 96]} />
        <meshBasicMaterial ref={ringMat} color="#D4922A" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <instancedMesh ref={mesh} args={[undefined, undefined, Math.max(1, cap)]} frustumCulled={false} raycast={() => null}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <Html position={[RADIUS + 0.35, 0.55, 0]} zIndexRange={[25, 0]} style={{ pointerEvents: 'none' }}>
        <div className="netmap-watch">
          <span className="netmap-watch-dot" data-on={live.length ? '1' : undefined} />
          Watchers: {live.length} live · {epoch.length} this epoch
          {extra > 0 && <span className="netmap-watch-more">+{extra}</span>}
          {!live.length && <div className="netmap-watch-empty">No active watchers</div>}
        </div>
      </Html>
    </group>
  )
}
