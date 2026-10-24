'use client'

// Unified Operators view on /airdrop: 100M Operators Pool rules (from config/operators.ts)
// combined with live chain validator stats from /api/scan/tracker (.operators).
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { OPERATORS_CONFIG } from '@/config/operators'
import type { OperatorRow, TrackerResult } from '@/lib/tracker'
import { fmtWorkShare } from '@/lib/work-share-format'

type Op = {
  validator: string
  internal: boolean
  epochsActive: number
  windowEpochs: number
  score: number
  eligible: boolean
  reason: string
  projectedFpl: number
  projectedShare: number
}
type Data = {
  poolFpl: number
  allocatedFpl: number
  returnedFpl: number
  windowStart: string
  windowEpochs: number
  operators: Op[]
}

const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d })
const pct = (x: number) => `${(x * 100).toFixed(0)}%`

export default function OperatorsPool() {
  const [d, setD] = useState<Data | null>(null)
  const [liveOps, setLiveOps] = useState<OperatorRow[]>([])
  const [err, setErr] = useState(false)

  useEffect(() => {
    let alive = true
    const load = () => {
      Promise.all([
        fetch('/api/airdrop/operators', { cache: 'no-store' }).then((r) => (r.ok ? (r.json() as Promise<Data>) : Promise.reject())),
        fetch('/api/scan/tracker', { cache: 'no-store' })
          .then((r) => (r.ok ? (r.json() as Promise<TrackerResult>) : null))
          .catch(() => null),
      ])
        .then(([poolData, trackerData]) => {
          if (!alive) return
          setD(poolData)
          if (trackerData?.operators) setLiveOps(trackerData.operators)
          setErr(false)
        })
        .catch(() => {
          if (alive) setErr(true)
        })
    }
    load()
    const id = setInterval(load, 30_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const c = OPERATORS_CONFIG
  const A = c.airdropFpl
  const liveMap = new Map<string, OperatorRow>(liveOps.map((o) => [o.id, o]))
  const poolMap = new Map<string, Op>((d?.operators ?? []).map((o) => [o.validator, o]))

  const allIds: string[] = []
  const seen = new Set<string>()
  for (const op of d?.operators ?? []) {
    if (!seen.has(op.validator)) {
      seen.add(op.validator)
      allIds.push(op.validator)
    }
  }
  for (const op of liveOps) {
    if (!seen.has(op.id)) {
      seen.add(op.id)
      allIds.push(op.id)
    }
  }

  return (
    <section id="operators-pool" className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 space-y-4 text-xs text-slate-300">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Operators pool &amp; live validator leaderboard</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              100M FPL pre-mainnet operators pool combined with live epoch validator metrics from node status.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/api/scan/tracker?format=csv&board=operators"
              className="px-3 py-1.5 rounded-lg border border-brand-500/40 text-slate-200 hover:bg-brand-500/10 font-mono transition-colors"
            >
              Export CSV ↓
            </a>
            <Link
              href="/validator"
              className="px-3 py-1.5 rounded-lg bg-brand-500/15 border border-brand-500/30 text-brand-300 hover:bg-brand-500/25 font-medium transition-colors"
            >
              Run a Validator →
            </Link>
          </div>
        </div>

        <ul className="list-disc pl-5 space-y-1">
          <li>
            <span className="text-white">Size</span>: up to {fmt(A * c.poolShare)} FPL ({pct(c.poolShare)} of the 1B pre-mainnet airdrop). No operator gets more than {fmt(A * c.maxShare)} FPL ({(c.maxShare * 100).toFixed(0)}%).
          </li>
          <li>
            <span className="text-white">Score</span>: your average share of validator work per epoch, from {c.windowStart} to the mainnet snapshot, counted in chain epochs. Epochs we failed to record are left out, so our outages don&apos;t count against you. Work share is the same split the chain pays on: 50% blocks proposed, 40% votes, 10% presence. An epoch where your seat is jailed or locked counts as 0.
          </li>
          <li>
            <span className="text-white">Eligibility</span>: your seat must be active in at least {pct(c.minActiveFraction)} of the epochs in the window.
          </li>
          <li>
            <span className="text-white">Split</span>: with {c.smallSetMax} or fewer eligible operators, the top score gets {(c.maxShare * 100).toFixed(0)}% of the airdrop ({fmt(A * c.maxShare)} FPL) and the lowest gets {(c.floorShare * 100).toFixed(1)}% ({fmt(A * c.floorShare)} FPL), and everyone in between is scaled linearly by score. A single eligible operator gets {(c.maxShare * 100).toFixed(0)}%. With more than {c.smallSetMax}, the {fmt(A * c.poolShare)} FPL is split by score, still capped at {fmt(A * c.maxShare)} FPL each.
          </li>
          <li>
            <span className="text-white">How the 1B splits</span>: {fmt(A * c.poolShare)} FPL operators pool, {fmt(A * c.userBuffer)} FPL buffer ({pct(c.userBuffer)}, fixed) and {fmt(A * (1 - c.poolShare - c.userBuffer))} FPL for users. Anything the operators pool does not pay out goes to users.
          </li>
          <li>
            <span className="text-white">Excluded</span>: Falcon&apos;s own validator seats, and test, system, bond and watcher accounts. Exception, disclosed: {Object.keys(c.disclosedSeats).join(', ')} is the founder&apos;s personal node and is scored and paid like any other operator.
          </li>
        </ul>

        {err && <p className="text-slate-500">Leaderboard unavailable right now.</p>}

        {d && (
          allIds.length === 0 ? (
            <p className="text-slate-500">No epochs recorded yet since {d.windowStart}.</p>
          ) : (
            <div className="overflow-x-auto pt-2 border-t border-slate-800/80">
              <table className="w-full text-left font-mono text-[11px]">
                <thead className="text-slate-500 border-b border-slate-800">
                  <tr>
                    <th className="py-1.5 pr-2">#</th>
                    <th className="py-1.5 pr-3">Operator</th>
                    <th className="py-1.5 pr-3">Status</th>
                    <th className="py-1.5 pr-3 text-right">Epoch work share</th>
                    <th className="py-1.5 pr-3 text-right">Avg work share</th>
                    <th className="py-1.5 pr-3 text-right">Active epochs</th>
                    <th className="py-1.5 pr-3 text-right">Blocks sealed</th>
                    <th className="py-1.5 pr-3 text-right">Epoch txs</th>
                    <th className="py-1.5 pr-3 text-right">Bond</th>
                    <th className="py-1.5 text-right">Projected (100M pool)</th>
                  </tr>
                </thead>
                <tbody>
                  {allIds.map((id, idx) => {
                    const o = poolMap.get(id)
                    const l = liveMap.get(id)
                    return (
                      <tr key={id} className={`border-b border-slate-800/50 ${o?.eligible ? 'text-slate-200' : 'text-slate-400'}`}>
                        <td className="py-1.5 pr-2 text-slate-600">{idx + 1}</td>
                        <td className="py-1.5 pr-3">
                          <Link href={`/scan/account/${encodeURIComponent(id)}`} className="text-brand-300 hover:underline">
                            {id}
                          </Link>
                          {c.disclosedSeats[id] && (
                            <div className="text-[10px] text-amber-400/80 font-sans">{c.disclosedSeats[id]}</div>
                          )}
                        </td>
                        <td className="py-1.5 pr-3">
                          {!l ? (
                            <span className="text-slate-600">—</span>
                          ) : l.jailed ? (
                            <span className="text-red-400">jailed</span>
                          ) : l.online ? (
                            <span className="text-emerald-400">online</span>
                          ) : (
                            <span className="text-amber-400">offline</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-amber-300">
                          {l ? `${fmtWorkShare(l.work_share)}%` : '—'}
                        </td>
                        <td className="py-1.5 pr-3 text-right">
                          {o ? `${fmtWorkShare(o.score)}%` : '—'}
                        </td>
                        <td className="py-1.5 pr-3 text-right">
                          {o ? `${o.epochsActive}/${o.windowEpochs}` : '—'}
                        </td>
                        <td className="py-1.5 pr-3 text-right">
                          {l ? fmt(l.pack_count) : '—'}
                        </td>
                        <td className="py-1.5 pr-3 text-right">
                          {l ? fmt(l.epoch_pack_txs) : '—'}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-slate-400">
                          {l ? fmt(l.bond) : '—'}
                        </td>
                        <td className="py-1.5 text-right">
                          {o ? (
                            o.eligible ? (
                              <span className="text-emerald-300">
                                {fmt(o.projectedFpl)} FPL ({(o.projectedShare * 100).toFixed(2)}%)
                              </span>
                            ) : (
                              <span className="text-slate-500">{o.reason}</span>
                            )
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        )}

        <p className="text-[11px] text-slate-500">
          Projection from epochs recorded so far ({d?.windowEpochs ?? 0}). Proposed rules; nothing promised and subject to change until the mainnet parameter sheet is published.
        </p>
      </div>
    </section>
  )
}
