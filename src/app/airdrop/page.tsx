'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import ProductShell from '@/components/ProductShell'
import OperatorsPool from '@/components/OperatorsPool'
import PlRewards from '@/components/PlRewards'
import ArcadePrizes from '@/components/ArcadePrizes'
import { TrackerBoard } from '@/components/explorer/TrackerBoard'
import { Form as First35Form, Seats as First35Seats } from '@/app/first-35/First35Client'
import { FIRST35_LINKS, FIRST35_SEATS, FIRST35_TIERS, FIRST35_TOTAL_FPL } from '@/config/first35'
import { loadPrimaryWallet } from '@/lib/wallet-store'
import { plAccountId } from '@/lib/pl-names'
import { TRACKER_MAX_SCORE } from '@/config/tracker'
import { fmtWorkShare } from '@/lib/work-share-format'
import type { OperatorRow, TrackerRow } from '@/lib/tracker'

export type AirdropHubTab = 'activity' | 'operators' | 'first35' | 'claim'

const HUB_TABS: { id: AirdropHubTab; label: string; badge?: string }[] = [
  { id: 'activity', label: 'Wallet Activity', badge: '2B Pool' },
  { id: 'operators', label: 'Operators', badge: '100M Pool' },
  { id: 'first35', label: 'First 35 & Arcade', badge: '13.9M Prizes' },
  { id: 'claim', label: 'Claim Epoch Rewards', badge: 'Live' },
]

interface AccountActivity {
  account: string
  classification: { kind: string; reason: string }
  row: TrackerRow | null
  rank: number | null
  active_days: string[]
  operator: OperatorRow | null
}

const fmt = (n: number, d = 1) => n.toLocaleString('en-US', { maximumFractionDigits: d })
const fplFmt = (n: number) => n.toLocaleString('en-US')

function parseTabFromLocation(): AirdropHubTab {
  if (typeof window === 'undefined') return 'activity'
  const params = new URLSearchParams(window.location.search)
  const q = (params.get('tab') || '').toLowerCase()
  if (q === 'operators' || q === 'validators') return 'operators'
  if (q === 'first35' || q === 'first-35' || q === 'arcade') return 'first35'
  if (q === 'claim' || q === 'rewards') return 'claim'
  if (q === 'activity' || q === 'leaderboard') return 'activity'
  const h = window.location.hash.toLowerCase()
  if (h === '#operators-pool' || h === '#operators') return 'operators'
  if (h === '#arcade-top-5' || h === '#first-35' || h === '#first35') return 'first35'
  if (h === '#claim' || h === '#rewards') return 'claim'
  return 'activity'
}

