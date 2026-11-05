// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'
// Self-serve Free tier key. The key is shown once; only its hash is stored.
import { useState } from 'react'

export default function FreeKeyButton() {
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [key, setKey] = useState<string | null>(null)
  async function go() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/falcon-cloud/free-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acceptTerms: true }) })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.key) setKey(j.key)
      else setErr(j.error ?? 'Could not create a key.')
    } catch { setErr('Could not create a key.') }
    setBusy(false)
  }
  if (key) return (
    <div className="rounded-lg border border-emerald-700 bg-emerald-950/40 p-3 text-xs space-y-2" data-testid="free-key-ready">
      <p>Your Free API key. Copy it now: it is shown only once and we keep only a hash. It starts working within about a minute.</p>
      <code className="block break-all rounded bg-slate-900 p-2 text-amber-200" data-testid="api-key-value">{key}</code>
      <button type="button" className="rounded bg-slate-700 px-3 py-1" onClick={() => navigator.clipboard?.writeText(key)}>Copy</button>
      <p className="text-slate-400">Use it as <code>Authorization: Bearer &lt;key&gt;</code> against <code>https://rpc.falcon-fpl.com</code>.</p>
    </div>
  )
  return (
    <div className="space-y-2 text-xs">
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="free-key-terms" />
        <span>I agree to the <a className="text-amber-300 hover:underline" href="/terms-of-use">Terms of Use</a> (Falcon Cloud schedule).</span>
      </label>
      <button type="button" onClick={go} disabled={!agree || busy} data-testid="free-key-create"
        className="rounded bg-emerald-600 px-3 py-1.5 font-semibold text-white disabled:opacity-60">
        {busy ? 'Creating…' : 'Get a Free API key'}
      </button>
      {err && <p className="text-rose-300">{err}</p>}
    </div>
  )
}
