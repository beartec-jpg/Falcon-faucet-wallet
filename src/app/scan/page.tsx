'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import Logo from '@/components/Logo'
import type { ScanData, LedgerSummary, TxSummary } from '@/app/api/scan/route'
import OrderBookPanel from '@/components/OrderBookPanel'

const NETWORK_NAME = process.env.NEXT_PUBLIC_NETWORK_NAME ?? 'Falcon Ledger Testnet'
const RIPPLE_EPOCH = 946684800

function rippleAge(rippleTime: number | undefined): string {
  if (!rippleTime) return '—'
  const secs = Math.floor(Date.now() / 1000 - (rippleTime + RIPPLE_EPOCH))
  if (secs < 60)  return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

function shortHash(h: string) {
  if (!h) return '—'
  return h.slice(0, 8) + '…' + h.slice(-6)
}

function shortAddr(a: string) {
  if (!a) return '—'
  return a.slice(0, 8) + '…' + a.slice(-4)
}

function dropsToQxrp(drops: string | number | undefined): string {
  if (drops === undefined || drops === '') return '—'
  const n = parseInt(String(drops), 10)
  if (isNaN(n)) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' FALCON'
  return n + ' drops'
}

function fmtUptime(secs: number): string {
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="card p-4 flex flex-col gap-1">
      <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
      <span className={`text-2xl font-bold font-mono ${accent ?? 'text-slate-100'}`}>{value}</span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  )
}

// ─── Tx type badge ─────────────────────────────────────────────────────────────

const TX_COLORS: Record<string, string> = {
  Payment:          'bg-emerald-500/20 text-emerald-400',
  OfferCreate:      'bg-blue-500/20 text-blue-400',
  OfferCancel:      'bg-slate-500/20 text-slate-400',
  TrustSet:         'bg-purple-500/20 text-purple-400',
  EscrowCreate:     'bg-amber-500/20 text-amber-400',
  EscrowFinish:     'bg-amber-500/20 text-amber-400',
  EscrowCancel:     'bg-red-500/20 text-red-400',
  AccountSet:       'bg-slate-500/20 text-slate-400',
  SetRegularKey:    'bg-slate-500/20 text-slate-400',
  SignerListSet:    'bg-slate-500/20 text-slate-400',
  ValidatorListSet: 'bg-pink-500/20 text-pink-400',
}

function TxBadge({ type }: { type: string }) {
  const cls = TX_COLORS[type] ?? 'bg-slate-700/50 text-slate-400'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{type}</span>
  )
}

// ─── Live ticker strip ────────────────────────────────────────────────────────

function TickerStrip({ ledger, tps, peers, state }: { ledger: number; tps: number; peers: number; state: string }) {
  const active = state === 'proposing' || state === 'full'
  return (
    <div className="w-full bg-slate-900 border-b border-slate-800 text-xs text-slate-500 flex items-center gap-6 px-4 py-1.5 overflow-x-auto whitespace-nowrap">
      <span className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400 animate-pulse'}`} />
        <span className={active ? 'text-emerald-400' : 'text-amber-400'}>{state || 'connecting…'}</span>
      </span>
      <span>Ledger <span className="text-slate-300 font-mono">#{ledger.toLocaleString()}</span></span>
      <span>TPS <span className="text-slate-300 font-mono">{tps}</span></span>
      <span>Peers <span className="text-slate-300 font-mono">{peers}</span></span>
      <span>Network <span className="text-slate-300">{NETWORK_NAME}</span></span>
    </div>
  )
}

// ─── Search bar ──────────────────────────────────────────────────────────────

