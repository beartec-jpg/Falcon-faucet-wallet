'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { Vec3 } from '@/lib/netmap-layout'
import type { BridgeOperator } from '@/lib/bridge-operators'

/** Wider than the watcher ring (r 3.6). */
const RADIUS = 4.6
/** Vertically centred on the hub core (hub origin); watcher ring sits above (lift 1.45). */
const LIFT = 0
const TILT = new THREE.Euler(Math.PI / 2, 0, 0)
export const OPERATOR_COLOR = '#38BDF8'

/** Orbit of BTC bridge operators (static list until the on-chain registry is live). Ring shows even with 0. */
export default function OperatorRing({ center, operators }: { center: Vec3; operators: BridgeOperator[] }) {
  const ringMat = useRef<THREE.MeshBasicMaterial>(null)
  const group = useRef<THREE.Group>(null)
  const n = operators.length

  useFrame((st) => {
    const now = st.clock.elapsedTime
    if (ringMat.current) ringMat.current.opacity = (n ? 0.3 : 0.12) + 0.05 * Math.sin(now * 1.1)
    if (group.current) group.current.rotation.y = -now * 0.12
  })

  const pos = useMemo(
    () => operators.map((_, i) => {
      const a = (i / Math.max(n, 1)) * Math.PI * 2
      return [Math.cos(a) * RADIUS, 0, Math.sin(a) * RADIUS] as [number, number, number]
    }),
    [operators, n],
  )

  return (
    <group position={[center[0], center[1] + LIFT, center[2]]}>
      <mesh rotation={TILT} raycast={() => null}>
        <torusGeometry args={[RADIUS, 0.01, 6, 180]} />
        <meshBasicMaterial ref={ringMat} color={OPERATOR_COLOR} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <group ref={group}>
        {operators.map((op, i) => (
          <mesh key={op.name} position={pos[i]}>
            <sphereGeometry args={[op.live ? 0.09 : 0.06, 12, 10]} />
            <meshBasicMaterial color={OPERATOR_COLOR} toneMapped={false} />
            <Html center position={[0, 0.2, 0]} zIndexRange={[25, 0]} style={{ pointerEvents: 'none' }}>
              <div className="netmap-watch" title={`BTC bridge operator: ${op.name}`}>BTC bridge operator · {op.name}</div>
            </Html>
          </mesh>
        ))}
      </group>
      <Html position={[RADIUS + 0.3, -0.25, 0]} zIndexRange={[25, 0]} style={{ pointerEvents: 'none' }}>
        <div className="netmap-watch" title="BTC bridge operators: front BTC withdrawals and watch each other">
          <span className="netmap-watch-dot" style={{ background: n ? OPERATOR_COLOR : undefined }} />
          {n ? `Operators: ${n} · BTC bridge operators` : 'Operators (coming soon)'}
        </div>
      </Html>
    </group>
  )
}
