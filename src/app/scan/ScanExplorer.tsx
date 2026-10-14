'use client'

import { PoolsView, RailsView } from '@/components/explorer/RailsPoolsTabs'
import { TrackerBoard } from '@/components/explorer/TrackerBoard'

import { useState, useEffect, useCallback, useRef } from 'react'
import Header from '@/components/Header'
import ProductShell from '@/components/ProductShell'
import Logo from '@/components/Logo'
import type { ScanData, LedgerSummary, ValidatorEntry, RailRow } from '@/lib/scan-types'
import ClickableStatCard from '@/components/explorer/ClickableStatCard'
import EpochEmissionsCard from '@/components/explorer/EpochEmissionsCard'
import SeatBoxes from '@/components/explorer/SeatBoxes'
import MetricModal, { seatOptions } from '@/components/explorer/MetricModal'
import { useLiveSamples, type LiveSamples } from '@/hooks/useLiveSamples'
import { seatKey, seatLag, SERIES_LABELS, type SeatMetric } from '@/lib/net-metrics'

const FETCH_TIMEOUT_MS = 10_000
const POLL_MS = 4_000

function shortHash(h: string) {
  if (!h) return '—'
  return h.slice(0, 8) + '…' + h.slice(-6)
}

function fmtNum(v: unknown, fallback = '—'): string {
  if (typeof v === 'number' && Number.isFinite(v)) return v.toLocaleString('en-US')
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) {
    return Number(v).toLocaleString('en-US')
  }
  return fallback
}

