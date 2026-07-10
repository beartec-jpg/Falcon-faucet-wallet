'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

interface Props {
  onScan: (raw: string) => void
  onClose: () => void
  /** Shown under the viewfinder */
  hint?: string
  /** Shown when camera fails */
  manualHint?: string
}

export default function AddressQrScanner({
  onScan,
  onClose,
  hint = 'Point at a Receive QR (Falcon r-address)',
  manualHint = 'Paste the Falcon address manually, or allow camera access and retry.',
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const [error, setError] = useState<string | null>(null)

  const stopCamera = useCallback((stream: MediaStream | null) => {
    stream?.getTracks().forEach((t) => t.stop())
  }, [])

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false

    const scan = () => {
      if (cancelled) return
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        animRef.current = requestAnimationFrame(scan)
        return
      }
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      })
      if (code?.data) {
        stopCamera(stream)
        onScan(code.data)
        return
      }
      animRef.current = requestAnimationFrame(scan)
    }

    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError('Camera not supported in this browser')
          return
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) {
          stopCamera(stream)
          return
        }
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        scan()
      } catch {
        setError('Camera access denied or unavailable')
      }
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(animRef.current)
      stopCamera(stream)
    }
  }, [onScan, stopCamera])

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <span className="text-sm font-semibold text-white">Scan address QR</span>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-white p-1"
          aria-label="Close scanner"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-amber-400">{error}</p>
          <p className="text-xs text-slate-500">{manualHint}</p>
          <button type="button" onClick={onClose} className="text-sm text-brand-400">
            Close
          </button>
        </div>
      ) : (
        <div className="relative flex-1 min-h-0">
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            playsInline
            muted
          />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-56 h-56 border-2 border-brand-400/80 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
          <p className="absolute bottom-6 left-0 right-0 text-center text-xs text-slate-300 px-4">
            {hint}
          </p>
        </div>
      )}
    </div>
  )
}