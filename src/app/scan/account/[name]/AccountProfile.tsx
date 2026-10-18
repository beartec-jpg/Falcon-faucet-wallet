'use client'

// /scan/account/[name] — one account's testnet activity: chain state from
// account_query, category breakdown, active days, bridge history, and the
// operator view for validator seats. No linkage details are ever shown.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import ProductShell from '@/components/ProductShell'
import { C, Empty, Panel, Stat, Status, mono } from '@/components/explorer/RailsPoolsTabs'
import { CATEGORY_LABEL } from '@/components/explorer/TrackerBoard'
import { TRACKER_MAX_SCORE, type TrackerCategory } from '@/config/tracker'
import { FEEDBACK_CATEGORY_LABEL } from '@/config/feedback'
import type { ApprovedFeedback } from '@/lib/feedback-store'
import type { StoredEvent } from '@/lib/activity-index'
import type { Classification, OperatorRow, TrackerRow } from '@/lib/tracker'
import { formatUnits } from '@/lib/pl-exact-json'
import { ASSET_DECIMALS } from '@/lib/rails-pools'

interface Profile {
  generated_at: number
  account: string
  chain: { balance: string | number; sequence: number; account_type: string | null; assets: Record<string, string | number>; lp: { pool_id: string; lp: string | number }[]; lend_positions: { asset: string; shares: string | number }[] } | null
  classification: Classification
  row: TrackerRow | null
  rank: number | null
  scored_with_group: boolean
  active_days: string[]
  events: StoredEvent[]
  operator: OperatorRow | null
  feedback?: ApprovedFeedback[]
  error?: string
}

const fmt = (n: number, d = 1) => n.toLocaleString('en-US', { maximumFractionDigits: d })
const KIND_LABEL: Record<string, string> = { user: 'Participant', operator: 'Validator seat', system: 'System account', test: 'Test account', harness: 'Load-test wallet' }