function SearchBar({ data }: { data: ScanData | null }) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{ type: string; found: boolean; data?: unknown } | null>(null)
  const [loading, setLoading] = useState(false)

  const search = useCallback(async (q: string) => {
    q = q.trim()
    if (!q) { setResult(null); return }
    setLoading(true)
    try {
      // Ledger number
      if (/^\d+$/.test(q)) {
        const ledger = data?.recent_ledgers.find(l => String(l.seq) === q)
        if (ledger) {
          setResult({ type: 'ledger', found: true, data: ledger })
        } else {
          const r = await fetch(`/api/scan/ledger?seq=${q}`)
          const d = await r.json()
          setResult({ type: 'ledger', found: !d.error, data: d })
        }
        return
      }
      // TX hash (64 hex chars)
      if (/^[0-9A-Fa-f]{64}$/.test(q)) {
        const r = await fetch(`/api/scan/tx?hash=${q}`)
        const d = await r.json()
        setResult({ type: 'tx', found: !d.error, data: d })
        return
      }
      // Address
      if (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(q)) {
        const r = await fetch(`/api/wallet/account?address=${q}`)
        const d = await r.json()
        setResult({ type: 'account', found: d.exists !== false && !d.error, data: d })
        return
      }
      setResult({ type: 'unknown', found: false })
    } finally {
      setLoading(false)
    }
  }, [data])

  return (
    <div className="w-full max-w-2xl mx-auto">
      <form onSubmit={e => { e.preventDefault(); search(query) }} className="flex gap-2">
        <input
          className="input-field flex-1"
          placeholder="Search ledger #, TX hash, or address…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          spellCheck={false}
        />
        <button type="submit" disabled={loading}
          className="px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 font-semibold text-sm disabled:opacity-50 transition-colors">
          {loading ? '…' : 'Search'}
        </button>
      </form>

      {result && (
        <div className="mt-3 card p-4 text-sm font-mono break-all">
          {!result.found ? (
            <span className="text-red-400">Not found</span>
          ) : result.type === 'account' ? (
            <AccountResult data={result.data as Record<string, unknown>} />
          ) : result.type === 'ledger' ? (
            <LedgerResult data={result.data as LedgerSummary} />
          ) : (
            <TxResult data={result.data as TxSummary} />
          )}
        </div>
      )}
    </div>
  )
}

function AccountResult({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-1">
      <div className="text-brand-500 font-sans font-semibold text-base mb-2">Account</div>
      <Row k="Address"  v={String(data.address ?? '')} />
      <Row k="Balance"  v={`${Number(data.balance ?? 0).toLocaleString()} FALCON`} />
      <Row k="Sequence" v={String(data.sequence ?? 0)} />
      <Row k="Exists"   v={data.exists ? 'Yes' : 'No'} />
    </div>
  )
}

function LedgerResult({ data }: { data: LedgerSummary }) {
  return (
    <div className="space-y-1">
      <div className="text-brand-500 font-sans font-semibold text-base mb-2">Ledger #{data.seq}</div>
      <Row k="Hash"    v={data.hash} />
      <Row k="TXs"     v={String(data.txn_count)} />
      <Row k="Closed"  v={data.close_time_human ? new Date(data.close_time_human).toLocaleString() : '—'} />
    </div>
  )
}

