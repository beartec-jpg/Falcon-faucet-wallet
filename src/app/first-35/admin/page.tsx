'use client'

// Admin list for First 35 applications. The token is entered here and kept in
// sessionStorage only; the server checks it against FIRST35_ADMIN_TOKEN (env).

import { useCallback, useEffect, useState } from 'react'
import type { First35Application, First35Status } from '@/lib/first35-store'

export default function First35Admin() {
  const [token, setToken] = useState('')
  const [rows, setRows] = useState<First35Application[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => setToken(sessionStorage.getItem('f35t') ?? ''), [])
  const load = useCallback(async (t: string) => {
    setErr(null)
    const r = await fetch('/api/first35/admin', { headers: { authorization: `Bearer ${t}` }, cache: 'no-store' })
    if (!r.ok) {
      setRows(null)
      setErr(r.status === 401 ? 'Unauthorized' : `HTTP ${r.status}`)
      return
    }
    sessionStorage.setItem('f35t', t)
    setRows((await r.json()).applications)
  }, [])
  const set = async (id: number, status: First35Status) => {
    await fetch('/api/first35/admin', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ id, status }) })
    load(token)
  }
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-4" style={{ fontFamily: 'Inter, sans-serif' }}>
      <h1 className="text-xl font-semibold">First 35 — applications (admin)</h1>
      <form onSubmit={(e) => { e.preventDefault(); load(token) }} className="flex gap-2">
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Admin token" className="rounded bg-slate-900 border border-slate-700 px-3 py-1.5 text-sm w-80" />
        <button className="rounded px-3 py-1.5 text-sm bg-[#C07838] text-slate-950 font-semibold">Load</button>
      </form>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {rows && (
        <table className="w-full text-xs">
          <thead><tr className="text-left text-slate-500 border-b border-slate-800">
            <th className="py-1.5">#</th><th>Account</th><th>Telegram</th><th>Discord</th><th>X</th><th>Note</th><th>Applied</th><th>Status</th><th />
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-800/50 align-top">
                <td className="py-1.5">{r.id}</td><td className="font-mono"><a href={`/scan`} className="hover:underline">{r.account}</a></td>
                <td>{r.telegram}</td><td>{r.discord}</td><td>{r.x_handle}</td><td className="max-w-xs">{r.note}</td>
                <td>{r.created_at.slice(0, 16)}</td>
                <td className={r.status === 'approved' ? 'text-amber-400' : r.status === 'rejected' ? 'text-red-400' : 'text-slate-400'}>{r.status}</td>
                <td className="space-x-2 whitespace-nowrap">
                  <button onClick={() => set(r.id, 'approved')} className="underline">approve</button>
                  <button onClick={() => set(r.id, 'rejected')} className="underline">reject</button>
                  <button onClick={() => set(r.id, 'pending')} className="underline">reset</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
