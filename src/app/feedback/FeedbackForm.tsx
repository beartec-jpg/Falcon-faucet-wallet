'use client'

import { useEffect, useState } from 'react'
import { FEEDBACK_CATEGORY_LABEL, FEEDBACK_CONFIG as F } from '@/config/feedback'
import { loadPrimaryWallet } from '@/lib/wallet-store'

const input = 'w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:border-[#C07838] outline-none'
const EMPTY = { account: '', category: 'bug', area: '', description: '', screenshot_url: '', contact: '' }

export default function FeedbackForm() {
  const [v, setV] = useState<Record<string, string>>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
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
      const r = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v) })
      const j = await r.json().catch(() => ({}))
      if (r.ok) {
        setMsg({ ok: true, text: 'Thanks! Your feedback is in the review queue. Approved feedback shows on your account scorecard.' })
        setV({ ...EMPTY, account: v.account })
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
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs text-slate-400 space-y-1 block">Screenshot link <span className="text-slate-600">(optional)</span>
          <input className={input} type="url" value={v.screenshot_url} onChange={f('screenshot_url')} maxLength={F.screenshotMax} placeholder="https://…" />
        </label>
        <label className="text-xs text-slate-400 space-y-1 block">Contact handle <span className="text-slate-600">(optional)</span>
          <input className={input} value={v.contact} onChange={f('contact')} maxLength={F.contactMax} placeholder="@telegram / discord / X" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button disabled={busy} className="shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold bg-[#C07838] text-slate-950 disabled:opacity-50">{busy ? 'Sending…' : 'Send feedback'}</button>
        {msg && <span role="status" className={`text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</span>}
      </div>
      <p className="text-[11px] text-slate-500">Your account must exist on testnet; development test accounts can&apos;t submit. Up to {F.perIpPerDay} submissions per day. Contact handles are only visible to the reviewer.</p>
    </form>
  )
}
