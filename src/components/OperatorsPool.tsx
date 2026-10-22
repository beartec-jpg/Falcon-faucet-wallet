'use client'

// Operators pool section on /airdrop: rules (from config/operators.ts) and the live leaderboard.
import { useEffect, useState } from 'react'
import { OPERATORS_CONFIG } from '@/config/operators'
import { fmtWorkShare } from '@/lib/work-share-format'

type Op = { validator: string; internal: boolean; epochsActive: number; windowEpochs: number; score: number; eligible: boolean; reason: string; projectedFpl: number; projectedShare: number }
type Data = { poolFpl: number; allocatedFpl: number; returnedFpl: number; windowStart: string; windowEpochs: number; operators: Op[] }

const fmt = (n: number, d = 0) => n.toLocaleString(undefined, { maximumFractionDigits: d })
const pct = (x: number) => `${(x * 100).toFixed(0)}%`

export default function OperatorsPool() {
  const [d, setD] = useState<Data | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    fetch('/api/airdrop/operators', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => setD(j as Data))
      .catch(() => setErr(true))
  }, [])
  const c = OPERATORS_CONFIG
  const A = c.airdropFpl
  return (
    <section id="operators-pool" className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3 text-xs text-slate-300">
      <h2 className="text-sm font-semibold text-white">Operators pool</h2>
      <ul className="list-disc pl-5 space-y-1">
        <li><span className="text-white">Size</span>: up to {fmt(A * c.poolShare)} FPL ({pct(c.poolShare)} of the 1B pre-mainnet airdrop). No operator gets more than {fmt(A * c.maxShare)} FPL ({(c.maxShare * 100).toFixed(0)}%).</li>
        <li><span className="text-white">Score</span>: your average share of validator work per epoch, from {c.windowStart} to the mainnet snapshot, counted in chain epochs. Epochs we failed to record are left out, so our outages don&apos;t count against you. Work share is the same split the chain pays on: 50% blocks proposed, 40% votes, 10% presence. An epoch where your seat is jailed or locked counts as 0.</li>
        <li><span className="text-white">Eligibility</span>: your seat must be active in at least {pct(c.minActiveFraction)} of the epochs in the window.</li>
        <li><span className="text-white">Split</span>: with {c.smallSetMax} or fewer eligible operators, the top score gets {(c.maxShare * 100).toFixed(0)}% of the airdrop ({fmt(A * c.maxShare)} FPL) and the lowest gets {(c.floorShare * 100).toFixed(1)}% ({fmt(A * c.floorShare)} FPL), and everyone in between is scaled linearly by score. A single eligible operator gets {(c.maxShare * 100).toFixed(0)}%. With more than {c.smallSetMax}, the {fmt(A * c.poolShare)} FPL is split by score, still capped at {fmt(A * c.maxShare)} FPL each.</li>
        <li><span className="text-white">How the 1B splits</span>: {fmt(A * c.poolShare)} FPL operators pool, {fmt(A * c.userBuffer)} FPL buffer ({pct(c.userBuffer)}, fixed) and {fmt(A * (1 - c.poolShare - c.userBuffer))} FPL for users. Anything the operators pool does not pay out goes to users.</li>
        <li><span className="text-white">Excluded</span>: Falcon&apos;s own validator seats, and test, system, bond and watcher accounts. Exception, disclosed: {Object.keys(c.disclosedSeats).join(', ')} is the founder&apos;s personal node and is scored and paid like any other operator.</li>
      </ul>
      {err && <p className="text-slate-500">Leaderboard unavailable right now.</p>}
      {d && (
        d.operators.length === 0 ? (
          <p className="text-slate-500">No epochs recorded yet since {d.windowStart}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-[11px]">
              <thead className="text-slate-500">
                <tr><th className="py-1 pr-2">Operator</th><th className="pr-2">Avg work share</th><th className="pr-2">Active epochs</th><th className="pr-2">Projected</th></tr>
              </thead>
              <tbody>
                {d.operators.map((o) => (
                  <tr key={o.validator} className={o.eligible ? 'text-slate-200' : 'text-slate-500'}>
                    <td className="py-1 pr-2">{o.validator}{c.disclosedSeats[o.validator] && <div className="text-[10px] text-amber-400/80 font-sans">{c.disclosedSeats[o.validator]}</div>}</td>
                    <td className="pr-2">{fmtWorkShare(o.score)}%</td>
                    <td className="pr-2">{o.epochsActive}/{o.windowEpochs}</td>
                    <td className="pr-2">{o.eligible ? `${fmt(o.projectedFpl)} FPL (${(o.projectedShare * 100).toFixed(2)}%)` : o.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      <p className="text-[11px] text-slate-500">Projection from epochs recorded so far ({d?.windowEpochs ?? 0}). Proposed rules; nothing promised and subject to change until the mainnet parameter sheet is published.</p>
    </section>
  )
}
