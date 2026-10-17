'use client'

import { useEffect, useState } from 'react'
import { loadPrimaryWallet } from '@/lib/wallet-store'

const C = { copper: '#C07838', gold: '#D4922A', panel: '#0F172A', cream: '#E0DBCA' }
const mono = { fontFamily: "'JetBrains Mono', ui-monospace, monospace" }

export function Seats({ total }: { total: number }) {
  const [s, setS] = useState<{ filled: number; remaining: number; holders?: { seat: number | null; account: string; tier_fpl: number | null }[] } | null>(null)
  useEffect(() => {
    fetch('/api/first35/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setS(j))
      .catch(() => {})
  }, [])
  const filled = s?.filled ?? 0
  return (
    <div className="max-w-md mx-auto pt-2">
      <div className="flex justify-between text-xs text-slate-400 mb-1" style={mono}>
        <span>{s ? `${filled} filled` : '…'}</span>
        <span>{s ? `${s.remaining} of ${total} remaining` : ''}</span>
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
        {Array.from({ length: total }, (_, i) => (
          <div key={i} className="h-3 rounded-sm" style={{ background: i < filled ? C.gold : '#1E293B' }} />
        ))}
      </div>
      {!!s?.holders?.length && (
        <div className="mt-3 rounded-lg border p-3" style={{ background: C.panel, borderColor: '#1E293B' }}>
          <div className="text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: C.gold }}>Seat holders</div>
          <ul className="space-y-0.5 text-xs" style={mono}>
            {s.holders.map((h) => (
              <li key={h.account} className="flex justify-between gap-3 text-slate-300">
                <span><span className="text-slate-500">#{h.seat ?? '—'}</span> <a href={`/scan/account/${encodeURIComponent(h.account)}`} className="hover:underline">{h.account}</a></span>
                <span className="text-slate-500">{h.tier_fpl ? `${h.tier_fpl.toLocaleString()} FPL` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

const FIELDS = [
  { k: 'account', label: 'Falcon PL wallet name', ph: 'e.g. yourname' },
  { k: 'telegram', label: 'Telegram handle', ph: '@handle', optional: true },
  { k: 'discord', label: 'Discord handle', ph: 'handle', optional: true },
  { k: 'x_handle', label: 'X handle', ph: '@handle', optional: true },
] as const

export function Form() {
  const [v, setV] = useState<Record<string, string>>({ account: '', telegram: '', discord: '', x_handle: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [acctHint, setAcctHint] = useState<{ ok: boolean; text: string } | null>(null)
  // Prefill from the wallet on this device (on-chain account name), if any.
  useEffect(() => {
    loadPrimaryWallet()
      .then((w) => {
        const n = w?.accountName?.trim().toLowerCase()
        if (n) setV((cur) => (cur.account ? cur : { ...cur, account: n }))
      })
      .catch(() => {})
  }, [])
  const checkAccount = async (name: string) => {
    const n = name.trim().toLowerCase()
    if (!n) return setAcctHint(null)
    try {
      const r = await fetch(`/api/wallet/account?address=${encodeURIComponent(n)}`, { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      setAcctHint(j.exists === false ? { ok: false, text: 'No Falcon PL wallet with that name.' } : j.exists ? { ok: true, text: 'Wallet found.' } : null)
    } catch {
      setAcctHint(null)
    }
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (![v.telegram, v.discord, v.x_handle].some((x) => x.trim())) {
      setMsg({ ok: false, text: 'Enter at least one of your Telegram, Discord or X handles.' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch('/api/first35/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v) })
      const j = await r.json().catch(() => ({}))
      setMsg(r.ok ? { ok: true, text: 'Application received. Keep testing; approved seats show on the counter above.' } : { ok: false, text: j.error || 'Something went wrong.' })
    } catch {
      setMsg({ ok: false, text: 'Network error. Try again.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="rounded-xl border p-5 space-y-3" style={{ background: C.panel, borderColor: '#1E293B' }}>
      <h2 className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: C.gold }}>Apply for a seat</h2>
      {FIELDS.map((f) => (
        <label key={f.k} className="block text-xs text-slate-400">
          {f.label}
          {'optional' in f && <span className="text-slate-600"> (at least one of Telegram, Discord, X)</span>}
          <input
            required={!('optional' in f)}
            value={v[f.k]}
            onChange={(e) => {
              setV({ ...v, [f.k]: e.target.value })
              if (f.k === 'account') setAcctHint(null)
            }}
            onBlur={f.k === 'account' ? (e) => checkAccount(e.target.value) : undefined}
            placeholder={f.ph}
            className="mt-1 w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-[#C07838]"
            style={mono}
          />
          {f.k === 'account' && acctHint && (
            <span className="mt-1 block text-[11px]" style={{ color: acctHint.ok ? C.gold : '#F87171' }}>{acctHint.text}</span>
          )}
        </label>
      ))}
      <label className="block text-xs text-slate-400">
        Short note (what you are testing, optional)
        <textarea
          value={v.note}
          maxLength={500}
          onChange={(e) => setV({ ...v, note: e.target.value })}
          rows={3}
          className="mt-1 w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-[#C07838]"
        />
      </label>
      <button type="submit" disabled={busy} className="w-full rounded-md py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-60" style={{ background: C.copper }}>
        {busy ? 'Sending…' : 'Apply'}
      </button>
      {msg && <p className="text-xs" style={{ color: msg.ok ? C.gold : '#F87171' }}>{msg.text}</p>}
    </form>
  )
}

