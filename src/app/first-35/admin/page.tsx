'use client'

// First 35 admin. The token is typed once and kept in sessionStorage only (never in the URL);
// every request sends it as a Bearer header and the server checks it against FIRST35_ADMIN_TOKEN.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { FIRST35_SEATS, FIRST35_TIERS } from '@/config/first35'
import type { First35Application, First35Status } from '@/lib/first35-store'

type Row = First35Application & { tier_fpl: number | null; last_active: string | null }
type Filter = 'all' | First35Status
type Draft = { account: string; telegram: string; discord: string; x_handle: string; note: string; status: First35Status; seat: string }

const EMPTY: Draft = { account: '', telegram: '', discord: '', x_handle: '', note: '', status: 'pending', seat: '' }
const KEY = 'f35t'
const fmt = (n: number) => n.toLocaleString('en-GB')

function tierFor(seat: string | number | null): number | null {
  const s = Number(seat)
  if (!seat || !Number.isInteger(s)) return null
  return FIRST35_TIERS.find((t) => s >= t.from && s <= t.to)?.fpl ?? null
}

function daysAgo(day: string | null): { label: string; tone: string } {
  if (!day) return { label: 'no activity seen', tone: 'bg-slate-600' }
  const d = Math.floor((Date.now() - Date.parse(day + 'T00:00:00Z')) / 86_400_000)
  const label = d <= 0 ? `today (${day})` : `${d}d ago (${day})`
  return { label, tone: d <= 7 ? 'bg-emerald-400' : d <= 21 ? 'bg-amber-400' : 'bg-red-400' }
}

const input = 'rounded bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-sm w-full'
const btn = 'rounded px-2 py-1 text-xs border border-slate-700 hover:border-slate-500'
const STATUS_TONE: Record<First35Status, string> = { approved: 'text-amber-400', pending: 'text-slate-300', revoked: 'text-red-400' }

function EntryForm({ initial, title, submit, onCancel }: { initial: Draft; title: string; submit: (d: Draft) => Promise<string | null>; onCancel?: () => void }) {
  const [d, setD] = useState<Draft>(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => setD(initial), [initial])
  const f = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value })
  const tier = tierFor(d.seat)
  return (
    <form
      className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setMsg(await submit(d))
        setBusy(false)
      }}
    >
      <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-slate-400 space-y-1">Account name<input className={input} value={d.account} onChange={f('account')} required placeholder="testnet name" /></label>
        <label className="text-xs text-slate-400 space-y-1">Telegram<input className={input} value={d.telegram} onChange={f('telegram')} placeholder="@handle" /></label>
        <label className="text-xs text-slate-400 space-y-1">Discord<input className={input} value={d.discord} onChange={f('discord')} placeholder="handle" /></label>
        <label className="text-xs text-slate-400 space-y-1">X<input className={input} value={d.x_handle} onChange={f('x_handle')} placeholder="@handle" /></label>
        <label className="text-xs text-slate-400 space-y-1">Status
          <select className={input} value={d.status} onChange={f('status')}>
            <option value="pending">pending</option><option value="approved">approved</option><option value="revoked">revoked</option>
          </select>
        </label>
        <label className="text-xs text-slate-400 space-y-1">Seat (optional, 1–{FIRST35_SEATS})
          <input className={input} type="number" min={1} max={FIRST35_SEATS} value={d.seat} onChange={f('seat')} disabled={d.status === 'revoked'} placeholder="—" />
          <span className="block text-[11px] text-slate-500">{tier ? `Tier: ${fmt(tier)} FPL` : 'Tier set by the seat: 1–5 1M · 6–15 500k · 16–35 100k'}</span>
        </label>
        <label className="text-xs text-slate-400 space-y-1 sm:col-span-3">Note<textarea className={input} rows={2} value={d.note} onChange={f('note')} maxLength={500} /></label>
      </div>
      <div className="flex items-center gap-2">
        <button disabled={busy} className="rounded px-3 py-1.5 text-sm bg-[#C07838] text-slate-950 font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
        {onCancel && <button type="button" onClick={onCancel} className={btn}>Cancel</button>}
        {msg && <span className={`text-xs ${msg.startsWith('Saved') ? 'text-emerald-400' : msg.startsWith('Warning') ? 'text-amber-400' : 'text-red-400'}`}>{msg}</span>}
      </div>
      <p className="text-[11px] text-slate-500">Accounts that are not yet registered on testnet can be saved; you will see a warning.</p>
    </form>
  )
}

