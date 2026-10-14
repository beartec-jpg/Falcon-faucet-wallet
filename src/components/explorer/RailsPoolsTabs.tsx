'use client'

// Rails / Pools / Activity tabs for /scan. Everything shown comes from
// /api/scan/rails-pools (node status + account_query + the activity index).
// Anything the node does not expose is shown as "not exposed", never estimated.

import { useEffect, useState } from 'react'
import type { RailsPoolsPayload } from '@/lib/rails-pools-server'
import type { PoolView, RailView, Transfer } from '@/lib/rails-pools'
import { formatUnits } from '@/lib/pl-exact-json'

export const C = { copper: '#C07838', gold: '#D4922A', bg: '#020617', panel: '#0F172A', cream: '#E0DBCA' }
export const mono = { fontFamily: "'JetBrains Mono', ui-monospace, monospace" }

function useRailsPools() {
  const [d, setD] = useState<RailsPoolsPayload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    const load = () =>
      fetch('/api/scan/rails-pools', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((j) => live && (setD(j), setErr(null)))
        .catch((e) => live && setErr(String(e.message ?? e)))
    load()
    const t = setInterval(load, 30_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [])
  return { d, err }
}

const fmt = (n: number | null | undefined, max = 2) => (n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: max }))
const short = (s: string, a = 10, b = 6) => (s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : s)

export function Panel({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="rounded-xl border p-4" style={{ background: C.panel, borderColor: '#1E293B' }}>
      <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: C.gold }}>{title}</h3>
      {children}
      {note && <p className="text-[10px] text-slate-500 mt-3">{note}</p>}
    </section>
  )
}

export function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div>
      <div className="text-lg" style={{ ...mono, color: C.cream }}>{v}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  )
}

export function Empty({ text }: { text: string }) {
  return <div className="text-xs text-slate-500 py-3">{text}</div>
}

