import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import QRCode from 'qrcode'
import { MultiQrAssembler, type EncodedMultiQr, type MultiQrContentType } from '@/lib/multi-qr'

export function AnimatedQr({
  encoded,
  title,
  intervalMs = 180,
}: {
  encoded: EncodedMultiQr
  title?: string
  intervalMs?: number
}) {
  const [idx, setIdx] = useState(0)
  const [url, setUrl] = useState<string | null>(null)
  const frame = encoded.frames[idx] ?? ''

  useEffect(() => {
    if (encoded.frames.length <= 1) return
    const t = setInterval(() => setIdx((i) => (i + 1) % encoded.frames.length), intervalMs)
    return () => clearInterval(t)
  }, [encoded.frames.length, intervalMs])

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(frame, {
      width: 280,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#f8fafc' },
    })
      .then((u) => {
        if (!cancelled) setUrl(u)
      })
      .catch(() => {
        if (!cancelled) setUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [frame])

  return (
    <div className="flex flex-col items-center gap-2">
      {title && <p className="text-sm font-semibold text-white">{title}</p>}
      {url ? (
        <img src={url} alt="QR" width={280} height={280} className="rounded-xl bg-white p-2" />
      ) : (
        <div className="w-[280px] h-[280px] bg-slate-800 rounded-xl" />
      )}
      <p className="text-xs text-slate-400 font-mono">
        Frame {idx + 1}/{encoded.frameCount}
      </p>
    </div>
  )
}

export function MultiQrScan({
  onComplete,
  onCancel,
  expectedCt,
  title = 'Scan multi-part QR',
}: {
  onComplete: (payload: string, ct: MultiQrContentType) => void
  onCancel: () => void
  expectedCt?: MultiQrContentType
  title?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const asm = useRef(new MultiQrAssembler())
  const last = useRef('')

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    let anim = 0
    asm.current.reset()

    const tick = () => {
      if (cancelled) return
      const video = videoRef.current
      const canvas = canvasRef.current
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(video, 0, 0)
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert',
          })
          if (code?.data && code.data !== last.current && code.data.includes('"mid"')) {
            last.current = code.data
            try {
              const payload = asm.current.addFrame(code.data)
              setProgress(asm.current.progress)
              if (payload !== null) {
                const ct = asm.current.contentType!
                if (expectedCt && ct !== expectedCt) throw new Error(`Expected ${expectedCt}`)
                stream?.getTracks().forEach((t) => t.stop())
                onComplete(payload, ct)
                return
              }
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Scan error')
              if (e instanceof Error && e.message.includes('CRC')) {
                asm.current.reset()
                setProgress(0)
              }
            }
          }
        }
      }
      anim = requestAnimationFrame(tick)
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        if (videoRef.current) {
          videoRef.current.srcObject = s
          await videoRef.current.play()
          tick()
        }
      })
      .catch(() => setError('Camera denied'))

    return () => {
      cancelled = true
      cancelAnimationFrame(anim)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onComplete, expectedCt])

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
      <div className="flex justify-between items-center px-4 py-3 border-b border-slate-800">
        <span className="text-sm font-semibold">{title}</span>
        <button type="button" onClick={onCancel} className="text-slate-400">
          ✕
        </button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center p-4 gap-3">
        {error && !error.includes('CRC') ? (
          <p className="text-amber-400 text-sm">{error}</p>
        ) : (
          <>
            <video ref={videoRef} className="w-full max-w-sm aspect-square object-cover rounded-2xl bg-black" playsInline muted />
            <canvas ref={canvasRef} className="hidden" />
            <div className="w-full max-w-sm h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: `${progress * 100}%` }} />
            </div>
            {error?.includes('CRC') && <p className="text-xs text-amber-400">CRC error — rescan</p>}
          </>
        )}
      </div>
    </div>
  )
}