export default function First35Admin() {
  const [token, setToken] = useState('')
  const [authed, setAuthed] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const hdr = useCallback((t = token) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' }), [token])

  const load = useCallback(async (t: string) => {
    setErr(null)
    const r = await fetch('/api/first35/admin', { headers: hdr(t), cache: 'no-store' })
    if (!r.ok) {
      setAuthed(false)
      setErr(r.status === 401 ? 'Wrong admin password.' : `Could not load (HTTP ${r.status}).`)
      return
    }
    sessionStorage.setItem(KEY, t)
    setAuthed(true)
    setRows((await r.json()).applications)
  }, [hdr])

  useEffect(() => {
    const t = sessionStorage.getItem(KEY) ?? ''
    if (t) {
      setToken(t)
      load(t)
    }
  }, [load])

  const post = async (body: Record<string, unknown>) => {
    const r = await fetch('/api/first35/admin', { method: 'POST', headers: hdr(), body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (r.status === 401) setAuthed(false)
    return { ok: r.ok, error: j.error as string | undefined, warning: j.warning as string | null | undefined }
  }

  const act = async (body: Record<string, unknown>, done: string) => {
    const r = await post(body)
    setFlash(r.ok ? done : r.error ?? 'Failed')
    await load(token)
  }

  const save = (action: 'add' | 'update', id?: number) => async (d: Draft) => {
    const r = await post({ action, id, ...d, seat: d.seat === '' ? null : Number(d.seat) })
    if (!r.ok) return r.error ?? 'Failed'
    await load(token)
    if (action === 'update') setEditing(null)
    else setAdding(false)
    setFlash(r.warning ? `Saved ${d.account}. Warning: ${r.warning}` : `Saved ${d.account}.`)
    return r.warning ? `Warning: ${r.warning}` : 'Saved.'
  }

  const exportCsv = async () => {
    const r = await fetch('/api/first35/admin?format=csv', { headers: hdr(), cache: 'no-store' })
    if (!r.ok) return setFlash('Export failed')
    const url = URL.createObjectURL(await r.blob())
    const a = Object.assign(document.createElement('a'), { href: url, download: `first35-${new Date().toISOString().slice(0, 10)}.csv` })
    a.click()
    URL.revokeObjectURL(url)
  }

  const counts = useMemo(() => {
    const c = { all: rows.length, pending: 0, approved: 0, revoked: 0 }
    for (const r of rows) c[r.status]++
    return c
  }, [rows])
  const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter)
  const taken = new Set(rows.map((r) => r.seat).filter(Boolean))

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-4" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">First 35 — admin</h1>
        {authed && (
          <button onClick={() => { sessionStorage.removeItem(KEY); setToken(''); setAuthed(false); setRows([]) }} className={btn}>Sign out</button>
        )}
      </div>

      {!authed && (
        <form onSubmit={(e) => { e.preventDefault(); load(token) }} className="flex gap-2 max-w-md">
          <input type="password" autoComplete="current-password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Admin password" className={input} />
          <button className="rounded px-3 py-1.5 text-sm bg-[#C07838] text-slate-950 font-semibold">Unlock</button>
        </form>
      )}
      {err && <p className="text-red-400 text-sm">{err}</p>}

      {authed && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400">Seats assigned {taken.size}/{FIRST35_SEATS} · approved {counts.approved}</span>
            <span className="mx-2 h-4 w-px bg-slate-800" />
            {(['all', 'pending', 'approved', 'revoked'] as Filter[]).map((k) => (
              <button key={k} onClick={() => setFilter(k)} className={`${btn} ${filter === k ? 'border-[#C07838] text-[#D4922A]' : ''}`}>{k} ({counts[k]})</button>
            ))}
            <span className="flex-1" />
            <button onClick={exportCsv} className={btn}>Export CSV</button>
            <button onClick={() => { setAdding(!adding); setEditing(null) }} className="rounded px-3 py-1 text-xs bg-[#C07838] text-slate-950 font-semibold">{adding ? 'Close' : '+ Add entry'}</button>
          </div>
          {flash && <p className={`text-xs ${/Warning|fail|already|not found/i.test(flash) ? 'text-amber-400' : 'text-emerald-400'}`}>{flash}</p>}

          {adding && <EntryForm initial={EMPTY} title="Add entry" submit={save('add')} onCancel={() => setAdding(false)} />}
          {editing && (
            <EntryForm
              title={`Edit #${editing.id} · ${editing.account}`}
              initial={{ account: editing.account, telegram: editing.telegram, discord: editing.discord, x_handle: editing.x_handle, note: editing.note, status: editing.status, seat: editing.seat ? String(editing.seat) : '' }}
              submit={save('update', editing.id)}
              onCancel={() => setEditing(null)}
            />
          )}

          {rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400 space-y-2">
              <p className="text-slate-200 font-medium">No entries yet.</p>
              <p>Applications arrive here when people submit the public form on <a href="/first-35" className="text-[#D4922A] hover:underline">/first-35</a>.</p>
              <p>You can also add someone manually with <button onClick={() => setAdding(true)} className="text-[#D4922A] hover:underline">+ Add entry</button>, then approve them and assign a seat.</p>
            </div>
          ) : shown.length === 0 ? (
            <p className="text-sm text-slate-500">No {filter} entries.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-800">
                    <th className="py-2 pr-2">Seat</th><th className="pr-2">Tier</th><th className="pr-2">Account</th><th className="pr-2">Status</th>
                    <th className="pr-2">Last active</th><th className="pr-2">Telegram</th><th className="pr-2">Discord</th><th className="pr-2">X</th>
                    <th className="pr-2">Note</th><th className="pr-2">Added</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const act7 = daysAgo(r.last_active)
                    return (
                      <tr key={r.id} className="border-b border-slate-800/50 align-top">
                        <td className="py-2 pr-2">
                          <select
                            aria-label={`Seat for ${r.account}`}
                            className="rounded bg-slate-900 border border-slate-700 px-1 py-0.5 font-mono"
                            value={r.seat ?? ''}
                            disabled={r.status === 'revoked'}
                            onChange={(e) => act({ action: 'seat', id: r.id, seat: e.target.value === '' ? null : Number(e.target.value) }, `Seat updated for ${r.account}.`)}
                          >
                            <option value="">—</option>
                            {Array.from({ length: FIRST35_SEATS }, (_, i) => i + 1).map((s) => (
                              <option key={s} value={s} disabled={taken.has(s) && s !== r.seat}>{s}</option>
                            ))}
                          </select>
                        </td>
                        <td className="pr-2 font-mono whitespace-nowrap">{r.tier_fpl ? fmt(r.tier_fpl) : '—'}</td>
                        <td className="pr-2 font-mono"><a href={`/scan/account/${encodeURIComponent(r.account)}`} className="hover:underline">{r.account}</a>{r.manual && <span className="ml-1 text-[10px] text-slate-500">manual</span>}</td>
                        <td className={`pr-2 ${STATUS_TONE[r.status]}`}>{r.status}</td>
                        <td className="pr-2 whitespace-nowrap"><span className={`inline-block h-2 w-2 rounded-full mr-1.5 ${act7.tone}`} />{act7.label}</td>
                        <td className="pr-2">{r.telegram}</td><td className="pr-2">{r.discord}</td><td className="pr-2">{r.x_handle}</td>
                        <td className="pr-2 max-w-[14rem] text-slate-400">{r.note}</td>
                        <td className="pr-2 whitespace-nowrap text-slate-500">{r.created_at.slice(0, 10)}</td>
                        <td className="whitespace-nowrap space-x-1">
                          {r.status !== 'approved' && <button className={btn} onClick={() => act({ action: 'status', id: r.id, status: 'approved' }, `Approved ${r.account}.`)}>Approve</button>}
                          {r.status !== 'revoked' && (
                            <button className={btn} onClick={() => confirm(`Revoke ${r.account}? ${r.seat ? `Seat ${r.seat} will be freed for reassignment.` : ''}`) && act({ action: 'status', id: r.id, status: 'revoked' }, `Revoked ${r.account}${r.seat ? `; seat ${r.seat} is free` : ''}.`)}>{r.status === 'approved' ? 'Revoke' : 'Reject'}</button>
                          )}
                          {r.status === 'revoked' && <button className={btn} onClick={() => act({ action: 'status', id: r.id, status: 'pending' }, `${r.account} back to pending.`)}>Reopen</button>}
                          <button className={btn} onClick={() => { setEditing(r); setAdding(false) }}>Edit</button>
                          <button className={`${btn} text-red-400`} onClick={() => confirm(`Delete ${r.account} permanently? This cannot be undone.`) && act({ action: 'delete', id: r.id }, `Deleted ${r.account}.`)}>Delete</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-slate-500">Last active = latest day seen by the testnet activity tracker (transactions, LP, lending, bridge, faucet). Green ≤7d · amber ≤21d · red older.</p>
            </div>
          )}
        </>
      )}
    </main>
  )
}