function fmtUptime(secs: number): string {
  const n = Number.isFinite(secs) ? secs : 0
  const d = Math.floor(n / 86400)
  const h = Math.floor((n % 86400) / 3600)
  const m = Math.floor((n % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function meshOf(d: ScanData) {
  const height = Number.isFinite(d.height) ? d.height : d.validated_ledger
  const peers = Number.isFinite(d.peers) ? d.peers : (d.online_seats?.length ?? 0)
  const commit =
    d.commit ||
    `${d.commit_need ?? '—'}-of-${d.committee_size ?? '—'}`
  return { height, peers, commit }
}

function TickerStrip({
  height,
  peers,
  commit,
  state,
}: {
  height: number
  peers: number
  commit: string
  state: string
}) {
  const live = state === 'live'
  return (
    <div className="w-full bg-slate-900 border-b border-slate-800 text-xs text-slate-500 flex items-center gap-6 px-4 py-1.5 overflow-x-auto whitespace-nowrap">
      <span className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400 animate-pulse'}`} />
        <span className={live ? 'text-emerald-400' : 'text-amber-400'}>{state || 'connecting…'}</span>
      </span>
      <span>
        Height <span className="text-slate-300 font-mono">#{fmtNum(height)}</span>
      </span>
      <span>
        Peers <span className="text-slate-300 font-mono">{fmtNum(peers)}</span>
      </span>
      <span>
        Commit <span className="text-slate-300 font-mono">{commit}</span>
      </span>
      <span>
        Network <span className="text-slate-300">Falcon PL 2300</span>
      </span>
    </div>
  )
}

function SearchBar() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const search = async (q: string) => {
    q = q.trim()
    if (!q) {
      setResult(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    try {
      if (/^\d+$/.test(q)) {
        const r = await fetch('/api/scan', { cache: 'no-store', signal: ctrl.signal })
        const d = (await r.json()) as ScanData
        const height = Number.isFinite(d.height) ? d.height : d.validated_ledger
        if (height === Number(q) || d.recent_ledgers.some((l) => l.seq === Number(q))) {
          const hit = d.recent_ledgers.find((l) => l.seq === Number(q))
          setResult({
            kind: 'ledger',
            seq: Number(q),
            hash: hit?.hash ?? d.tip_hash,
            txs: hit?.txn_count ?? d.last_pack.txs,
            packer: hit?.packer ?? d.last_pack.packer,
          })
        } else {
          setError(`Height is ${height}. Older bodies are not kept on light seats.`)
          setResult(null)
        }
        return
      }
      const r = await fetch(`/api/scan?account=${encodeURIComponent(q)}`, { signal: ctrl.signal })
      const d = (await r.json()) as Record<string, unknown>
      if (d.found === false || d.exists === false) {
        setError('Account not found on Falcon PL 2300')
        setResult(null)
        return
      }
      setResult({ kind: 'account', ...d })
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError'
      setError(aborted ? 'Search timed out' : e instanceof Error ? e.message : 'Search failed')
      setResult(null)
    } finally {
      clearTimeout(timer)
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void search(query)
        }}
        className="flex gap-2"
      >
        <input
          className="input-field flex-1"
          placeholder="Search height # or PL account (alice, v1, watcher-browser)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 font-semibold text-sm disabled:opacity-50 transition-colors"
        >
          {loading ? '…' : 'Search'}
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {result && (
        <div className="mt-3 card p-4 text-sm font-mono break-all space-y-1">
          {result.kind === 'ledger' ? (
            <>
              <div className="text-brand-500 font-sans font-semibold text-base mb-2">
                Ledger #{String(result.seq)}
              </div>
              <Row k="Hash" v={String(result.hash ?? '')} />
              <Row k="Packer" v={String(result.packer ?? '')} />
              <Row k="TXs" v={String(result.txs ?? '')} />
            </>
          ) : (
            <>
              <div className="text-brand-500 font-sans font-semibold text-base mb-2">Account</div>
              <Row k="Name" v={String(result.account ?? query)} />
              <Row k="Balance" v={`${Number(result.balance ?? 0).toLocaleString('en-US')} FPL`} />
              <Row k="Sequence" v={String(result.sequence ?? 0)} />
              <Row k="Claimable" v={`${Number(result.claimable ?? 0).toLocaleString('en-US')} FPL`} />
              <Row k="Work" v={String(result.watcher_work ?? 0)} />
              <Row k="Slots" v={String(result.watcher_slots ?? 0)} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-slate-500 w-28 shrink-0">{k}</span>
      <span className="text-slate-200 break-all">{v}</span>
    </div>
  )
}


type ScanTab = 'network' | 'rails' | 'pools' | 'activity'
type ChartTarget = { kind: 'net'; key: string } | { kind: 'seat'; id: string; metric: SeatMetric }

export default function ScanExplorer({
  initialData,
  initialError,
}: {
  initialData: ScanData | null
  initialError: string | null
}) {
  const [data, setData] = useState<ScanData | null>(initialData)
  const [error, setError] = useState<string | null>(initialError)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [tab, setTab] = useState<ScanTab>('network')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inflightRef = useRef(false)
  const live = useLiveSamples(data)
  const [chart, setChart] = useState<ChartTarget | null>(null)
  const closeChart = useCallback(() => setChart(null), [])
  const openNet = useCallback((key: string) => setChart({ kind: 'net', key }), [])

  const fetchData = useCallback(async () => {
    if (inflightRef.current) return
    inflightRef.current = true
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    try {
      const r = await fetch('/api/scan', { cache: 'no-store', signal: ctrl.signal })
      const text = await r.text()
      let d: ScanData & { error?: string }
      try {
        d = JSON.parse(text) as ScanData & { error?: string }
      } catch {
        throw new Error(
          r.ok
            ? 'Invalid response from explorer API'
            : text.slice(0, 120) || `Explorer API ${r.status}`,
        )
      }
      if (!r.ok || d.error) throw new Error(d.error ?? `Explorer API ${r.status}`)
      setData(d)
      setError(null)
      setLastUpdate(new Date())
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError'
      const message = aborted
        ? 'Explorer timed out'
        : e instanceof Error
          ? e.message
          : 'Node unavailable'
      setError(message)
    } finally {
      clearTimeout(timer)
      inflightRef.current = false
    }
  }, [])

  useEffect(() => {
    if (initialData) setLastUpdate(new Date())
    if (!initialData) void fetchData()
    timerRef.current = setInterval(fetchData, POLL_MS)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [fetchData, initialData])

  const d = data
  const mesh = d ? meshOf(d) : null
  const intake = mempoolIntake(live)

  return (
    <ProductShell intensity={0.4} className="bg-slate-950 text-slate-100">
      {tab === 'network' && d && mesh && (
        <TickerStrip
          height={mesh.height}
          peers={mesh.peers}
          commit={mesh.commit}
          state={d.server_state}
        />
      )}

      <Header current="scan" subtitle="Falcon PL · 2300" />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8 space-y-8">
        <Logo />

        <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
          {(
            [
              { id: 'network' as const, label: 'Network' },
              { id: 'rails' as const, label: 'Rails' },
              { id: 'pools' as const, label: 'Pools' },
              { id: 'activity' as const, label: 'Activity' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'bg-brand-500/15 text-brand-300 border border-brand-500/30'
                  : 'text-slate-500 hover:text-slate-300 border border-transparent'
              }`}
            >
              {t.label}
            </button>
          ))}
          <a
            href="/scan/map"
            className="px-4 py-2 rounded-lg text-sm font-medium border border-brand-500/30 text-brand-300 hover:bg-brand-500/10 transition-colors"
          >
            Live network map ↗
          </a>
          {tab === 'activity' && (
            <a
              href="/first-35"
              className="px-4 py-2 rounded-lg text-sm font-medium border border-[#D4922A]/40 text-[#D4922A] hover:bg-[#D4922A]/10 transition-colors"
            >
              The First 35 →
            </a>
          )}
          {lastUpdate && tab === 'network' && (
            <span className="ml-auto self-center text-[10px] text-slate-600 font-mono">
              live · {lastUpdate.toLocaleTimeString()}
            </span>
          )}
        </div>

        {tab === 'rails' && <RailsView />}
        {tab === 'pools' && <PoolsView />}
        {tab === 'activity' && <TrackerBoard />}

        {tab === 'network' && error && (
          <div className="card p-4 border-red-900 bg-red-950/30 text-red-400 text-sm">
            Node unavailable: {error}
            {d ? ' · showing last snapshot' : ''}
          </div>
        )}

        {tab === 'network' && (
          <section>
            <SearchBar />
          </section>
        )}

        {tab === 'network' && d && mesh && (
          <section>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">
              Network overview
            </h2>
            <p className="text-[10px] text-slate-600 mb-3">
              Falcon PL 2300 · Falcon Consensus · Falcon-512
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <ClickableStatCard label="Height" value={`#${fmtNum(mesh.height)}`} accent="text-brand-500" chartKey="height" onChart={openNet} />
              <ClickableStatCard
                label="tx/s (est.)"
                value={live.rate60s ? live.rate60s.tps.toFixed(1) : '…'}
                sub={live.rate60s ? 'sealed · 60s avg' : 'measuring'}
                accent="text-brand-400"
                chartKey="tps"
                onChart={openNet}
              />
              <ClickableStatCard
                label="Blocks / min"
                value={live.rate60s ? live.rate60s.blocks_min.toFixed(1) : '…'}
                sub="60s avg"
                chartKey="blocks_min"
                onChart={openNet}
              />
              <ClickableStatCard
                label="Txs / block"
                value={live.rate60s && live.rate60s.blocks_min > 0 ? live.rate60s.txs_per_block.toFixed(1) : '…'}
                sub={`last ${d.last_pack.txs} tx`}
                chartKey="txs_per_block"
                onChart={openNet}
              />
              <ClickableStatCard
                label="Peers"
                value={fmtNum(mesh.peers)}
                sub={`${d.online_seats?.length ?? 0} online seats`}
                accent={(d.online_seats?.length ?? 0) >= 4 ? 'text-emerald-400' : 'text-amber-400'}
                chartKey="peers"
                onChart={openNet}
              />
              <ClickableStatCard label="Mempool" value={d.mempool} sub={`max ${fmtNum(d.max_mempool)}`} chartKey="mempool" onChart={openNet} />
              <ClickableStatCard
                label="Mempool intake"
                value={intake == null ? '…' : `${intake.toFixed(1)}/s`}
                sub="sealed + Δmempool · 60s"
                chartKey="mempool_in"
                onChart={openNet}
              />
              <ClickableStatCard
                label="Watchers"
                value={d.watchers ? `${d.watchers.live.length} / ${d.watchers.epoch_accounts.length}` : '—'}
                sub="live this slot / this epoch"
                chartKey="watchers_live"
                onChart={openNet}
              />
              <ClickableStatCard label="Commit" value={mesh.commit} sub={`next pack ${d.lottery_winner || '—'}`} />
              <ClickableStatCard
                label="Last pack"
                value={d.last_pack.packer || '—'}
                sub={`${d.last_pack.txs} tx @ #${fmtNum(d.last_pack.height)}`}
              />
              <ClickableStatCard label="Min fee" value={`${d.current_fee_drops} FPL`} chartKey="min_fee" onChart={openNet} />
              <ClickableStatCard label="Fee tier" value={`${d.fee_multiplier}×`} sub="congestion multiplier" chartKey="fee_multiplier" onChart={openNet} />
              <ClickableStatCard label="Ledgers sealed" value={fmtNum(d.metrics?.ledgers_sealed)} chartKey="height" onChart={openNet} />
              <ClickableStatCard label="Txs sealed" value={fmtNum(d.metrics?.txs_sealed)} chartKey="txs_sealed" onChart={openNet} />
              <ClickableStatCard label="Age" value={fmtUptime(d.uptime_seconds)} />
            </div>
          </section>
        )}

        {tab === 'network' && d && (
          <section>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">Seats</h2>
            <p className="text-[10px] text-slate-600 mb-3">
              Lag = network tip minus the seat&apos;s last advertised tip. Click any stat in a box for its 24h chart.
            </p>
            <SeatBoxes
              sample={live.samples[live.samples.length - 1] ?? null}
              onOpen={(id, metric) => setChart({ kind: 'seat', id, metric })}
            />
          </section>
        )}

        {tab === 'network' && d && <EpochEmissionsCard epoch={d.epoch} />}

        {tab === 'network' && d && (
          <section className="grid lg:grid-cols-2 gap-6">
            <div>
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
                Recent tips
              </h2>
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs text-slate-500">
                      <th className="text-left px-4 py-2.5 font-medium">Height</th>
                      <th className="text-right px-4 py-2.5 font-medium">TXs</th>
                      <th className="text-right px-4 py-2.5 font-medium hidden sm:table-cell">Packer</th>
                      <th className="text-right px-4 py-2.5 font-medium">Hash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(d.recent_ledgers ?? []).map((l: LedgerSummary, i) => (
                      <tr
                        key={`${l.seq}-${i}`}
                        className={`border-b border-slate-800/50 ${i === 0 ? 'bg-brand-500/5' : ''}`}
                      >
                        <td className="px-4 py-2.5 font-mono text-brand-400">#{fmtNum(l.seq)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-300">{l.txn_count}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-400 hidden sm:table-cell">
                          {l.packer ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-500 text-xs">
                          {shortHash(l.hash)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
                Bonded seats
                <span className="ml-2 font-normal normal-case tracking-normal text-slate-600">
                  · {d.validators.length} bonded · {d.online_seats.length} online
                </span>
              </h2>
              <div className="card overflow-hidden overflow-x-auto">
                <table className="w-full text-sm min-w-[420px]">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs text-slate-500">
                      <th className="text-left px-4 py-2.5 font-medium">Seat</th>
                      <th className="text-left px-4 py-2.5 font-medium">Status</th>
                      <th className="text-right px-4 py-2.5 font-medium">Packs</th>
                      <th className="text-right px-4 py-2.5 font-medium">Bond</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.validators.map((v: ValidatorEntry) => {
                      const on = d.online_seats.includes(v.account)
                      return (
                        <tr key={v.account} className="border-b border-slate-800/50">
                          <td className="px-4 py-2.5 font-mono text-xs text-brand-400">{v.account}</td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                v.jailed
                                  ? 'bg-red-500/20 text-red-400'
                                  : on
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : 'bg-amber-500/20 text-amber-400'
                              }`}
                            >
                              {v.jailed ? 'jailed' : on ? 'online' : v.bond_status}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-slate-300">
                            {fmtNum(v.pack_count ?? 0)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-slate-400 text-xs">
                            {fmtNum(Number(v.bonded_amount))} FPL
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {tab === 'network' && d && (
          <section>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
              Node
            </h2>
            <div className="card p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-slate-500">Product</span>
                <br />
                <span className="font-mono text-slate-300">
                  {d.product} {d.product_version}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Tip hash</span>
                <br />
                <span className="font-mono text-slate-300 text-xs">{shortHash(d.tip_hash)}</span>
              </div>
              <div>
                <span className="text-slate-500">State root</span>
                <br />
                <span className="font-mono text-slate-300 text-xs">{shortHash(d.state_root)}</span>
              </div>
              <div>
                <span className="text-slate-500">Last update</span>
                <br />
                <span className="font-mono text-slate-300">
                  {lastUpdate ? lastUpdate.toLocaleTimeString() : '…'}
                </span>
              </div>
            </div>
          </section>
        )}

        {tab === 'network' && !d && !error && (
          <div className="text-center text-slate-600 py-20 text-sm">
            Loading explorer…
          </div>
        )}
        {tab === 'network' && !d && error && (
          <div className="text-center text-slate-500 py-12 text-sm">
            Explorer could not load a snapshot. Retrying…
          </div>
        )}
      </main>

      {chart && d && <ChartModal chart={chart} d={d} live={live} onClose={closeChart} />}
    </ProductShell>
  )
}

function mempoolIntake(live: LiveSamples): number | null {
  const r = live.rate60s
  const a = live.samples
  if (!r || a.length < 2) return null
  const last = a[a.length - 1]
  const base = a.find((x) => x.t >= last.t - r.span_ms) ?? a[0]
  return Math.max(0, r.tps + (last.mempool - base.mempool) / (r.span_ms / 1000))
}

function ChartModal({
  chart,
  d,
  live,
  onClose,
}: {
  chart: ChartTarget
  d: ScanData
  live: LiveSamples
  onClose: () => void
}) {
  if (chart.kind === 'seat') {
    const last = live.samples[live.samples.length - 1]
    const seat = last?.seats.find((x) => x.id === chart.id)
    const lag = last && seat ? seatLag(last.height, seat) : null
    return (
      <MetricModal
        metric={seatKey(chart.id, chart.metric)}
        options={seatOptions(chart.id, {
          tip: seat?.tip ? `#${seat.tip.toLocaleString()}` : 'not advertised',
          lag: lag == null ? 'not advertised' : String(lag),
          packs: seat ? `${seat.packs.toLocaleString()} total` : undefined,
          perf: seat?.perf == null ? undefined : seat.perf.toFixed(3),
        })}
        onClose={onClose}
      />
    )
  }
  const r = live.rate60s
  const cur: Record<string, string | undefined> = {
    height: `#${fmtNum(d.height)}`,
    tps: r ? r.tps.toFixed(1) : undefined,
    blocks_min: r ? r.blocks_min.toFixed(1) : undefined,
    txs_per_block: r && r.blocks_min > 0 ? r.txs_per_block.toFixed(1) : undefined,
    peers: String(d.peers),
    mempool: String(d.mempool),
    mempool_in: mempoolIntake(live)?.toFixed(1),
    min_fee: `${d.current_fee_drops} FPL`,
    fee_multiplier: `${d.fee_multiplier}×`,
    txs_sealed: fmtNum(d.metrics?.txs_sealed),
    watchers_live: d.watchers ? String(d.watchers.live.length) : undefined,
    watchers_epoch: d.watchers ? String(d.watchers.epoch_accounts.length) : undefined,
  }
  if (chart.key === 'watchers_live' || chart.key === 'watchers_epoch') {
    return (
      <MetricModal
        metric={chart.key}
        options={[
          { key: 'watchers_live', label: SERIES_LABELS.watchers_live, current: cur.watchers_live },
          { key: 'watchers_epoch', label: SERIES_LABELS.watchers_epoch, current: cur.watchers_epoch },
        ]}
        extra={
          <p className="text-[10px] text-slate-500 mt-3">
            Live = accounts that heartbeated in watcher slot {d.watchers?.current_slot ?? '—'} (
            {d.watchers?.source === 'status' ? 'node watchers_active_slot' : 'watcher_slots rose this slot, checked every 30s'}).
          </p>
        }
        onClose={onClose}
      />
    )
  }
  const extra =
    chart.key === 'tps' ? (
      <div className="grid grid-cols-3 gap-3 mt-3 text-center">
        {(
          [
            ['10s', live.rate10s],
            ['60s', live.rate60s],
            ['5 min', live.rate5m],
          ] as const
        ).map(([k, w]) => (
          <div key={k} className="rounded-lg border border-[#C07838]/30 py-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">live · {k}</div>
            <div className="font-mono text-sm text-[#D4922A]">{w ? w.tps.toFixed(1) : '—'}</div>
          </div>
        ))}
      </div>
    ) : chart.key === 'mempool_in' ? (
      <p className="text-[10px] text-slate-500 mt-3">
        Intake = sealed tx/s + growth of the mempool per second. Txs rejected or evicted before sealing are not counted.
      </p>
    ) : null
  return <MetricModal metric={chart.key} current={cur[chart.key]} extra={extra} onClose={onClose} />
}