function TxResult({ data }: { data: TxSummary }) {
  return (
    <div className="space-y-1">
      <div className="text-brand-500 font-sans font-semibold text-base mb-2">Transaction</div>
      <Row k="Hash"        v={data.hash} />
      <Row k="Type"        v={data.type} />
      <Row k="Account"     v={data.account} />
      {data.destination && <Row k="Destination" v={data.destination} />}
      {data.amount       && <Row k="Amount"      v={dropsToQxrp(data.amount)} />}
      <Row k="Fee"         v={dropsToQxrp(data.fee)} />
      <Row k="Result"      v={data.result} />
      <Row k="Ledger"      v={String(data.ledger_index)} />
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

// ─── Main explorer page ───────────────────────────────────────────────────────

export default function ScanPage() {
  const [data, setData]       = useState<ScanData | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch('/api/scan')
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      setData(d)
      setError(null)
      setLastUpdate(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Node unavailable')
    }
  }, [])

  useEffect(() => {
    fetchData()
    timerRef.current = setInterval(fetchData, 4000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [fetchData])

  const d = data

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">

      {/* ── Ticker ───────────────────────────────────────────────────────── */}
      {d && (
        <TickerStrip
          ledger={d.validated_ledger}
          tps={d.tps_estimate}
          peers={d.peers}
          state={d.server_state}
        />
      )}

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <Header current="scan" />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8 space-y-8">

        {/* Logo */}
        <Logo />

        {error && (
          <div className="card p-4 border-red-900 bg-red-950/30 text-red-400 text-sm">
            Node unavailable: {error}
          </div>
        )}

        {/* ── Search ──────────────────────────────────────────────────────── */}
        <section>
          <SearchBar data={d} />
        </section>

        {/* ── KPI grid ────────────────────────────────────────────────────── */}
        {d && (
          <section>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Network Overview</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <StatCard label="Latest Ledger"    value={`#${d.validated_ledger.toLocaleString()}`} accent="text-brand-500" />
              <StatCard label="TPS (est.)"        value={d.tps_estimate}   sub={`${d.avg_txs_per_ledger} tx/ledger`} />
              <StatCard label="Avg Close"         value={`${d.avg_close_seconds}s`} sub="per ledger" />
              <StatCard label="Peers"             value={d.peers} />
              <StatCard label="Validators"        value={d.validators.length} sub="on UNL" />
              <StatCard label="State"             value={d.server_state} accent={d.server_state === 'proposing' ? 'text-emerald-400' : 'text-amber-400'} />
              <StatCard label="Uptime"            value={fmtUptime(d.uptime_seconds)} />
              <StatCard label="Base Fee"          value={`${d.current_fee_drops} drops`} sub={`${(d.current_fee_drops / 1e6).toFixed(6)} FALCON`} />
              <StatCard label="Open Ledger Fee"   value={`${d.open_ledger_fee} drops`} />
              <StatCard label="TX Queue"          value={d.tx_queue_size} sub="pending" />
            </div>
          </section>
        )}

        {/* ── Load / fee ──────────────────────────────────────────────────── */}
        {d && (
          <section>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Fee & Load</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Minimum Fee"    value={`${d.current_fee_drops} drops`} />
              <StatCard label="Median Fee"     value={`${d.median_fee_drops} drops`} />
              <StatCard label="Load Factor"    value={`${(d.load_factor / (d.load_base || 256) * 100).toFixed(1)}%`} sub={`${d.load_factor} / ${d.load_base}`} />
              <StatCard label="Reserve Base"   value={`${(d.reserve_base / 1e6).toFixed(2)} FALCON`} sub={`+${(d.reserve_inc / 1e6).toFixed(2)} per object`} />
            </div>
          </section>
        )}

        {/* ── DEX order book ─────────────────────────────────────────────── */}
        {d && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
                FALCON / USDC Order Book
              </h2>
              <Link href="/swap" className="text-xs text-brand-400 hover:text-brand-300">
                Trade on Swap →
              </Link>
            </div>
            <OrderBookPanel compact pollMs={12000} />
          </section>
        )}

        {/* ── Two-column: ledgers + validators ────────────────────────────── */}
        {d && (
          <section className="grid lg:grid-cols-2 gap-6">

            {/* Recent Ledgers */}
            <div>
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Recent Ledgers</h2>
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs text-slate-500">
                      <th className="text-left px-4 py-2.5 font-medium">Ledger</th>
                      <th className="text-right px-4 py-2.5 font-medium">TXs</th>
                      <th className="text-right px-4 py-2.5 font-medium hidden sm:table-cell">Hash</th>
                      <th className="text-right px-4 py-2.5 font-medium">Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.recent_ledgers.map((l, i) => (
                      <tr key={l.seq} className={`border-b border-slate-800/50 hover:bg-slate-800/40 transition-colors ${i === 0 ? 'bg-brand-500/5' : ''}`}>
                        <td className="px-4 py-2.5 font-mono text-brand-400">#{l.seq.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right font-mono">
                          <span className={l.txn_count > 0 ? 'text-emerald-400' : 'text-slate-600'}>{l.txn_count}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-500 hidden sm:table-cell text-xs">{shortHash(l.hash)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-400 text-xs">{rippleAge(l.close_time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Validators */}
            <div>
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Validators</h2>
              <div className="card overflow-hidden">
                {d.validators.length === 0 ? (
                  <div className="px-4 py-8 text-center text-slate-600 text-sm">No validators returned by node</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-xs text-slate-500">
                        <th className="text-left px-4 py-2.5 font-medium">Public Key</th>
                        <th className="text-right px-4 py-2.5 font-medium">Ledger</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.validators.map((v, i) => (
                        <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/40 transition-colors">
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{shortHash(v.pubkey)}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-slate-400">#{v.ledger_index?.toLocaleString() ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── Recent Transactions ──────────────────────────────────────────── */}
        {d && d.recent_txs.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
              Latest Transactions — Ledger #{d.validated_ledger.toLocaleString()}
            </h2>
            <div className="card overflow-hidden overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="border-b border-slate-800 text-xs text-slate-500">
                    <th className="text-left px-4 py-2.5 font-medium">Hash</th>
                    <th className="text-left px-4 py-2.5 font-medium">Type</th>
                    <th className="text-left px-4 py-2.5 font-medium">From</th>
                    <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">To</th>
                    <th className="text-right px-4 py-2.5 font-medium">Amount</th>
                    <th className="text-right px-4 py-2.5 font-medium hidden sm:table-cell">Fee</th>
                    <th className="text-right px-4 py-2.5 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recent_txs.map((tx, i) => (
                    <tr key={tx.hash || i} className="border-b border-slate-800/50 hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{shortHash(tx.hash)}</td>
                      <td className="px-4 py-2.5"><TxBadge type={tx.type} /></td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-300">{shortAddr(tx.account)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-400 hidden md:table-cell">{shortAddr(tx.destination ?? '')}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{dropsToQxrp(tx.amount)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-500 hidden sm:table-cell">{dropsToQxrp(tx.fee)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`text-xs font-medium ${tx.result === 'tesSUCCESS' ? 'text-emerald-400' : 'text-red-400'}`}>
                          {tx.result === 'tesSUCCESS' ? '✓' : tx.result || '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Server info ─────────────────────────────────────────────────── */}
        {d && (
          <section>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Node</h2>
            <div className="card p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
              <div><span className="text-slate-500">Version</span><br /><span className="font-mono text-slate-300">{d.server_version || '—'}</span></div>
              <div><span className="text-slate-500">Ledgers available</span><br /><span className="font-mono text-slate-300">{d.complete_ledgers}</span></div>
              <div><span className="text-slate-500">Uptime</span><br /><span className="font-mono text-slate-300">{fmtUptime(d.uptime_seconds)}</span></div>
              <div><span className="text-slate-500">Last update</span><br /><span className="font-mono text-slate-300">{lastUpdate ? lastUpdate.toLocaleTimeString() : '…'}</span></div>
            </div>
          </section>
        )}

        {!d && !error && (
          <div className="text-center text-slate-600 py-20 text-sm animate-pulse">Loading explorer data…</div>
        )}
      </main>

      <footer className="border-t border-slate-800 py-4 px-4 text-center text-xs text-slate-600">
        Testnet tokens · No real value ·{' '}
        <a href="https://github.com/beartec-jpg/qXRP" target="_blank" rel="noopener noreferrer"
          className="hover:text-slate-400 underline underline-offset-2">Falcon Ledger on GitHub</a>
      </footer>
    </div>
  )
}
