'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/Header'
import NetworkBanner from '@/components/NetworkBanner'
import { useNetwork } from '@/components/NetworkProvider'
import { withNetworkQuery } from '@/lib/network-query'
import { loadWallets, type StoredWallet } from '@/lib/wallet-store'
import type { LendOverview } from '@/lib/lend-model'
import {
  LendProtocolBanner,
  LendEmissionsCard,
  LendWalletCard,
  LendHealthCalculator,
  LendSupplyPanel,
  LendBorrowPanel,
  LendPositionsPanel,
} from '@/components/lend/LendPanels'

type Tab = 'overview' | 'supply' | 'borrow' | 'positions'

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin-slow ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'supply', label: 'Supply' },
  { key: 'borrow', label: 'Borrow' },
  { key: 'positions', label: 'Positions' },
]

export default function LendPage() {
  const { networkKey, network } = useNetwork()
  const [tab, setTab] = useState<Tab>('overview')
  const [wallet, setWallet] = useState<StoredWallet | null>(null)
  const [data, setData] = useState<LendOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (address?: string) => {
    const base = address
      ? `/api/lend/overview?address=${encodeURIComponent(address)}`
      : '/api/lend/overview'
    const r = await fetch(withNetworkQuery(base, networkKey))
    const j = await r.json()
    if (!r.ok) throw new Error(j.error ?? 'Failed to load lending data')
    setData(j as LendOverview)
  }, [networkKey])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    loadWallets()
      .then(async (wallets) => {
        const w = wallets[0] ?? null
        if (!cancelled) setWallet(w)
        await refresh(w?.address)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Load failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header current="lend" />
      <NetworkBanner />

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {!network.live && (
          <p className="text-sm text-amber-400">{network.comingSoonMessage ?? 'Network not live.'}</p>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
            <Spinner />
            Loading lending data…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : (
          <>
            <LendProtocolBanner data={data} />

            <div className="flex gap-1 overflow-x-auto nav-scroll pb-0.5">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={
                    tab === t.key
                      ? 'px-3 py-1.5 rounded-lg bg-brand-500/10 text-brand-500 font-medium text-sm whitespace-nowrap'
                      : 'px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 text-sm whitespace-nowrap'
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <div className="space-y-4">
                <LendEmissionsCard data={data} />
                <LendWalletCard data={data} />
                <LendHealthCalculator data={data} />
              </div>
            )}
            {tab === 'supply' && <LendSupplyPanel data={data} />}
            {tab === 'borrow' && <LendBorrowPanel data={data} />}
            {tab === 'positions' && <LendPositionsPanel data={data} />}
          </>
        )}

        {wallet && (
          <p className="text-xs text-slate-600 text-center font-mono truncate">
            {wallet.address}
          </p>
        )}
      </main>
    </div>
  )
}