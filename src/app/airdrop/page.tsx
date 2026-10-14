'use client'

import Link from 'next/link'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/Header'
import ProductShell from '@/components/ProductShell'
import NetworkBanner from '@/components/NetworkBanner'
import { useNetwork } from '@/components/NetworkProvider'
import { withNetworkQuery } from '@/lib/network-query'
import { loadPrimaryWallet } from '@/lib/wallet-store'

type Overview = {
  configured: boolean
  network: string
  genesisAt: string | null
  windowDays: number
  poolFpl?: number
  poolFalcon: number
  firstEmissionEpoch: number
  windowOpen: boolean
  windowEndsAt: string | null
  daysElapsed: number | null
  notes: string | null
  totalAddresses: number
  totalAllocatedFpl?: number
  totalAllocatedFalcon: number
}

type Me = {
  address: string
  scoreFaucet: number
  faucetActiveDays: number
  faucetClaims: number
  scoreValidator: number
  scoreSetup: number
  scoreDexLp: number
  scoreTotal: number
  fplAmount?: number
  falconAmount: number
  claimed: boolean
  claimsByDay: Record<string, number>
}

function fmt(n: number, d = 2) {
  return n.toLocaleString(undefined, { maximumFractionDigits: d })
}

export default function AirdropPage() {
  const { networkKey } = useNetwork()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadOverview = useCallback(async () => {
    const r = await fetch(withNetworkQuery('/api/airdrop/overview', networkKey))
    const j = await r.json()
    if (!r.ok) throw new Error(j.error ?? 'Failed to load airdrop overview')
    setOverview(j as Overview)
  }, [networkKey])

  const loadMe = useCallback(
    async (addr: string) => {
      if (!addr) {
        setMe(null)
        return
      }
      const r = await fetch(
        withNetworkQuery(`/api/airdrop/me?address=${encodeURIComponent(addr)}`, networkKey),
      )
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Failed to load allocation')
      setMe(j.me as Me)
      if (j.overview) setOverview(j.overview as Overview)
    },
    [networkKey],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    loadPrimaryWallet()
      .then(async (w) => {
        if (cancelled) return
        if (w?.address) setAddress(w.address)
        await loadOverview()
        if (w?.address) await loadMe(w.address)
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
  }, [loadOverview, loadMe])

  return (
    <ProductShell intensity={0.4} className="bg-slate-950 text-slate-100">
      <Header current="airdrop" />
      <NetworkBanner />
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Community allocation</h1>
          <p className="text-sm text-slate-400 mt-1">
            Proposed model. Nothing is promised and everything here is subject to change until the mainnet
            parameter sheet is published.
          </p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-2 text-xs text-slate-300">
          <h2 className="text-sm font-semibold text-white">How the 2B community bucket is planned</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="text-white">1B pre-mainnet airdrop</span>: from a frozen snapshot of testnet activity, credited at mainnet genesis to the same account name and key.</li>
            <li><span className="text-white">1B release-phase giveaway</span>: paid per epoch during mainnet epochs 1–7 (before protocol emission starts at epoch 8) for arcade, activity and similar, with caps. The pool below is this one.</li>
            <li>Validator operators have a separate operators pool.</li>
            <li>Separately, the <Link href="/first-35" className="text-amber-300 hover:underline">First 35</Link> prize seats (12M FPL) come from the builder pot, and mainnet faucet drips come from the faucet bucket.</li>
          </ul>
          <p className="text-slate-500">Testnet activity: <Link href="/scan" className="text-amber-300 hover:underline">Explorer → Activity</Link>.</p>
        </section>

        {loading && <p className="text-sm text-slate-500">Loading…</p>}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {overview && (
          <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-white">Program</h2>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-slate-950/60 rounded-lg px-3 py-2">
                <div className="text-slate-500">Pool</div>
                <div className="font-mono text-emerald-300 mt-0.5">
                  {fmt(overview.poolFpl ?? overview.poolFalcon, 0)} FPL
                </div>
              </div>
              <div className="bg-slate-950/60 rounded-lg px-3 py-2">
                <div className="text-slate-500">Window</div>
                <div className="font-mono text-slate-200 mt-0.5">{overview.windowDays} days</div>
              </div>
              <div className="bg-slate-950/60 rounded-lg px-3 py-2">
                <div className="text-slate-500">First emission epoch</div>
                <div className="font-mono text-amber-300 mt-0.5">{overview.firstEmissionEpoch}</div>
              </div>
              <div className="bg-slate-950/60 rounded-lg px-3 py-2">
                <div className="text-slate-500">Status</div>
                <div className="font-mono text-slate-200 mt-0.5">
                  {overview.genesisAt
                    ? overview.windowOpen
                      ? `Open · day ${(overview.daysElapsed ?? 0) + 1}`
                      : 'Closed / pending genesis'
                    : 'Awaiting mainnet genesis'}
                </div>
              </div>
            </div>
            {overview.notes && (
              <p className="text-[11px] text-slate-500 leading-relaxed">{overview.notes}</p>
            )}
            {!overview.configured && (
              <p className="text-[11px] text-amber-300/90">
                Database not configured — faucet claims still log to server console; run{' '}
                <code className="text-amber-200">docs/sql/airdrop-schema.sql</code> on Neon for full
                tracker.
              </p>
            )}
          </section>
        )}

        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-white">Release phase: how points are planned</h2>
          <ul className="text-xs text-slate-400 space-y-2 list-disc pl-4">
            <li><span className="text-slate-200">Per epoch</span>: the release pool is split across mainnet epochs 1–7, so each week pays on its own.</li>
            <li><span className="text-slate-200">Activity</span>: DeFi (liquidity, lending, swaps), bridging and payments, log-scaled.</li>
            <li><span className="text-slate-200">Arcade</span>: verified arcade runs linked to your account.</li>
            <li><span className="text-slate-200">Caps</span>: per-epoch and per-account caps; linked accounts are scored as one.</li>
            <li><span className="text-slate-200">Operators</span>: validators are paid from a separate operators pool, not this one.</li>
          </ul>
          <p className="text-[11px] text-slate-500">Draft rules. Nothing promised; subject to change.</p>
        </section>

        <section className="rounded-xl border border-brand-500/25 bg-brand-500/5 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-brand-200">Your allocation</h2>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-xs"
              value={address}
              onChange={(e) => setAddress(e.target.value.trim())}
              placeholder="r…"
            />
            <button
              type="button"
              className="rounded-lg bg-brand-500 text-slate-950 px-3 py-2 text-xs font-semibold"
              onClick={() => loadMe(address).catch((e) => setError(String(e)))}
            >
              Lookup
            </button>
          </div>
          {me && (
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-950/60 rounded-lg px-3 py-2">
                  <div className="text-slate-500">Faucet score</div>
                  <div className="font-mono text-emerald-300 mt-0.5">
                    {(me.scoreFaucet * 100).toFixed(2)}%
                  </div>
                </div>
                <div className="bg-slate-950/60 rounded-lg px-3 py-2">
                  <div className="text-slate-500">Active faucet days</div>
                  <div className="font-mono text-slate-200 mt-0.5">
                    {me.faucetActiveDays} · {me.faucetClaims} claims
                  </div>
                </div>
                <div className="bg-slate-950/60 rounded-lg px-3 py-2">
                  <div className="text-slate-500">Validator / setup / DEX LP</div>
                  <div className="font-mono text-slate-200 mt-0.5">
                    {(me.scoreValidator * 100).toFixed(1)}% / {(me.scoreSetup * 100).toFixed(1)}% /{' '}
                    {(me.scoreDexLp * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="bg-slate-950/60 rounded-lg px-3 py-2">
                  <div className="text-slate-500">Est. FPL (if finalized)</div>
                  <div className="font-mono text-amber-300 mt-0.5">
                    {(me.fplAmount ?? me.falconAmount) > 0 ? fmt(me.fplAmount ?? me.falconAmount, 2) : '— (after freeze)'}
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-slate-500">
                Validator / DEX LP scores populate when snapshot jobs run. Faucet days update as you
                claim (with DB logging enabled).
              </p>
            </div>
          )}
        </section>
      </main>
    </ProductShell>
  )
}
