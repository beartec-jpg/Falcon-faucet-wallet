'use client'

/**
 * Continuous camera scanner that reassembles multi-part QR frames.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { MultiQrAssembler, type MultiQrContentType } from '@/lib/multi-qr'
import { parsePastedTransport } from '@/lib/vault-protocol'

interface Props {
  onComplete: (payload: string, ct: MultiQrContentType) => void
  onClose: () => void
  title?: string
  hint?: string
  /** If set, only accept this content type */
  expectedCt?: MultiQrContentType
  /** Show paste box for one-device testing */
  allowPaste?: boolean
}

export default function MultiQrScanner({
  onComplete,
  onClose,
  title = 'Scan multi-part QR',
  hint = 'Point at the animated QR on the other device',
  expectedCt,
  allowPaste = true,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef(0)
  const asmRef = useRef(new MultiQrAssembler())
  const lastRawRef = useRef('')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [received, setReceived] = useState(0)
  const [expected, setExpected] = useState(0)
  const [paste, setPaste] = useState('')
  const [showPaste, setShowPaste] = useState(false)

  const stopCamera = useCallback((stream: MediaStream | null) => {
    stream?.getTracks().forEach((t) => t.stop())
  }, [])

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    const asm = asmRef.current
    asm.reset()

    const tick = () => {
      if (cancelled) return
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        animRef.current = requestAnimationFrame(tick)
        return
      }
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        animRef.current = requestAnimationFrame(tick)
        return
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      })
      if (code?.data && code.data !== lastRawRef.current) {
        lastRawRef.current = code.data
        try {
          // Only treat as multi-QR if it looks like our JSON frame
          if (!code.data.includes('"mid"') || !code.data.includes('"crc"')) {
            animRef.current = requestAnimationFrame(tick)
            return
          }
          const payload = asm.addFrame(code.data)
          setReceived(asm.receivedCount)
          setExpected(asm.expectedCount)
          setProgress(asm.progress)
          if (payload !== null) {
            const ct = asm.contentType
            if (!ct) throw new Error('Missing content type')
            if (expectedCt && ct !== expectedCt) {
              throw new Error(`Expected ${expectedCt}, got ${ct}`)
            }
            stopCamera(stream)
            onComplete(payload, ct)
            return
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Scan error')
          // Keep scanning after recoverable errors; reset on hard CRC fail
          if (e instanceof Error && e.message.includes('CRC')) {
            asm.reset()
            setProgress(0)
            setReceived(0)
            setExpected(0)
          }
        }
      }
      animRef.current = requestAnimationFrame(tick)
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
        tick()
      } catch {
        setError('Camera access denied or unavailable')
      }
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(animRef.current)
      stopCamera(stream)
    }
  }, [onComplete, stopCamera, expectedCt])

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <span className="text-sm font-semibold text-white">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-white p-1"
          aria-label="Close scanner"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center p-4 gap-3">
        {error && !error.includes('CRC') ? (
          <p className="text-amber-400 text-sm text-center max-w-sm">{error}</p>
        ) : (
          <>
            <div className="relative w-full max-w-sm aspect-square rounded-2xl overflow-hidden border border-slate-700 bg-black">
              <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute inset-8 border-2 border-brand-500/60 rounded-xl pointer-events-none" />
            </div>
            <p className="text-xs text-slate-400 text-center">{hint}</p>
            {expected > 0 && (
              <div className="w-full max-w-sm">
                <div className="flex justify-between text-[11px] text-slate-400 mb-1 font-mono">
                  <span>
                    {received} / {expected} frames
                  </span>
                  <span>{Math.round(progress * 100)}%</span>
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              </div>
            )}
            {error?.includes('CRC') && (
              <p className="text-amber-400 text-xs text-center">CRC error — rescan from the start</p>
            )}
            {allowPaste && (
              <div className="w-full max-w-sm mt-2 space-y-2">
                <button
                  type="button"
                  className="w-full text-xs text-cyan-400 py-2"
                  onClick={() => setShowPaste((v) => !v)}
                >
                  {showPaste ? 'Hide paste' : 'Paste payload (one-device test)'}
                </button>
                {showPaste && (
                  <>
                    <textarea
                      value={paste}
                      onChange={(e) => setPaste(e.target.value)}
                      rows={5}
                      placeholder="Paste full JSON from Copy payload on the other screen"
                      className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-[11px] font-mono text-slate-200"
                    />
                    <button
                      type="button"
                      className="w-full py-2.5 rounded-xl text-sm font-semibold bg-cyan-700 hover:bg-cyan-600 text-white"
                      onClick={() => {
                        try {
                          const payload = parsePastedTransport(paste)
                          // Infer content type from payload when possible
                          let ct: MultiQrContentType = expectedCt ?? 'unsigned-tx'
                          try {
                            const t = (JSON.parse(payload) as { type?: string }).type
                            if (t === 'vault-unlock-chal') ct = 'vault-unlock-chal'
                            else if (t === 'vault-unlock-resp') ct = 'vault-unlock-resp'
                            else if (t === 'falcon-unsigned-tx') ct = 'unsigned-tx'
                            else if (t === 'falcon-signed-tx') ct = 'signed-tx'
                          } catch { /* keep expected */ }
                          if (expectedCt && ct !== expectedCt) {
                            throw new Error(`Expected ${expectedCt}, got ${ct}`)
                          }
                          onComplete(payload, ct)
                        } catch (e) {
                          setError(e instanceof Error ? e.message : 'Paste failed')
                        }
                      }}
                    >
                      Use pasted payload
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