function DayGrid({ days, now }: { days: string[]; now: number }) {
  const set = new Set(days)
  const cells = Array.from({ length: 60 }, (_, i) => new Date(now - (59 - i) * 86_400_000).toISOString().slice(0, 10))
  return (
    <div>
      <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(30, minmax(0, 1fr))' }}>
        {cells.map((d) => (
          <div key={d} title={d} className="h-3 rounded-sm" style={{ background: set.has(d) ? C.copper : '#1E293B' }} />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-slate-600 mt-1" style={mono}><span>{cells[0]}</span><span>today</span></div>
    </div>
  )
}

export default function AccountProfile({ name }: { name: string }) {
  const [p, setP] = useState<Profile | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    fetch(`/api/scan/account/${encodeURIComponent(name)}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
        setP(j)
      })
      .catch((e) => setErr(String(e.message ?? e)))
  }, [name])

  return (
    <ProductShell intensity={0.4} className="bg-slate-950 text-slate-100">
      <Header current="scan" subtitle="Falcon PL · 2300" />
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8 space-y-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <Link href="/scan" className="text-xs text-slate-500 hover:text-slate-300">← Explorer</Link>
          <h1 className="text-2xl font-semibold break-all" style={{ ...mono, color: C.cream }}>{name}</h1>
          {p && (
            <span className="text-xs px-2 py-0.5 rounded border" style={{ borderColor: C.copper, color: C.gold }}>{KIND_LABEL[p.classification.kind]}</span>
          )}
        </div>
        {!p ? (
          <Status err={err} what="account" />
        ) : (
          <>
            {p.classification.kind !== 'user' && (
              <Panel title="Not on the activity board">
                <p className="text-xs text-slate-400">
                  {p.classification.reason}.{' '}
                  {p.classification.kind === 'operator' ? 'Validator seats are ranked on the separate operators board.' : 'Accounts of this kind are not ranked on the testnet activity leaderboard.'}
                </p>
              </Panel>
            )}
            {p.scored_with_group && (
              <Panel title="Scored with related accounts">
                <p className="text-xs text-slate-400">This account is scored together with related accounts, so another account represents the group on the board.</p>
              </Panel>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="On chain">
                {p.chain ? (
                  <div className="grid grid-cols-2 gap-4">
                    <Stat k="FPL balance" v={formatUnits(String(p.chain.balance), 0)} />
                    <Stat k="Transactions" v={fmt(Number(p.chain.sequence), 0)} sub="account sequence" />
                    <Stat k="Account type" v={p.chain.account_type ?? '—'} />
                    <Stat k="Assets" v={Object.keys(p.chain.assets || {}).length ? Object.entries(p.chain.assets).map(([a, v]) => `${formatUnits(String(v), ASSET_DECIMALS[a] ?? 0, 4)} ${a}`).join(' · ') : '—'} />
                  </div>
                ) : (
                  <Empty text="Account not found on the node, or the node is unreachable." />
                )}
              </Panel>
              <Panel title="Testnet activity">
                {p.row ? (
                  <div className="flex flex-wrap gap-6">
                    <Stat k="Score" v={`${fmt(p.row.score)} / ${TRACKER_MAX_SCORE}`} sub="100 activity + feedback bonus" />
                    <Stat k="Rank" v={p.rank ? `#${p.rank}` : '—'} sub={p.rank ? undefined : 'not ranked yet'} />
                    <Stat k="Active days" v={String(p.active_days.length)} sub="last 60 days" />
                  </div>
                ) : p.operator ? (
                  <div className="flex flex-wrap gap-6">
                    <Stat k="Epoch work share" v={`${fmt(p.operator.work_share)}%`} />
                    <Stat k="Status" v={p.operator.jailed ? 'jailed' : p.operator.online ? 'online' : 'offline'} />
                    <Stat k="Blocks sealed" v={fmt(p.operator.pack_count, 0)} />
                    <Stat k="Bond" v={fmt(p.operator.bond, 0)} />
                  </div>
                ) : (
                  <Empty text="Not ranked." />
                )}
              </Panel>
            </div>
            {p.row && (
              <Panel title="Categories" note="Hover or tap a row for the underlying numbers. Categories marked n/a have no per-account data yet.">
                <div className="space-y-2">
                  {(Object.keys(p.row.categories) as TrackerCategory[]).map((k) => {
                    const c = p.row!.categories[k]
                    return (
                      <div key={k} className="grid grid-cols-[110px_1fr_70px] items-center gap-3 text-xs" title={c.detail}>
                        <span className="text-slate-400">{CATEGORY_LABEL[k]}</span>
                        <div className="h-2 rounded bg-slate-800 overflow-hidden">
                          <div className="h-full" style={{ width: `${(c.points / c.cap) * 100}%`, background: C.copper }} />
                        </div>
                        <span className="text-right" style={{ ...mono, color: c.tracked ? C.cream : '#475569' }}>{c.tracked ? `${fmt(c.points)}/${c.cap}` : 'n/a'}</span>
                        <span className="col-span-3 -mt-1 text-[10px] text-slate-600">{c.detail}</span>
                      </div>
                    )
                  })}
                </div>
              </Panel>
            )}
            {p.row && (
              <Panel title="Approved feedback" note="Bonus points from testnet feedback approved by the team (Feedback category, capped).">
                {!p.feedback?.length ? (
                  <Empty text="No approved feedback yet. Send some from the feedback page." />
                ) : (
                  <table className="w-full text-xs"><tbody>
                    {p.feedback.map((f) => (
                      <tr key={f.id} className="border-b border-slate-800/50">
                        <td className="py-1.5 pr-3" style={{ color: C.gold }}>{FEEDBACK_CATEGORY_LABEL[f.category] ?? f.category}</td>
                        <td className="pr-3 text-slate-300">{f.area}</td>
                        <td className="pr-3 text-right" style={{ ...mono, color: C.cream }}>+{f.bonus}</td>
                        <td className="text-slate-500" style={mono}>{f.day}</td>
                      </tr>
                    ))}
                  </tbody></table>
                )}
                <p className="mt-2 text-[11px]"><Link href="/feedback" className="hover:underline" style={{ color: C.gold }}>Send feedback →</Link></p>
              </Panel>
            )}
            <Panel title="Active days (last 60)" note="A day counts when the account sent a transaction, held liquidity or a lending position, bridged, or claimed from the faucet. Tracking of on-chain days started with the tracker.">
              <DayGrid days={p.active_days} now={p.generated_at} />
            </Panel>
            <Panel title="Bridge activity">
              {p.events.length === 0 ? (
                <Empty text="No bridge transfers recorded for this account." />
              ) : (
                <table className="w-full text-xs"><tbody>
                  {p.events.map((e) => (
                    <tr key={e.id} className="border-b border-slate-800/50">
                      <td className="py-1.5 pr-3" style={{ color: e.kind === 'bridge_in' ? C.gold : C.copper }}>{e.kind === 'bridge_in' ? 'Deposit' : 'Withdrawal'}</td>
                      <td className="pr-3 text-right" style={{ ...mono, color: C.cream }}>{formatUnits(e.amount, ASSET_DECIMALS[e.asset] ?? 0)} {e.asset}</td>
                      <td className="pr-3 text-slate-400">{e.status}</td>
                      <td className="text-slate-500" style={mono}>{new Date(e.first_seen).toISOString().slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody></table>
              )}
            </Panel>
            <p className="text-[10px] text-slate-600" style={mono}>Testnet activity only. <Link href="/scan/methodology" className="hover:underline">How it&apos;s counted</Link></p>
          </>
        )}
      </main>
    </ProductShell>
  )
}
