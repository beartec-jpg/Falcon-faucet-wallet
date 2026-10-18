'use client'

import { useEffect, useRef, useState } from 'react'
import { FEEDBACK_CATEGORY_LABEL, FEEDBACK_CONFIG as F } from '@/config/feedback'
import { loadPrimaryWallet } from '@/lib/wallet-store'
import { downscaleImage } from '@/lib/image-downscale'

const input = 'w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:border-[#C07838] outline-none'
const EMPTY = { account: '', category: 'bug', area: '', description: '', contact: '' }
const ACCEPT = 'image/png,image/jpeg,image/webp'
type Shot = { file: File; url: string }

export default function FeedbackForm() {
  const [v, setV] = useState<Record<string, string>>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [shots, setShots] = useState<Shot[]>([])
  const [prepping, setPrepping] = useState(false)
  const shotsRef = useRef<Shot[]>([])
  shotsRef.current = shots
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), [])
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!picked.length) return
    setMsg(null)
    const room = F.maxImages - shots.length
    if (picked.length > room) setMsg({ ok: false, text: `Up to ${F.maxImages} screenshots.` })
    setPrepping(true)
    const out: Shot[] = []
    for (const f of picked.slice(0, Math.max(0, room))) {
      if (!ACCEPT.split(',').includes(f.type)) {
        setMsg({ ok: false, text: `${f.name}: use a PNG, JPEG or WebP image.` })
        continue
      }
      try {
        const small = await downscaleImage(f)
        out.push({ file: small, url: URL.createObjectURL(small) })
      } catch {
        setMsg({ ok: false, text: `${f.name}: could not read this image.` })
      }
    }
    setShots((cur) => [...cur, ...out])
    setPrepping(false)
  }
  const unpick = (i: number) => {
    URL.revokeObjectURL(shots[i].url)
    setShots(shots.filter((_, k) => k !== i))
  }
  useEffect(() => {
    loadPrimaryWallet()
      .then((w) => {
        const n = w?.accountName?.trim().toLowerCase()
        if (n) setV((cur) => (cur.account ? cur : { ...cur, account: n }))
      })
      .catch(() => {})
  }, [])
  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value })
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      const fd = new FormData()
      for (const [k, val] of Object.entries(v)) fd.append(k, val)
      for (const s of shots) fd.append('images', s.file, s.file.name)
      const r = await fetch('/api/feedback', { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({}))
      if (r.ok) {
        setMsg({ ok: true, text: 'Thanks! Your feedback is in the review queue. Approved feedback shows on your account scorecard.' })
        setV({ ...EMPTY, account: v.account })
        shots.forEach((s) => URL.revokeObjectURL(s.url))
        setShots([])
      } else setMsg({ ok: false, text: j.error ?? `Could not send (HTTP ${r.status}).` })
    } catch {
      setMsg({ ok: false, text: 'Network error. Try again.' })
    }
    setBusy(false)
  }
  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-800 p-5 space-y-4" style={{ background: '#0F172A' }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs text-slate-400 space-y-1 block">Testnet account name
          <input className={input} value={v.account} onChange={f('account')} required maxLength={64} placeholder="yourname" autoComplete="off" />
        </label>
        <label className="text-xs text-slate-400 space-y-1 block">Category
          <select className={input} value={v.category} onChange={f('category')}>
            {F.categories.map((c) => <option key={c} value={c}>{FEEDBACK_CATEGORY_LABEL[c]}</option>)}
          </select>
        </label>
      </div>
      <label className="text-xs text-slate-400 space-y-1 block">Page or area
        <input className={input} value={v.area} onChange={f('area')} required maxLength={F.areaMax} placeholder="e.g. /swap, wallet backup, arcade Snake" />
      </label>
      <label className="text-xs text-slate-400 space-y-1 block">What happened / what would you change?
        <textarea className={input} rows={6} value={v.description} onChange={f('description')} required minLength={F.descriptionMin} maxLength={F.descriptionMax}
          placeholder="Steps to reproduce, what you expected, what you saw." />
        <span className="block text-[11px] text-slate-500 text-right">{v.description.length}/{F.descriptionMax}</span>
      </label>
      <div className="space-y-2">
        <div className="text-xs text-slate-400">Screenshots <span className="text-slate-600">(optional, up to {F.maxImages})</span></div>
        <div className="flex flex-wrap gap-2">
          {shots.map((s, i) => (
            <div key={s.url} className="relative h-20 w-20 rounded-lg overflow-hidden border border-slate-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt={`Screenshot ${i + 1}`} className="h-full w-full object-cover" />
              <button type="button" onClick={() => unpick(i)} aria-label={`Remove screenshot ${i + 1}`} className="absolute top-0.5 right-0.5 rounded-full bg-slate-950/80 text-slate-200 w-5 h-5 text-xs leading-5">×</button>
            </div>
          ))}
          {shots.length < F.maxImages && (
            <label className="h-20 w-20 rounded-lg border border-dashed border-slate-600 hover:border-[#C07838] flex flex-col items-center justify-center text-[11px] text-slate-400 cursor-pointer">
              <span className="text-xl leading-none">+</span>{prepping ? 'Preparing…' : 'Add image'}
              <input type="file" accept={ACCEPT} multiple className="sr-only" onChange={pick} disabled={prepping} data-testid="screenshot-input" />
            </label>
          )}
        </div>
        <p className="text-[11px] text-slate-500">PNG, JPEG or WebP. Large photos are resized to 1600px and location/camera data is removed before upload. Only the team can see them.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs text-slate-400 space-y-1 block">Contact handle <span className="text-slate-600">(optional)</span>
          <input className={input} value={v.contact} onChange={f('contact')} maxLength={F.contactMax} placeholder="@telegram / discord / X" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button disabled={busy || prepping} className="shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold bg-[#C07838] text-slate-950 disabled:opacity-50">{busy ? 'Sending…' : 'Send feedback'}</button>
        {msg && <span role="status" className={`text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</span>}
      </div>
      <p className="text-[11px] text-slate-500">Your account must exist on testnet; development test accounts can&apos;t submit. Up to {F.perIpPerDay} submissions per day. Screenshots and contact handles are only visible to the reviewer.</p>
    </form>
  )
}
