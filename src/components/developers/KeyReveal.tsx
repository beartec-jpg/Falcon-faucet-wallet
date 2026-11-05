// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'
// After checkout redirects to ?checkout=success&session_id=cs_..., lets the buyer reveal their API key once.
// Reveal is click-to-fetch (POST) so link prefetchers cannot consume it.
import { useEffect, useState } from 'react'

type State = { kind: 'idle' | 'loading' | 'pending' | 'revealed' | 'expired' | 'error'; msg?: string } | { kind: 'ready'; key: string; tier: string | null }

export default function KeyReveal() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [st, setSt] = useState<State>({ kind: 'idle' })
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('checkout') === 'success') setSessionId(q.get('session_id'))
  }, [])
  if (!sessionId) return null

  async function reveal(tries = 10) {
    setSt({ kind: 'loading' })
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch('/api/falcon-cloud/reveal-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { setSt({ kind: 'error', msg: j.error ?? 'Could not load your key.' }); return }
        if (j.status === 'ready') { setSt({ kind: 'ready', key: j.key, tier: j.tier }); return }
        if (j.status !== 'pending') { setSt({ kind: j.status }); return }
      } catch { setSt({ kind: 'error', msg: 'Could not load your key.' }); return }
      await new Promise((ok) => setTimeout(ok, 3000))
    }
    setSt({ kind: 'pending' })
  }

  return (
    <div className="rounded-lg border border-emerald-700 bg-emerald-950/40 p-3 text-xs space-y-2" data-testid="key-reveal">
      <p className="font-semibold text-emerald-200">Thanks, your subscription is active.</p>
      {st.kind === 'ready' ? (
        <>
          <p>Your {st.tier ?? ''} API key. Copy it now: it is shown only once and we keep only a hash.</p>
          <code className="block break-all rounded bg-slate-900 p-2 text-amber-200" data-testid="api-key-value">{st.key}</code>
          <button type="button" className="rounded bg-slate-700 px-3 py-1" onClick={() => navigator.clipboard?.writeText(st.key)}>Copy</button>
        </>
      ) : st.kind === 'revealed' ? (
        <p>This key has already been shown. If you lost it, contact BEARTEC to rotate it.</p>
      ) : st.kind === 'expired' ? (
        <p>The reveal window has passed. Contact BEARTEC to get a new key.</p>
      ) : st.kind === 'pending' ? (
        <p>Your payment is still being confirmed. <button type="button" className="underline" onClick={() => reveal()}>Try again</button></p>
      ) : st.kind === 'error' ? (
        <p className="text-rose-300">{st.msg} <button type="button" className="underline" onClick={() => reveal()}>Retry</button></p>
      ) : (
        <button type="button" disabled={st.kind === 'loading'} onClick={() => reveal()} data-testid="reveal-key"
          className="rounded bg-emerald-600 px-3 py-1.5 font-semibold text-white disabled:opacity-60">
          {st.kind === 'loading' ? 'Loading…' : 'Show my API key (once)'}
        </button>
      )}
    </div>
  )
}
