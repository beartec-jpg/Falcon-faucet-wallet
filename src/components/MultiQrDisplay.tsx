'use client'

/**
 * Animated multi-part QR display — cycles frames for cold-sign transport.
 */

import { useEffect, useState } from 'react'
import type { EncodedMultiQr } from '@/lib/multi-qr'

interface Props {
  encoded: EncodedMultiQr
  /** Frame interval ms (default 180) */
  intervalMs?: number
  title?: string
  hint?: string
  onDone?: () => void
  doneLabel?: string
}

export default function MultiQrDisplay({
  encoded,
  intervalMs = 180,
  title = 'Scan with cold signer',
  hint,
  onDone,
  doneLabel = 'Done',
}: Props) {
  const [idx, setIdx] = useState(0)
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [qrError, setQrError] = useState(false)

  const frame = encoded.frames[idx] ?? ''

  useEffect(() => {
    if (encoded.frames.length <= 1) return
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % encoded.frames.length)
    }, intervalMs)
    return () => clearInterval(t)
  }, [encoded.frames.length, intervalMs])

  useEffect(() => {
    let cancelled = false
    setQrError(false)
    ;(async () => {
      try {
        const QRCode = (await import('qrcode')).default
        const url = await QRCode.toDataURL(frame, {
          width: 280,
          margin: 2,
          errorCorrectionLevel: 'M',
          color: { dark: '#0f172a', light: '#f8fafc' },
        })
        if (!cancelled) setDataUrl(url)
      } catch {
        // Fallback: public QR API (online only)
        try {
          const url = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=8&data=${encodeURIComponent(frame)}`
          if (!cancelled) setDataUrl(url)
        } catch {
          if (!cancelled) setQrError(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [frame])

  return (
    <div className="flex flex-col items-center gap-3 p-4">
      <h3 className="text-sm font-semibold text-white text-center">{title}</h3>
      {hint && <p className="text-xs text-slate-400 text-center max-w-xs">{hint}</p>}

      <div className="bg-slate-100 rounded-xl p-3 shadow-inner">
        {qrError || !dataUrl ? (
          <div className="w-[280px] h-[280px] flex items-center justify-center text-slate-500 text-xs">
            {qrError ? 'QR render failed' : 'Generating…'}
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt={`QR frame ${idx + 1} of ${encoded.frameCount}`} width={280} height={280} className="rounded-lg" />
        )}
      </div>

      <div className="text-xs text-slate-400 font-mono">
        Frame {idx + 1} / {encoded.frameCount}
        {encoded.frameCount > 1 && ' · animating'}
      </div>
      <div className="w-full max-w-[280px] h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-brand-500 transition-all duration-150"
          style={{ width: `${((idx + 1) / encoded.frameCount) * 100}%` }}
        />
      </div>
      <p className="text-[11px] text-slate-500 text-center max-w-xs">
        Keep the camera on this screen until the other device finishes scanning all frames.
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        <button
          type="button"
          onClick={async () => {
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
          }}
          className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/20"
        >
          Copy full payload (one-device paste)
        </button>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200"
          >
            {doneLabel}
          </button>
        )}
      </div>
    </div>
  )
}
