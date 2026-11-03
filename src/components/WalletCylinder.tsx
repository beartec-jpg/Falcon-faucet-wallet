// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type CylinderFace = { id: string; label: string }

const SNAP_MS = 520

/** Positive modulo. */
const mod = (n: number, m: number) => ((n % m) + m) % m

/**
 * 3D rotating cylinder header (CSS 3D transforms only). Faces sit around the Y axis; the
 * viewpoint is tilted slightly above so the top rim shows and back faces read through,
 * blurred and dimmed. Drag / swipe with momentum, arrow keys, or tap a name; it snaps to the
 * nearest face and calls onSelect once settled. prefers-reduced-motion → flat slide strip.
 */
export default function WalletCylinder({
  faces,
  activeId,
  onSelect,
}: {
  faces: CylinderFace[]
  activeId: string
  onSelect: (id: string) => void
}) {
  const n = faces.length
  const step = 360 / n
  const activeIndex = Math.max(0, faces.findIndex((f) => f.id === activeId))

  // Continuous rotation in "face units" (1 = one face). Face i is in front when pos ≡ i (mod n).
  const [pos, setPos] = useState(activeIndex)
  const [dragging, setDragging] = useState(false)
  const [reduced, setReduced] = useState(false)
  const [width, setWidth] = useState(360)
  const stageRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; start: number; lastX: number; lastT: number; v: number; moved: boolean } | null>(null)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastDragMoved = useRef(false)
  const posRef = useRef(pos)
  posRef.current = pos

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 360))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // External changes (deep link, in-wallet "Bridge out" etc.) → rotate the shortest way there.
  useEffect(() => {
    if (drag.current) return
    const cur = mod(Math.round(posRef.current), n)
    if (cur === activeIndex && Number.isInteger(posRef.current)) return
    let d = activeIndex - cur
    if (d > n / 2) d -= n
    if (d < -n / 2) d += n
    setPos(Math.round(posRef.current) + d)
  }, [activeIndex, n])

  const settleTo = useCallback(
    (target: number) => {
      setPos(target)
      if (settleTimer.current) clearTimeout(settleTimer.current)
      settleTimer.current = setTimeout(() => {
        const id = faces[mod(target, n)].id
        if (id !== activeId) onSelect(id)
      }, reduced ? 0 : SNAP_MS)
    },
    [faces, n, onSelect, activeId, reduced],
  )

  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current) }, [])

  const go = useCallback(
    (delta: number) => settleTo(Math.round(posRef.current) + delta),
    [settleTo],
  )

  const goTo = useCallback(
    (i: number) => {
      const cur = Math.round(posRef.current)
      let d = i - mod(cur, n)
      if (d > n / 2) d -= n
      if (d < -n / 2) d += n
      settleTo(cur + d)
    },
    [n, settleTo],
  )

  // Pixels of drag per face.
  const pxPerFace = Math.max(90, width / 3)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (settleTimer.current) clearTimeout(settleTimer.current)
    lastDragMoved.current = false
    drag.current = { x: e.clientX, start: posRef.current, lastX: e.clientX, lastT: performance.now(), v: 0, moved: false }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) > 6) {
      d.moved = true
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* ignore */ }
    }
    if (!d.moved) return
    const now = performance.now()
    const dt = Math.max(1, now - d.lastT)
    d.v = 0.8 * ((e.clientX - d.lastX) / dt) + 0.2 * d.v // px/ms, smoothed
    d.lastX = e.clientX
    d.lastT = now
    // Drag left → next face (cylinder turns right-to-left).
    setPos(d.start - dx / pxPerFace)
  }
  const endDrag = () => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (!d || !d.moved) return
    lastDragMoved.current = true
    // Momentum: project ~250ms of current velocity, then snap to the nearest face.
    const projected = posRef.current - (d.v * 250) / pxPerFace
    const target = Math.round(projected)
    settleTo(target)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
    else if (e.key === 'Home') { e.preventDefault(); goTo(0) }
    else if (e.key === 'End') { e.preventDefault(); goTo(n - 1) }
  }

  const frontIndex = mod(Math.round(pos), n)

  if (reduced) {
    // Simple slide: a flat strip of names translated to centre the active one.
    const itemW = 112
    return (
      <div
        className="wallet-glass relative overflow-hidden select-none"
        role="tablist"
        aria-label="Wallet sections"
        tabIndex={0}
        onKeyDown={onKeyDown}
        ref={stageRef}
      >
        <div className="flex items-center">
          <button type="button" aria-label="Previous section" onClick={() => go(-1)} className="px-3 py-3 text-slate-500 hover:text-slate-200 z-10">‹</button>
          <div className="relative flex-1 overflow-hidden h-11">
            <div
              className="absolute top-0 left-1/2 flex h-full"
              style={{ transform: `translateX(${-(frontIndex + 0.5) * itemW}px)` }}
            >
              {faces.map((f, i) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={i === frontIndex}
                  onClick={() => goTo(i)}
                  style={{ width: itemW }}
                  className={`h-full text-sm font-semibold ${i === frontIndex ? 'text-brand-400' : 'text-slate-500'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <button type="button" aria-label="Next section" onClick={() => go(1)} className="px-3 py-3 text-slate-500 hover:text-slate-200 z-10">›</button>
        </div>
      </div>
    )
  }

  // Cylinder geometry: face width ≈ 44% of the stage, radius so the n faces close the loop.
  const faceW = Math.min(220, Math.max(130, width * 0.44))
  const faceH = 56
  const radius = faceW / 2 / Math.tan(Math.PI / n)
  const rot = -pos * step

  return (
    <div
      ref={stageRef}
      className="wallet-cylinder relative select-none outline-none rounded-2xl focus-visible:ring-2 focus-visible:ring-brand-500/50"
      role="tablist"
      aria-label="Wallet sections — swipe, drag or use arrow keys"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{
        height: faceH + 44,
        perspective: `${Math.round(radius * 4)}px`,
        perspectiveOrigin: '50% -60%', // viewpoint slightly above → top rim visible
        touchAction: 'pan-y',
        cursor: dragging ? 'grabbing' : 'grab',
      }}
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: faceW,
          height: faceH,
          marginLeft: -faceW / 2,
          marginTop: -faceH / 2 + 6,
          transformStyle: 'preserve-3d',
          transform: `translateZ(${-radius}px) rotateX(-10deg) rotateY(${rot}deg)`,
          transition: dragging ? 'none' : `transform ${SNAP_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        }}
      >
        {/* Top rim */}
        <div
          aria-hidden
          className="absolute left-1/2 top-0 rounded-full pointer-events-none"
          style={{
            width: radius * 2 + 8,
            height: radius * 2 + 8,
            marginLeft: -(radius + 4),
            marginTop: -(radius + 4),
            transform: 'rotateX(90deg)',
            background:
              'radial-gradient(circle, rgba(192,120,56,0.10) 0%, rgba(15,23,42,0.55) 62%, rgba(192,120,56,0.35) 69%, transparent 71%)',
          }}
        />
        {faces.map((f, i) => {
          // Angle of this face relative to the viewer (0 = front).
          const rel = mod(i * step + rot + 180, 360) - 180
          const facing = Math.cos((rel * Math.PI) / 180) // 1 front … -1 back
          const isFront = i === frontIndex
          const back = facing < 0
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={isFront}
              tabIndex={-1}
              onClick={() => {
                if (lastDragMoved.current) return
                goTo(i)
              }}
              className={`absolute inset-0 flex items-center justify-center rounded-xl border text-base sm:text-lg font-semibold tracking-wide transition-colors ${
                isFront
                  ? 'border-brand-500/40 bg-gradient-to-b from-brand-500/20 to-slate-900/80 text-brand-300 shadow-[0_0_24px_rgba(192,120,56,0.18)]'
                  : 'border-slate-700/50 bg-slate-900/70 text-slate-400'
              }`}
              style={{
                transform: `rotateY(${i * step}deg) translateZ(${radius}px)`,
                backfaceVisibility: 'visible',
                opacity: back ? 0.25 + 0.15 * (1 + facing) : 0.45 + 0.55 * facing,
                filter: back ? 'blur(1.6px)' : facing < 0.95 ? `blur(${(1 - facing) * 1.2}px)` : 'none',
              }}
            >
              {/* Back faces are seen from inside: un-mirror their text so it reads correctly. */}
              <span style={{ transform: back ? 'scaleX(-1)' : undefined }}>{f.label}</span>
            </button>
          )
        })}
      </div>
      {/* Side affordances */}
      <button type="button" aria-label="Previous section" onClick={() => go(-1)} onPointerDown={(e) => e.stopPropagation()} className="absolute left-1 top-1/2 -translate-y-1/2 px-2 py-2 text-slate-500 hover:text-slate-200">‹</button>
      <button type="button" aria-label="Next section" onClick={() => go(1)} onPointerDown={(e) => e.stopPropagation()} className="absolute right-1 top-1/2 -translate-y-1/2 px-2 py-2 text-slate-500 hover:text-slate-200">›</button>
    </div>
  )
}
