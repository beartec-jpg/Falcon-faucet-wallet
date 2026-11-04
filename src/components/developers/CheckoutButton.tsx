// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'
import { useState } from 'react'

export default function CheckoutButton({ tier, label }: { tier: string; label: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function go() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/falcon-cloud/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier }) })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.url) { window.location.href = j.url; return }
      setErr(j.error ?? 'Could not start checkout.')
    } catch { setErr('Could not start checkout.') }
    setBusy(false)
  }
  return (
    <div>
      <button type="button" onClick={go} disabled={busy} data-testid={`subscribe-${tier}`}
        className="mt-1 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60">
        {busy ? 'Opening checkout…' : label}
      </button>
      {err && <p className="mt-1 text-xs text-rose-300">{err}</p>}
    </div>
  )
}
