'use client'

// Testnet feedback review (inside the First 35 admin; same Bearer FIRST35_ADMIN_TOKEN).
// Approving sets a bonus (tracker points) that feeds the "feedback" scorecard category.

import { useCallback, useEffect, useState } from 'react'
import { FEEDBACK_CATEGORY_LABEL } from '@/config/feedback'
import type { Feedback, FeedbackStatus } from '@/lib/feedback-store'

type Filter = 'all' | FeedbackStatus
const btn = 'rounded px-2 py-1 text-xs border border-slate-700 hover:border-slate-500'
const TONE: Record<FeedbackStatus, string> = { pending: 'text-slate-300', approved: 'text-amber-400', rejected: 'text-red-400' }

/** Screenshot fetched with the admin Bearer token and shown from an object URL (images have no public URL). */
function Thumb({ id, token, onOpen }: { id: number; token: string; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let u: string | null = null
    let live = true
    fetch(`/api/feedback/admin/image?id=${id}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (!live) return
        u = URL.createObjectURL(b)
        setUrl(u)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
      if (u) URL.revokeObjectURL(u)
    }
  }, [id, token])
  if (failed) return <span className="inline-block h-14 w-14 rounded border border-slate-800 text-[10px] text-slate-600 p-1">image unavailable</span>
  if (!url) return <span className="inline-block h-14 w-14 rounded bg-slate-800 animate-pulse" />
  return (
    <button type="button" onClick={() => onOpen(url)} className="h-14 w-14 rounded overflow-hidden border border-slate-700 hover:border-[#C07838]" aria-label={`Enlarge screenshot ${id}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={`Screenshot ${id}`} className="h-full w-full object-cover" />
    </button>
  )
}

function Row({ r, def, max, act, token, onOpen }: { r: Feedback; def: number; max: number; act: (b: Record<string, unknown>, done: string) => Promise<void>; token: string; onOpen: (url: string) => void }) {
  const [bonus, setBonus] = useState(String(r.status === 'approved' ? r.bonus : def))
  const [notes, setNotes] = useState(r.admin_notes)
  useEffect(() => {
    setBonus(String(r.status === 'approved' ? r.bonus : def))
    setNotes(r.admin_notes)
  }, [r, def])
  return (
    <tr className="border-b border-slate-800/50 align-top">
      <td className="py-2 pr-2 text-slate-500 font-mono">#{r.id}</td>
      <td className="pr-2 font-mono"><a href={`/scan/account/${encodeURIComponent(r.account)}`} className="hover:underline">{r.account}</a></td>
      <td className="pr-2">{FEEDBACK_CATEGORY_LABEL[r.category] ?? r.category}</td>
      <td className="pr-2 max-w-[10rem] break-words">{r.area}</td>
      <td className="pr-2 max-w-[24rem] whitespace-pre-wrap break-words text-slate-300">
        {r.description}
        {r.image_ids.length > 0 && (
          <div className="flex gap-1.5 mt-1.5">
            {r.image_ids.map((iid) => <Thumb key={iid} id={iid} token={token} onOpen={onOpen} />)}
          </div>
        )}
      </td>
      <td className="pr-2">{r.contact || '—'}</td>
      <td className={`pr-2 ${TONE[r.status]}`}>{r.status}{r.status === 'approved' && <div className="font-mono">+{r.bonus}</div>}</td>
      <td className="pr-2 whitespace-nowrap text-slate-500">{r.created_at.slice(0, 10)}</td>
      <td className="pr-2 min-w-[12rem]">
        <textarea aria-label={`Notes for #${r.id}`} className="w-full rounded bg-slate-900 border border-slate-700 px-1.5 py-1" rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
        {notes !== r.admin_notes && <button className={btn} onClick={() => act({ action: 'notes', id: r.id, admin_notes: notes }, `Notes saved for #${r.id}.`)}>Save notes</button>}
      </td>
      <td className="whitespace-nowrap space-y-1">
        <div className="flex items-center gap-1">
          <input aria-label={`Bonus for #${r.id}`} type="number" min={0} max={max} step={0.5} value={bonus} onChange={(e) => setBonus(e.target.value)} className="w-16 rounded bg-slate-900 border border-slate-700 px-1 py-0.5 font-mono" />
          {r.status === 'approved' ? (
            <button className={btn} disabled={Number(bonus) === r.bonus} onClick={() => act({ action: 'bonus', id: r.id, bonus }, `Bonus updated for #${r.id}.`)}>Set bonus</button>
          ) : (
            <button className={`${btn} border-amber-700 text-amber-300`} onClick={() => act({ action: 'approve', id: r.id, bonus }, `Approved #${r.id} (+${bonus}).`)}>Approve</button>
          )}
        </div>
        <div className="space-x-1">
          {r.status !== 'rejected' && <button className={btn} onClick={() => act({ action: 'reject', id: r.id }, `Rejected #${r.id}.`)}>Reject</button>}
          {r.status !== 'pending' && <button className={btn} onClick={() => act({ action: 'pending', id: r.id }, `#${r.id} back to pending.`)}>Reopen</button>}
          <button className={`${btn} text-red-400`} onClick={() => confirm(`Delete feedback #${r.id}${r.image_ids.length ? ` and its ${r.image_ids.length} screenshot(s)` : ''} permanently?`) && act({ action: 'delete', id: r.id }, `Deleted #${r.id}.`)}>Delete</button>
        </div>
      </td>
    </tr>
  )
}

export default function FeedbackAdmin({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [rows, setRows] = useState<Feedback[]>([])
  const [counts, setCounts] = useState({ all: 0, pending: 0, approved: 0, rejected: 0 })
  const [def, setDef] = useState(1)
  const [max, setMax] = useState(5)
  const [filter, setFilter] = useState<Filter>('pending')
  const [flash, setFlash] = useState<string | null>(null)
  const [big, setBig] = useState<string | null>(null)
  useEffect(() => {
    if (!big) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setBig(null)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [big])
  const hdr = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }

  const load = useCallback(async () => {
    const r = await fetch(`/api/feedback/admin${filter === 'all' ? '' : `?status=${filter}`}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })
    if (r.status === 401) return onUnauthorized()
    if (!r.ok) return setFlash(`Could not load feedback (HTTP ${r.status}).`)
    const j = await r.json()
    setRows(j.feedback)
    setCounts(j.counts)
    setDef(j.default_bonus)
    setMax(j.max_bonus)
  }, [token, filter, onUnauthorized])

  useEffect(() => {
    load()
  }, [load])

  const act = async (body: Record<string, unknown>, done: string) => {
    const r = await fetch('/api/feedback/admin', { method: 'POST', headers: hdr, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (r.status === 401) return onUnauthorized()
    setFlash(r.ok ? done : j.error ?? 'Failed')
    await load()
  }

  return (
    <section className="space-y-3 pt-6 border-t border-slate-800" id="feedback">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <h2 className="text-lg font-semibold text-slate-100 mr-3">Testnet feedback</h2>
        {(['pending', 'approved', 'rejected', 'all'] as Filter[]).map((k) => (
          <button key={k} onClick={() => setFilter(k)} className={`${btn} ${filter === k ? 'border-[#C07838] text-[#D4922A]' : ''}`}>{k} ({counts[k]})</button>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">
        Approve valid, useful feedback with a bonus in tracker points (default {def}, max {max} per item; an account&apos;s feedback category is capped at {max}).
        Rejected and pending items score nothing. Submissions come from <a href="/feedback" className="text-[#D4922A] hover:underline">/feedback</a>.
      </p>
      {flash && <p className="text-xs text-emerald-400">{flash}</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No {filter === 'all' ? '' : filter} feedback.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-800">
                <th className="py-2 pr-2">ID</th><th className="pr-2">Account</th><th className="pr-2">Category</th><th className="pr-2">Area</th>
                <th className="pr-2">Description</th><th className="pr-2">Contact</th><th className="pr-2">Status</th><th className="pr-2">Sent</th>
                <th className="pr-2">Notes</th><th>Review</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <Row key={r.id} r={r} def={def} max={max} act={act} token={token} onOpen={setBig} />)}
            </tbody>
          </table>
        </div>
      )}
      {big && (
        <div role="dialog" aria-label="Screenshot" className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 cursor-zoom-out" onClick={() => setBig(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={big} alt="Screenshot (enlarged)" className="max-h-full max-w-full rounded shadow-2xl" />
          <button type="button" className="absolute top-4 right-4 rounded bg-slate-900/80 px-3 py-1 text-sm text-slate-200" onClick={() => setBig(null)}>Close ✕</button>
        </div>
      )}
    </section>
  )
}
