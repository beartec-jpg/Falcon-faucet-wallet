'use client'

// Testnet activity tracker: user board (overall + category views), the
// separate operators board for validators, and links to account profiles.
// Wording rule: "Testnet activity" only; nothing here implies a reward.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { OperatorRow, TrackerResult, TrackerRow } from '@/lib/tracker'
import { fmtWorkShare } from '@/lib/work-share-format'
import type { TrackerCategory } from '@/config/tracker'
import { C, Empty, Panel, Stat, Status, SubTabs, mono } from '@/components/explorer/RailsPoolsTabs'

type Payload = TrackerResult & { generated_at: number }

export const CATEGORY_LABEL: Record<TrackerCategory, string> = {
  bridging: 'Bridging',
  swaps: 'Swaps',
  liquidity: 'Liquidity',
  lending: 'Lending',
  payments: 'Payments',
  consistency: 'Consistency',
  faucet: 'Faucet',
  arcade: 'Arcade',
  infra: 'Infra',
  feedback: 'Feedback',
}

const fmt = (n: number, d = 1) => n.toLocaleString('en-US', { maximumFractionDigits: d })

function useTracker() {
  const [d, setD] = useState<Payload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    const load = () =>
      fetch('/api/scan/tracker', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((j) => live && (setD(j), setErr(null)))
        .catch((e) => live && setErr(String(e.message ?? e)))
    load()
    const t = setInterval(load, 60_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [])
  return { d, err }
}

export function AccountLink({ name }: { name: string }) {
  return (
    <Link href={`/scan/account/${encodeURIComponent(name)}`} className="hover:underline" style={{ color: C.cream }}>
      {name}
    </Link>
  )
}

type View = 'overall' | 'faucet' | 'consistency' | 'defi' | 'bridging' | 'operators'

function UserTable({ rows, view }: { rows: TrackerRow[]; view: View }) {
  const cols: TrackerCategory[] =
    view === 'faucet' ? ['faucet'] : view === 'consistency' ? ['consistency'] : view === 'defi' ? ['liquidity', 'lending', 'swaps'] : view === 'bridging' ? ['bridging'] : ['bridging', 'liquidity', 'lending', 'payments', 'consistency', 'faucet']
  const sorted = view === 'overall' ? rows : [...rows].sort((a, b) => cols.reduce((t, k) => t + b.categories[k].points, 0) - cols.reduce((t, k) => t + a.categories[k].points, 0) || b.score - a.score)
  const shown = view === 'overall' ? sorted : sorted.filter((r) => cols.some((k) => r.categories[k].points > 0))
  if (!shown.length) return <Empty text="No ranked accounts in this category yet." />
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 text-left border-b border-slate-800">
            <th className="py-1.5 pr-2 font-medium">#</th>
            <th className="pr-3 font-medium">Account</th>
            <th className="pr-3 font-medium text-right">Score</th>
            <th className="pr-3 font-medium text-right">Active days</th>
            {cols.map((k) => (
              <th key={k} className="pr-3 font-medium text-right">{CATEGORY_LABEL[k]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={r.account} className="border-b border-slate-800/50" style={mono}>
              <td className="py-1.5 pr-2 text-slate-600">{i + 1}</td>
              <td className="pr-3"><AccountLink name={r.account} /></td>
              <td className="pr-3 text-right" style={{ color: C.gold }}>{fmt(r.score)}</td>
              <td className="pr-3 text-right text-slate-300">{r.active_days}</td>
              {cols.map((k) => {
                const c = r.categories[k]
                return (
                  <td key={k} className="pr-3 text-right text-slate-300" title={c.detail}>
                    {c.tracked ? `${fmt(c.points)} / ${c.cap}` : <span className="text-slate-600">n/a</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OperatorsTable({ rows }: { rows: OperatorRow[] }) {
  if (!rows.length) return <Empty text="No validator seats in status." />
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 text-left border-b border-slate-800">
            <th className="py-1.5 pr-2 font-medium">#</th>
            <th className="pr-3 font-medium">Validator</th>
            <th className="pr-3 font-medium text-right">Epoch work share</th>
            <th className="pr-3 font-medium">Status</th>
            <th className="pr-3 font-medium text-right">Bond</th>
            <th className="pr-3 font-medium text-right">Blocks sealed</th>
            <th className="pr-3 font-medium text-right">Epoch txs packed</th>
            <th className="pr-3 font-medium text-right">Proposer credit</th>
            <th className="font-medium text-right">Vote credit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o, i) => (
            <tr key={o.id} className="border-b border-slate-800/50" style={mono}>
              <td className="py-1.5 pr-2 text-slate-600">{i + 1}</td>
              <td className="pr-3"><AccountLink name={o.id} /></td>
              <td className="pr-3 text-right" style={{ color: C.gold }}>{fmtWorkShare(o.work_share)}%</td>
              <td className="pr-3" style={{ color: o.jailed ? '#F87171' : o.online ? C.gold : '#64748B' }}>{o.jailed ? 'jailed' : o.online ? 'online' : 'offline'}</td>
              <td className="pr-3 text-right text-slate-300">{fmt(o.bond, 0)}</td>
              <td className="pr-3 text-right text-slate-300">{fmt(o.pack_count, 0)}</td>
              <td className="pr-3 text-right text-slate-300">{fmt(o.epoch_pack_txs, 0)}</td>
              <td className="pr-3 text-right text-slate-300">{fmt(o.proposer_credit, 0)}</td>
              <td className="text-right text-slate-300">{fmt(o.vote_credit, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function TrackerBoard({ hideOperatorsTab = false }: { hideOperatorsTab?: boolean } = {}) {
  const { d, err } = useTracker()
  const [view, setView] = useState<View>('overall')
  if (!d) return <Status err={err} what="testnet activity" />
  const k = d.stats.by_kind
  return (
    <div className="space-y-4">
      <SubTabs
        items={[
          { id: 'overall' as View, label: 'Overall' },
          { id: 'bridging' as View, label: 'Bridging' },
          { id: 'defi' as View, label: 'DeFi' },
          { id: 'consistency' as View, label: 'Consistency' },
          { id: 'faucet' as View, label: 'Faucet' },
          ...(hideOperatorsTab ? [] : [{ id: 'operators' as View, label: 'Operators' }]),
        ]}
        cur={view}
        set={setView}
      />
      {view === 'operators' ? (
        <Panel title="Operators board — validator seats" note="Validators are ranked separately from users. Work share mirrors the validator reward split for this epoch: proposer credits 50%, vote credits 40%, floor 10%. Source: node status.">
          <OperatorsTable rows={d.operators} />
          <a href="/api/scan/tracker?format=csv&board=operators" className="inline-block mt-3 text-xs hover:underline" style={{ color: C.gold }}>Export CSV ↓</a>
        </Panel>
      ) : (
        <Panel title="Testnet activity leaderboard" note="Measures testnet activity only. Test, load-test, system and validator accounts are not ranked here. Accounts linked by shared faucet use are scored as one.">
          <div className="flex flex-wrap gap-6 mb-4">
            <Stat k="Ranked" v={fmt(d.board.length, 0)} />
            <Stat k="Building up" v={fmt(d.building.length, 0)} />
            <Stat k="Accounts seen" v={fmt(d.stats.discovered, 0)} sub={d.stats.node_accounts ? `of ${fmt(d.stats.node_accounts, 0)} on the node` : undefined} />
            <Stat k="Not ranked" v={fmt(k.test + k.harness + k.system, 0)} sub={`${k.test} test · ${k.harness} load-test · ${k.system} system`} />
            <div className="self-end flex gap-4 text-xs">
              <a href="/api/scan/tracker?format=csv" className="hover:underline" style={{ color: C.gold }}>Export CSV ↓</a>
              <Link href="/scan/methodology" className="hover:underline" style={{ color: C.gold }}>How it&apos;s counted →</Link>
            </div>
          </div>
          <UserTable rows={d.board} view={view} />
        </Panel>
      )}
      {view !== 'operators' && d.building.length > 0 && (
        <Panel title="Building up" note="Accounts with activity that do not yet meet the ranking threshold (2 categories and 2 active days).">
          <UserTable rows={d.building} view={view} />
        </Panel>
      )}
      <p className="text-[10px] text-slate-600" style={mono}>Updated {new Date(d.generated_at).toISOString().slice(11, 19)} UTC · sources: node status, account_query, explorer index, faucet claims</p>
    </div>
  )
}
