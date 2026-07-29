'use client'

import { useEffect, useRef } from 'react'

/**
 * Soft gold network + particle background for product pages (faucet, wallet, etc.).
 * Calm, non-distracting; pauses when off-screen / tab hidden / reduced-motion.
 */
export default function BrandAtmosphere({
  className = '',
  intensity = 0.55,
}: {
  className?: string
  /** 0–1 overall opacity of the canvas layer */
  intensity?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const ACCENT = { r: 224, g: 168, b: 74 } // brand gold
    const CONNECT = 130
    let width = 0
    let height = 0
    let dpr = 1
    let particles: { x: number; y: number; vx: number; vy: number; r: number; a: number }[] = []
    let raf = 0
    let running = true
    let phase = 0

    const countForSize = () =>
      Math.min(70, Math.max(28, Math.floor((width * height) / 22000)))

    const init = () => {
      particles = Array.from({ length: countForSize() }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.28,
        vy: (Math.random() - 0.5) * 0.28,
        r: Math.random() * 1.5 + 0.5,
        a: Math.random() * 0.35 + 0.2,
      }))
    }

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      init()
    }

    const step = () => {
      if (!running) return
      ctx.clearRect(0, 0, width, height)
      phase += 0.002

      // Soft ambient rings
      const cx = width * 0.5
      const cy = height * 0.42
      const base = Math.min(width, height)
      ctx.beginPath()
      ctx.arc(cx, cy, base * 0.22 + Math.sin(phase) * 6, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(${ACCENT.r},${ACCENT.g},${ACCENT.b},0.045)`
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx, cy, base * 0.34 + Math.cos(phase * 0.8) * 5, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(${ACCENT.r},${ACCENT.g},${ACCENT.b},0.03)`
      ctx.stroke()

      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        if (p.x < -20) p.x = width + 20
        if (p.x > width + 20) p.x = -20
        if (p.y < -20) p.y = height + 20
        if (p.y > height + 20) p.y = -20
        p.vx *= 0.996
        p.vy *= 0.996
        if (Math.abs(p.vx) < 0.04) p.vx += (Math.random() - 0.5) * 0.015
        if (Math.abs(p.vy) < 0.04) p.vy += (Math.random() - 0.5) * 0.015

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${ACCENT.r},${ACCENT.g},${ACCENT.b},${p.a})`
        ctx.fill()
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i]
          const b = particles[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const dist = Math.hypot(dx, dy)
          if (dist < CONNECT) {
            const alpha = (1 - dist / CONNECT) * 0.16
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.strokeStyle = `rgba(${ACCENT.r},${ACCENT.g},${ACCENT.b},${alpha})`
            ctx.lineWidth = 1
            ctx.stroke()
          }
        }
      }

      raf = requestAnimationFrame(step)
    }

    resize()
    raf = requestAnimationFrame(step)

    let resizeTimer: ReturnType<typeof setTimeout>
    const onResize = () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(resize, 120)
    }
    window.addEventListener('resize', onResize)

    const onVis = () => {
      if (document.hidden) {
        running = false
        cancelAnimationFrame(raf)
        raf = 0
      } else {
        running = true
        raf = requestAnimationFrame(step)
      }
    }
    document.addEventListener('visibilitychange', onVis)

    let io: IntersectionObserver | null = null
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(
        ([entry]) => {
          running = entry.isIntersecting && !document.hidden
          if (running && !raf) raf = requestAnimationFrame(step)
          if (!running) {
            cancelAnimationFrame(raf)
            raf = 0
          }
        },
        { threshold: 0 }
      )
      io.observe(canvas)
    }

    return () => {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVis)
      io?.disconnect()
      clearTimeout(resizeTimer)
    }
  }, [])

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden>
      {/* Warm radial washes */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 70% 50% at 50% 20%, rgba(224,168,74,0.12) 0%, transparent 55%),
            radial-gradient(ellipse 50% 40% at 80% 70%, rgba(192,120,56,0.08) 0%, transparent 50%),
            radial-gradient(ellipse 40% 35% at 15% 80%, rgba(160,96,48,0.07) 0%, transparent 45%)
          `,
        }}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ opacity: intensity }}
      />
    </div>
  )
}