export function SubTabs<T extends string>({ items, cur, set }: { items: { id: T; label: string }[]; cur: T; set: (t: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2 mb-5" role="tablist">
      {items.map((i) => (
        <button key={i.id} type="button" role="tab" aria-selected={cur === i.id} onClick={() => set(i.id)}
          className="px-3 py-1.5 rounded-md text-xs font-medium border transition-colors"
          style={cur === i.id ? { color: C.cream, borderColor: C.copper, background: 'rgba(192,120,56,0.15)' } : { color: '#64748B', borderColor: '#1E293B' }}>
          {i.label}
        </button>
      ))}
    </div>
  )
}

function TransferTable({ rows, dec, unit, empty }: { rows: Transfer[]; dec: number; unit: string; empty: string }) {
  if (!rows.length) return <Empty text={empty} />
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr className="text-slate-500 text-left border-b border-slate-800">
          <th className="py-1.5 pr-3 font-medium">Direction</th><th className="pr-3 font-medium">Falcon account</th>
          <th className="pr-3 font-medium text-right">Amount</th><th className="pr-3 font-medium">External</th><th className="font-medium">Status</th>
        </tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-b border-slate-800/50">
              <td className="py-1.5 pr-3" style={{ color: t.kind === 'bridge_in' ? C.gold : C.copper }}>{t.kind === 'bridge_in' ? 'Deposit' : 'Withdrawal'}</td>
              <td className="pr-3 text-slate-200" style={mono}>{t.account || 'not exposed'}</td>
              <td className="pr-3 text-right" style={{ ...mono, color: C.cream }}>{formatUnits(t.amount, dec)} {unit}</td>
              <td className="pr-3 text-slate-400" style={mono} title={t.external}>{t.external ? short(t.external) : '—'}{t.ext_block ? ` · blk ${t.ext_block}` : ''}</td>
              <td className="text-slate-400">{t.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Leader({ title, rows, render }: { title: string; rows: { account: string }[]; render: (r: never) => string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{title}</div>
      {rows.length === 0 ? <Empty text="No data yet." /> : (
        <ol className="text-xs space-y-1">
          {rows.map((r, i) => (
            <li key={r.account} className="flex justify-between gap-3">
              <span className="text-slate-300 truncate" style={mono}><span className="text-slate-600 mr-2">{i + 1}.</span>{r.account}</span>
              <span style={{ ...mono, color: C.cream }}>{render(r as never)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function Gaps({ gaps }: { gaps: string[] }) {
  if (!gaps.length) return null
  return (
    <Panel title="Not exposed by the node">
      <ul className="text-xs text-slate-400 list-disc pl-4 space-y-1">{gaps.map((g) => <li key={g}>{g}</li>)}</ul>
    </Panel>
  )
}

function RailPanel({ r }: { r: RailView }) {
  const u = r.asset
  const all = [...r.deposits.recent, ...r.withdrawals.list]
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={`${u} bridge — totals`}>
        <div className="grid grid-cols-2 gap-4">
          <Stat k="Total minted" v={`${formatUnits(r.minted, r.decimals)} ${u}`} />
          <Stat k="Total burned" v={`${formatUnits(r.burned, r.decimals)} ${u}`} />
          <Stat k={u === 'BTC' ? 'Locked in vault' : 'Outstanding (locked)'} v={u === 'BTC' && r.vault ? `${formatUnits(String(r.vault.sats), 8)} BTC` : `${formatUnits(r.outstanding, r.decimals)} ${u}`}
            sub={u === 'BTC' && r.vault ? `${r.vault.utxos} UTXOs · outstanding ${formatUnits(r.outstanding, 8)} BTC` : 'minted − burned'} />
          <Stat k="Deposits / withdrawals" v={`${fmt(r.deposits.processed, 0)} / ${fmt(r.withdrawals.list.length, 0)}`} sub={`${r.withdrawals.open} withdrawals open`} />
        </div>
      </Panel>
      <Panel title="Bridge contract & addresses">
        <div className="space-y-2 text-xs">
          {r.addresses.map((a) => (
            <div key={a.label + a.value}>
              <div className="text-slate-500">{a.label} <span className="text-slate-600">· {a.source}</span></div>
              {a.href ? <a href={a.href} target="_blank" rel="noreferrer" className="break-all hover:underline" style={{ ...mono, color: C.gold }}>{a.value}</a>
                : <span className="break-all text-slate-200" style={mono}>{a.value}</span>}
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Relayer & watcher status">
        <div className="grid grid-cols-2 gap-4 mb-3">
          <Stat k={r.headers.kind === 'bitcoin' ? 'BTC header height' : 'Rail header tip'} v={fmt(r.headers.tip_height, 0)} sub={`${fmt(r.headers.count, 0)} headers stored`} />
          <Stat k="Tip hash" v={r.headers.tip_hash ? short(r.headers.tip_hash, 8, 6) : '—'} />
        </div>
        <div className="space-y-1 text-xs">
          {r.relayer.map((x) => (
            <div key={x.label} className="flex justify-between gap-3"><span className="text-slate-500">{x.label}</span><span className="text-slate-200 text-right" style={mono}>{x.value}</span></div>
          ))}
        </div>
      </Panel>
      <Panel title="Fees">
        {r.fees.length === 0 ? <Empty text="Bridge fees are not exposed by the node for this rail." /> : (
          <div className="space-y-2 text-xs">
            {r.fees.map((f) => (
              <div key={f.label}><div className="flex justify-between"><span className="text-slate-400">{f.label}</span><span style={{ ...mono, color: C.cream }}>{f.value}</span></div><div className="text-[10px] text-slate-600">{f.source}</div></div>
            ))}
          </div>
        )}
      </Panel>
      <div className="lg:col-span-2">
        <Panel title="Recent transfers">
          <TransferTable rows={all} dec={r.decimals} unit={u} empty="No transfers in the node's current window." />
        </Panel>
      </div>
      <Panel title="Contributors — top depositors" note="From the node's deposit resolutions plus the explorer's index.">
        <div className="grid grid-cols-2 gap-6">
          <Leader title="By volume" rows={r.depositors.byVolume} render={(x: { volume: string }) => `${formatUnits(x.volume, r.decimals, 4)} ${u}`} />
          <Leader title="By count" rows={r.depositors.byCount} render={(x: { count: number }) => String(x.count)} />
        </div>
      </Panel>
      <Gaps gaps={r.gaps} />
    </div>
  )
}

export function RailsView() {
  const { d, err } = useRailsPools()
  const [cur, setCur] = useState<'USDC' | 'ETH' | 'BTC'>('USDC')
  if (!d) return <Status err={err} what="rails" />
  const r = d.rails.find((x) => x.asset === cur)
  return (
    <div>
      <SubTabs items={d.rails.map((x) => ({ id: x.asset, label: x.asset }))} cur={cur} set={setCur} />
      {r && <RailPanel r={r} />}
      <Footer d={d} />
    </div>
  )
}

function PoolPanel({ p }: { p: PoolView }) {
  const b = p.asset_b
  const ready = p.swaps_window_h >= 1
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={`${p.asset_a} / ${b} — reserves`}>
        <div className="grid grid-cols-2 gap-4">
          <Stat k={`${p.asset_a} reserve`} v={formatUnits(p.reserve_a, 0)} />
          <Stat k={`${b} reserve`} v={formatUnits(p.reserve_b, p.decimals_b)} />
          <Stat k="Price" v={p.price_fpl == null ? '—' : `${fmt(p.price_fpl, 4)} FPL`} sub={`per 1 ${b}`} />
          <Stat k="TVL" v={`${fmt(p.tvl_fpl, 0)} FPL`} sub="2 × FPL reserve" />
        </div>
      </Panel>
      <Panel title="24h activity" note={`Volume is inferred from 5-minute reserve samples (${fmt(p.swaps_window_h, 1)} h of samples), so it is a lower bound.`}>
        <div className="grid grid-cols-2 gap-4">
          <Stat k="24h volume" v={p.volume_24h_fpl == null || !ready ? 'collecting samples' : `${fmt(p.volume_24h_fpl, 0)} FPL`} />
          <Stat k="24h fees (LP value growth)" v={p.lp_growth_24h == null || !ready ? 'collecting samples' : `${fmt(p.lp_growth_24h * 100, 3)}%`} />
          <Stat k="LP holders" v={fmt(p.lp_count, 0)} sub={`${formatUnits(p.lp_supply, 0)} LP supply`} />
        </div>
      </Panel>
      <Panel title="Recent swaps (inferred)">
        {p.recent_swaps.length === 0 ? <Empty text="No reserve moves detected in the sampled window yet." /> : (
          <table className="w-full text-xs"><tbody>
            {p.recent_swaps.map((s) => (
              <tr key={s.at} className="border-b border-slate-800/50">
                <td className="py-1.5 text-slate-500" style={mono}>{new Date(s.at).toISOString().slice(11, 16)} UTC</td>
                <td style={{ color: s.side === 'buy' ? C.gold : C.copper }}>{s.side === 'buy' ? `Bought ${b}` : `Sold ${b}`}</td>
                <td className="text-right" style={{ ...mono, color: C.cream }}>{fmt(s.fpl, 0)} FPL ⇄ {fmt(s.asset, 6)} {b}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </Panel>
      <Panel title="Leaderboard">
        <div className="grid grid-cols-2 gap-6">
          <Leader title="Top LPs" rows={p.top_lps} render={(x: { share: number }) => `${fmt(x.share * 100, 1)}%`} />
          <div><div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Top swappers</div><Empty text="Not exposed: the node does not publish swap senders." /></div>
        </div>
      </Panel>
      <Gaps gaps={p.gaps} />
    </div>
  )
}

function poolLabel(p: PoolView, all: PoolView[]) {
  const pair = `${p.asset_a}/${p.asset_b}`
  const dup = all.filter((x) => `${x.asset_a}/${x.asset_b}` === pair).length > 1
  return dup ? `${pair} · ${p.id}${p.lp_supply === '0' ? ' (empty)' : ''}` : pair
}

export function PoolsView() {
  const { d, err } = useRailsPools()
  const [cur, setCur] = useState<string>('')
  if (!d) return <Status err={err} what="pools" />
  const id = cur || d.pools[0]?.id
  const p = d.pools.find((x) => x.id === id)
  return (
    <div>
      <SubTabs items={d.pools.map((x) => ({ id: x.id, label: poolLabel(x, d.pools) }))} cur={id} set={setCur} />
      {p ? <PoolPanel p={p} /> : <Empty text="No pools on this network." />}
      <Footer d={d} />
    </div>
  )
}

export function Status({ err, what }: { err: string | null; what: string }) {
  return err ? <div className="rounded-lg p-4 border border-red-900 bg-red-950/30 text-red-400 text-sm">Node unavailable: {err}</div>
    : <div className="text-center text-slate-600 py-20 text-sm">Loading {what}…</div>
}

function Footer({ d }: { d: RailsPoolsPayload }) {
  return <p className="text-[10px] text-slate-600 mt-4" style={mono}>Height {fmt(d.height, 0)} · updated {new Date(d.generated_at).toISOString().slice(11, 19)} UTC · sources: node status, account_query, explorer index</p>
}