export default function AirdropPage() {
  const [tab, setTab] = useState<AirdropHubTab>('activity')
  const [account, setAccount] = useState('')
  const [act, setAct] = useState<AccountActivity | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectTab = useCallback((next: AirdropHubTab) => {
    setTab(next)
    if (typeof window !== 'undefined') {
      const url = next === 'activity' ? '/airdrop' : `/airdrop?tab=${next}`
      window.history.replaceState(null, '', url)
    }
  }, [])

  useEffect(() => {
    setTab(parseTabFromLocation())
    const onPop = () => setTab(parseTabFromLocation())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const lookup = useCallback(async (acct: string) => {
    const q = acct.trim().toLowerCase()
    if (!q) return
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/scan/account/${encodeURIComponent(q)}`, { cache: 'no-store' })
      const d = (await r.json()) as AccountActivity & { error?: string }
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setAct(d)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPrimaryWallet().then((w) => {
      if (!w) return
      const id = plAccountId(w)
      if (id) {
        setAccount(id)
        void lookup(id)
      }
    })
  }, [lookup])

  return (
    <ProductShell intensity={0.4}>
      <Header current="airdrop" subtitle="Airdrop · Rewards & Leaderboards" />

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8 space-y-6">
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-brand-400">
                Falcon PL 2300 · Community &amp; Rewards Hub
              </div>
              <h1 className="text-2xl font-bold text-white mt-0.5">
                Airdrop, Leaderboards &amp; Epoch Rewards
              </h1>
            </div>
            <Link
              href="/scan/methodology"
              className="text-xs font-medium text-brand-300 hover:underline"
            >
              How activity is scored →
            </Link>
          </div>

          <div
            role="tablist"
            aria-label="Airdrop and rewards sections"
            className="flex flex-wrap gap-2 border-b border-slate-800 pb-3 pt-1"
          >
            {HUB_TABS.map((t) => {
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`airdrop-tab-${t.id}`}
                  onClick={() => selectTab(t.id)}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold border transition-colors ${
                    active
                      ? 'bg-brand-500/15 text-brand-300 border-brand-500/40 shadow-[0_0_20px_rgba(192,120,56,0.12)]'
                      : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  <span>{t.label}</span>
                  {t.badge && (
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${
                        active
                          ? 'bg-brand-500/20 text-brand-200'
                          : 'bg-slate-800/80 text-slate-400'
                      }`}
                    >
                      {t.badge}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {tab === 'activity' && (
          <div className="space-y-6">
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-xs text-slate-300 space-y-2 leading-relaxed">
              <div className="text-amber-300 font-semibold">How the 2B community bucket is planned</div>
              <ul className="list-disc pl-5 space-y-1 text-slate-400">
                <li>
                  <span className="text-slate-200">1,000,000,000 FPL pre-mainnet airdrop</span> — frozen snapshot of the testnet activity leaderboard before mainnet genesis, with{' '}
                  <button
                    type="button"
                    onClick={() => selectTab('operators')}
                    className="text-amber-300 hover:underline font-medium"
                  >
                    100,000,000 FPL in the operators pool
                  </button>{' '}
                  for external validator seats and at least 900,000,000 FPL for user wallets.
                </li>
                <li>
                  <span className="text-slate-200">1,000,000,000 FPL release-phase giveaway</span> — distributed across epochs 1–7 after release by the same activity rules.
                </li>
                <li>
                  Separately, the{' '}
                  <button
                    type="button"
                    onClick={() => selectTab('first35')}
                    className="text-amber-300 hover:underline font-medium"
                  >
                    First 35 prize seats (12M FPL) &amp; Arcade top 5 (1.9M FPL)
                  </button>{' '}
                  come from the builder pot, and live 7-day testnet emissions can be claimed on{' '}
                  <button
                    type="button"
                    onClick={() => selectTab('claim')}
                    className="text-amber-300 hover:underline font-medium"
                  >
                    Claim Epoch Rewards
                  </button>
                  .
                </li>
                <li>
                  No distribution is live yet and final figures are only fixed when the snapshot is frozen. Numbers and rules below are proposals and may change before mainnet.
                </li>
              </ul>
            </div>

            <div className="card p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-white">Check your wallet activity &amp; allocation</h2>
                  <p className="text-xs text-slate-400">
                    Auto-filled from your browser wallet, or enter any Falcon PL account name.
                  </p>
                </div>
                {act?.account && (
                  <Link
                    href={`/scan/account/${encodeURIComponent(act.account)}`}
                    className="text-xs text-brand-300 hover:underline font-mono"
                  >
                    Full account profile →
                  </Link>
                )}
              </div>

              <div className="flex gap-2">
                <input
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && lookup(account)}
                  placeholder="Falcon PL account name (e.g. alice)"
                  className="input-field font-mono text-xs flex-1"
                  spellCheck={false}
                />
                <button
                  onClick={() => lookup(account)}
                  disabled={loading || !account.trim()}
                  className="btn-primary !w-auto px-4 text-xs"
                >
                  {loading ? '…' : 'Check'}
                </button>
              </div>

              {error && <div className="text-xs text-red-400">{error}</div>}

              {act && (
                <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-4 space-y-4">
                  <div className="flex items-center justify-between text-xs flex-wrap gap-2">
                    <span className="font-mono text-slate-300">{act.account}</span>
                    <div className="flex items-center gap-2">
                      {act.operator && (
                        <button
                          type="button"
                          onClick={() => selectTab('operators')}
                          className="px-2 py-0.5 rounded text-[11px] bg-brand-500/15 text-brand-300 border border-brand-500/30 hover:bg-brand-500/25 transition-colors"
                        >
                          Validator seat · {fmtWorkShare(act.operator.work_share)}% epoch work share →
                        </button>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] ${
                          act.row
                            ? act.rank
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {act.row ? (act.rank ? `Ranked #${act.rank}` : 'Building up') : act.classification.reason}
                      </span>
                    </div>
                  </div>

                  {act.row ? (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div>
                          <div className="text-slate-500">Activity score</div>
                          <div className="text-base font-mono text-white">
                            {fmt(act.row.score)} / {TRACKER_MAX_SCORE}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">Leaderboard rank</div>
                          <div className="text-base font-mono text-white">
                            {act.rank ? `#${act.rank}` : 'Building up'}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">Active days</div>
                          <div className="text-base font-mono text-white">{act.active_days.length}</div>
                        </div>
                        <div>
                          <div className="text-slate-500">Projected FPL</div>
                          <div className="text-base font-mono text-slate-400">— (after freeze)</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 pt-2 border-t border-slate-800/80 text-[11px]">
                        {(
                          [
                            ['Bridging', act.row.categories.bridging.points, act.row.categories.bridging.cap],
                            [
                              'DeFi',
                              act.row.categories.swaps.points +
                                act.row.categories.liquidity.points +
                                act.row.categories.lending.points,
                              40,
                            ],
                            ['Payments', act.row.categories.payments.points, act.row.categories.payments.cap],
                            ['Consistency', act.row.categories.consistency.points, act.row.categories.consistency.cap],
                            ['Faucet', act.row.categories.faucet.points, act.row.categories.faucet.cap],
                          ] as const
                        ).map(([label, pts, cap]) => (
                          <div key={label} className="rounded-lg bg-slate-950/60 border border-slate-800/70 px-2.5 py-1.5">
                            <div className="text-slate-500">{label}</div>
                            <div className="font-mono text-slate-200">
                              {fmt(pts)} / {cap}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : act.operator ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div>
                          <div className="text-slate-500">Epoch work share</div>
                          <div className="text-base font-mono text-white">{fmtWorkShare(act.operator.work_share)}%</div>
                        </div>
                        <div>
                          <div className="text-slate-500">Blocks sealed</div>
                          <div className="text-base font-mono text-white">{fmt(act.operator.pack_count, 0)}</div>
                        </div>
                        <div>
                          <div className="text-slate-500">Status</div>
                          <div className="text-base font-mono text-white">
                            {act.operator.jailed ? 'jailed' : act.operator.online ? 'online' : 'offline'}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">Pool</div>
                          <button
                            type="button"
                            onClick={() => selectTab('operators')}
                            className="text-xs font-mono text-brand-300 hover:underline text-left"
                          >
                            100M Operators pool →
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">
                      No scored activity yet on this account. Bridge, swap, provide liquidity, lend, or claim from the faucet on testnet 2300 to start scoring.
                    </p>
                  )}
                </div>
              )}
            </div>

            <TrackerBoard hideOperatorsTab />

            <div className="card p-5 text-xs text-slate-400 space-y-2 leading-relaxed">
              <div className="text-slate-200 font-semibold">Release-phase giveaway (epochs 1–7)</div>
              <p>
                A second 1,000,000,000 FPL bucket is planned for the first 7 epochs after release (~142.85M FPL per epoch), scored with the same activity model: liquidity &amp; lending 40%, bridging 25%, swaps &amp; payments 15%, consistency 10%, watchers &amp; validators 10% (1% per-account cap per epoch).
              </p>
            </div>
          </div>
        )}

        {tab === 'operators' && <OperatorsPool />}

        {tab === 'first35' && (
          <div className="space-y-8">
            <section className="card p-6 space-y-6 border-slate-800/80">
              <header className="space-y-2">
                <p className="text-xs uppercase tracking-[0.2em] text-[#D4922A] font-mono">
                  First adopters · Builder Pot
                </p>
                <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#E0DBCA]">
                  The First {FIRST35_SEATS}
                </h2>
                <p className="text-sm text-slate-300 max-w-2xl">
                  {FIRST35_SEATS} prize seats for the people who test Falcon PL before mainnet. Seats are paid at mainnet launch, separate from the community airdrop.
                </p>
              </header>

              <First35Seats total={FIRST35_SEATS} />

              <section className="space-y-3">
                <div className="flex items-baseline justify-between flex-wrap gap-2">
                  <h3 className="text-xs uppercase tracking-widest text-[#D4922A] font-semibold">
                    Prize tiers
                  </h3>
                  <span className="text-xs text-slate-400 font-mono">
                    {fplFmt(FIRST35_TOTAL_FPL)} FPL in total, from the builder pot
                  </span>
                </div>
                <div className="grid sm:grid-cols-3 gap-3">
                  {FIRST35_TIERS.map((t) => {
                    const seatsCount = t.to - t.from + 1
                    return (
                      <div
                        key={t.from}
                        className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 space-y-1"
                      >
                        <div className="text-xs text-slate-400">
                          Seats {t.from}–{t.to}
                        </div>
                        <div className="text-xl font-semibold font-mono text-[#E0DBCA]">
                          {fplFmt(t.fpl)} FPL
                        </div>
                        <div className="text-[11px] text-slate-500">
                          each · {seatsCount} seats · {fplFmt(seatsCount * t.fpl)} FPL
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="grid md:grid-cols-2 gap-6 items-start">
                <div className="space-y-3 text-sm text-slate-300">
                  <h3 className="text-xs uppercase tracking-widest text-[#D4922A] font-semibold">
                    How to qualify
                  </h3>
                  <ol className="list-decimal pl-5 space-y-2 text-slate-300">
                    <li>
                      Create a Falcon PL testnet wallet and use the network: claim from the faucet, bridge, swap, add liquidity, lend or play the arcade. Your account appears on the{' '}
                      <button
                        type="button"
                        onClick={() => selectTab('activity')}
                        className="text-[#D4922A] hover:underline"
                      >
                        Wallet Activity board
                      </button>
                      .
                    </li>
                    <li>
                      Join the{' '}
                      <a
                        href={FIRST35_LINKS.telegram}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#D4922A] hover:underline"
                      >
                        Telegram
                      </a>{' '}
                      and{' '}
                      <a
                        href={FIRST35_LINKS.discord}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#D4922A] hover:underline"
                      >
                        Discord
                      </a>
                      , and follow{' '}
                      <a
                        href={FIRST35_LINKS.x}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#D4922A] hover:underline"
                      >
                        @FalconPl52546
                      </a>{' '}
                      on X.
                    </li>
                    <li>Send the form with your testnet account name and your handles.</li>
                  </ol>
                  <p className="text-xs text-slate-400 pt-1">
                    Seats are reviewed and confirmed by the team in order of qualifying applications (tier 1 first, then tier 2, then tier 3). One seat per person.
                  </p>
                </div>

                <First35Form />
              </section>
            </section>

            <ArcadePrizes />

            <section className="card p-5 space-y-1.5 text-xs text-slate-400">
              <div className="text-slate-300 font-medium">Small print</div>
              <p>
                To keep your seat, stay active on testnet (at least one transaction every 14 days) and stay in the community channels until mainnet launch. Inactive, duplicate, sybil or bot seats are revoked and given to the next person in line.
              </p>
              <p>
                Testnet FPL has no cash value. Mainnet FPL prizes are paid at mainnet launch from the builder pot and do not reduce the{' '}
                <button
                  type="button"
                  onClick={() => selectTab('activity')}
                  className="text-[#D4922A] hover:underline"
                >
                  community airdrop
                </button>
                .
              </p>
            </section>
          </div>
        )}

        {tab === 'claim' && <PlRewards embedded />}
      </main>
    </ProductShell>
  )
}
