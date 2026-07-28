import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import QRCode from 'qrcode'
import { MultiQrAssembler, type EncodedMultiQr, type MultiQrContentType } from '@/lib/multi-qr'
import { parsePastedTransport } from '@/lib/vault-protocol'

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
  const [copied, setCopied] = useState(false)
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

  async function copyPayload() {
    try {
      await navigator.clipboard.writeText(encoded.payload)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = encoded.payload
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

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
      <button
        type="button"
        onClick={() => void copyPayload()}
        className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-cyan-300 border border-cyan-500/20"
      >
        {copied ? 'Copied!' : 'Copy full payload (one-device paste)'}
      </button>
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
  const [paste, setPaste] = useState('')
  const [showPaste, setShowPaste] = useState(true)
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
      ?.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
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
      .catch(() => {
        // Camera optional when pasting for one-device test
        setError(null)
        setShowPaste(true)
      })

    return () => {
      cancelled = true
      cancelAnimationFrame(anim)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onComplete, expectedCt])

  function applyPaste() {
    try {
      const payload = parsePastedTransport(paste)
      let ct: MultiQrContentType = expectedCt ?? 'unsigned-tx'
      try {
        const t = (JSON.parse(payload) as { type?: string }).type
        if (t === 'vault-unlock-chal') ct = 'vault-unlock-chal'
        else if (t === 'vault-unlock-resp') ct = 'vault-unlock-resp'
        else if (t === 'falcon-unsigned-tx') ct = 'unsigned-tx'
        else if (t === 'falcon-signed-tx') ct = 'signed-tx'
      } catch { /* keep */ }
      if (expectedCt && ct !== expectedCt) throw new Error(`Expected ${expectedCt}, got ${ct}`)
      onComplete(payload, ct)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Paste failed')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
      <div className="flex justify-between items-center px-4 py-3 border-b border-slate-800">
        <span className="text-sm font-semibold">{title}</span>
        <button type="button" onClick={onCancel} className="text-slate-400">
          ✕
        </button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center p-4 gap-3 overflow-y-auto">
        {error && !error.includes('CRC') && !showPaste ? (
          <p className="text-amber-400 text-sm">{error}</p>
        ) : null}
        <video
          ref={videoRef}
          className="w-full max-w-sm aspect-square object-cover rounded-2xl bg-black"
          playsInline
          muted
        />
        <canvas ref={canvasRef} className="hidden" />
        <div className="w-full max-w-sm h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500" style={{ width: `${progress * 100}%` }} />
        </div>
        {error?.includes('CRC') && <p className="text-xs text-amber-400">CRC error — rescan</p>}

        <div className="w-full max-w-sm space-y-2">
          <button
            type="button"
            className="w-full text-xs text-cyan-400 py-1"
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
                placeholder="Paste full JSON from Copy payload on hot/cold"
                className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-[11px] font-mono text-slate-200"
              />
              {error && (
                <p className="text-xs text-amber-400">{error}</p>
              )}
              <button
                type="button"
                onClick={applyPaste}
                className="w-full py-2.5 rounded-xl text-sm font-semibold bg-cyan-700 hover:bg-cyan-600 text-white"
              >
                Use pasted payload
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
