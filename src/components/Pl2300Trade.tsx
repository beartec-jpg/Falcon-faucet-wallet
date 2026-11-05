// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'

import { useEffect, useState } from 'react'
import PlFplMarkets from '@/components/PlFplMarkets'
import PlOrderBookPro from '@/components/PlOrderBookPro'

type Tab = 'swap' | 'pro'
const KEY = 'falcon.swap.tab'

/** Falcon PL 2300 swap page: simple AMM Swap, or Pro (on-ledger order book). */
export default function Pl2300Trade({ embedded = false }: { embedded?: boolean }) {
  const [tab, setTab] = useState<Tab>('swap')
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('mode')
    const saved = q === 'pro' || q === 'swap' ? q : window.localStorage.getItem(KEY)
    if (saved === 'pro' || saved === 'swap') setTab(saved)
  }, [])
  const pick = (t: Tab) => {
    setTab(t)
    try {
      window.localStorage.setItem(KEY, t)
    } catch {}
  }
  return (
    <main className={`flex-1 px-4 ${embedded ? 'pt-0 pb-8' : 'py-8'} ${tab === 'pro' ? 'max-w-6xl' : 'max-w-2xl'} mx-auto w-full space-y-4`}>
      <div className="mx-auto flex w-full max-w-xs gap-1 rounded-xl border border-slate-700/80 bg-slate-950/40 p-1 text-sm" role="tablist" aria-label="Trade mode">
        {(['swap', 'pro'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => pick(t)}
            className={`flex-1 rounded-lg py-1.5 font-medium transition ${tab === t ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {t === 'swap' ? 'Swap' : 'Order book'}
          </button>
        ))}
      </div>
      {tab === 'swap' ? <PlFplMarkets mode="swap" /> : <PlOrderBookPro />}
    </main>
  )
}
