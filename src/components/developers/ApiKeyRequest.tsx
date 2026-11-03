// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'
// STUB behind NEXT_PUBLIC_DEV_PORTAL_KEYS. Makes no network calls: no billing provider, no key issuance.
import { useState } from 'react'
import { Section } from '@/components/content/ContentPage'
import { TIERS, formatGbp } from '@/lib/developers/content'

export default function ApiKeyRequest() {
  const [tier, setTier] = useState<string>('free')
  const [done, setDone] = useState(false)
  return (
    <Section title="Request a key">
      {done ? (
        <p data-testid="api-key-stub-done">Thanks. Self-serve keys are not available yet; nothing was sent or charged. Keys are issued manually on request through BEARTEC.</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            setDone(true)
          }}
        >
          <div className="flex flex-wrap gap-2">
            {TIERS.map((t) => (
              <label key={t.id} className={`cursor-pointer rounded-lg border px-3 py-2 text-xs ${tier === t.id ? 'border-amber-400 text-amber-200' : 'border-slate-700'}`}>
                <input type="radio" name="tier" value={t.id} checked={tier === t.id} onChange={() => setTier(t.id)} className="mr-2" />
                {t.name} · {formatGbp(t.priceGbpMonthly)}{t.priceGbpMonthly ? '/mo' : ''}
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-400">Paid plans will use card billing in GBP when launched. No payment is taken here.</p>
          <button type="submit" className="rounded-lg bg-amber-500/90 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400">Request key</button>
        </form>
      )}
    </Section>
  )
}
