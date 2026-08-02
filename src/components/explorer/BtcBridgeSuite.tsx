'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type WithdrawRow = {
  account: string
  seq: number
  status: number
  statusLabel: string
  amountSats: number
  amountBtc: string
  phase: string
  challengeEndLedger: number
  inChallengeWindow: boolean
  btcTxId?: string
  hasCommit: boolean
}

export type BtcBridgeSuiteData = {
  checked_at: string
  btcNetwork: string
  ready: boolean
  message: string
  amendment: { name: string; supported: boolean; enabled: boolean }
  falcon: {
    ledger: number
    tipHeight: number
    tipHash: string | null
    minConfirmations: number
    watchScriptHash: string | null
    totalMintedSats: number
    totalMintedBtc: number
    mintCapSats: number | null
    chainId: number | null
  }
  bitcoin: {
    tipHeight: number | null
    tipHash: string | null
    explorer: string
  }
  headers: {
    falconTipHeight: number | null
    bitcoinTipHeight: number | null
    lagBlocks: number | null
    synced: boolean | null
    note: string
  }
  reserve: {
    holdAddress: string | null
    holdConfirmedSats: number
    holdConfirmedBtc: number
    holdUtxoCount: number
    holdMatureUtxoCount: number
    challengeCsv: number
    model: string | null
    watchMatchesConfig: boolean
  }
  tvl: {
    valueLockedSats: number
    valueLockedBtc: number
    fbtcOutstandingSats: number
    fbtcOutstandingBtc: number
    collateralRatio: number | null
  }
  solvency: {
    ok: boolean
    requiredSats: number
    shortfallSats: number
    openUnpaidBurnsSats: number
  }
  challenges: {
    openChallengeWindows: number
    pendingPegOuts: number
    awaitingBtcPayment: number
    paidOrFinalized: number
    note: string
  }
  activity: {
    totals: {
      withdrawals: number
      pending: number
      paid: number
      inChallengeWindow: number
      pendingSats: number
      paidSats: number
    }
    recent: WithdrawRow[]
  }
  error?: string
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string | number
  sub?: string
  accent?: string
}) {
  return (
    <div className="card p-4 flex flex-col gap-1">
      <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
      <span className={`text-xl font-bold font-mono ${accent ?? 'text-slate-100'}`}>{value}</span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  )
}

function short(s: string | null | undefined, n = 10) {
  if (!s) return '—'
  if (s.length <= n * 2) return s
  return `${s.slice(0, n)}…${s.slice(-6)}`
}

function fmtBtc(sats: number) {
  return (sats / 1e8).toFixed(8)
}

function phaseColor(phase: string) {
  if (phase === 'complete') return 'text-emerald-400'
  if (phase === 'challenge_window') return 'text-amber-400'
  if (phase === 'awaiting_btc') return 'text-sky-400'
  if (phase === 'btc_proven') return 'text-brand-400'
  return 'text-slate-400'
}

export default function BtcBridgeSuite() {
  const [data, setData] = useState<BtcBridgeSuiteData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/scan/btc-bridge', { cache: 'no-store' })
      const j = (await r.json()) as BtcBridgeSuiteData
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bridge suite')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    timer.current = setInterval(load, 20_000)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [load])

  if (loading && !data) {
    return (
      <div className="card p-8 text-center text-slate-500 text-sm">Loading Bitcoin Bridge suite…</div>
    )
  }

  if (error && !data) {
    return (
      <div className="card p-4 border-red-900/50 bg-red-950/20 text-red-400 text-sm">
        Bridge suite unavailable: {error}
      </div>
    )
  }

  if (!data) return null

  const explorer = data.bitcoin.explorer
  const hold = data.reserve.holdAddress

  return (
    <div className="space-y-8">
      {/* Status banner */}
      <div
        className={`card p-4 flex flex-wrap items-center justify-between gap-3 border ${
          data.solvency.ok ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'
        }`}
      >
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${data.ready && data.solvency.ok ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}
            />
            <span className="text-sm font-medium text-slate-100">Bitcoin SPV Bridge</span>
            <span className="text-[10px] uppercase tracking-wide text-slate-500 px-2 py-0.5 rounded-full bg-slate-800">
              {data.btcNetwork}
            </span>
            {data.reserve.model && (
              <span className="text-[10px] text-slate-500 font-mono">{data.reserve.model}</span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">{data.message}</p>
        </div>
        <div className="text-[11px] text-slate-500 font-mono">
          Updated {new Date(data.checked_at).toLocaleTimeString()}
          {error && <span className="text-amber-400 ml-2">· refresh error</span>}
        </div>
      </div>

      {/* TVL / solvency */}
      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
          Value locked &amp; reserves
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <Stat
            label="Value locked"
            value={`${fmtBtc(data.tvl.valueLockedSats)} BTC`}
            sub={`${data.tvl.valueLockedSats.toLocaleString()} sats on hold`}
            accent="text-emerald-400"
          />
          <Stat
            label="FBTC outstanding"
            value={`${fmtBtc(data.tvl.fbtcOutstandingSats)}`}
            sub={`${data.tvl.fbtcOutstandingSats.toLocaleString()} sats minted`}
          />
          <Stat
            label="Collateral ratio"
            value={
              data.tvl.collateralRatio != null
                ? `${(data.tvl.collateralRatio * 100).toFixed(1)}%`
                : '—'
            }
            sub="hold ÷ minted"
            accent={data.solvency.ok ? 'text-emerald-400' : 'text-amber-400'}
          />
          <Stat
            label="Solvency"
            value={data.solvency.ok ? 'Solvent' : 'Short'}
            sub={
              data.solvency.ok
                ? `required ${data.solvency.requiredSats.toLocaleString()} sats`
                : `shortfall ${data.solvency.shortfallSats.toLocaleString()} sats`
            }
            accent={data.solvency.ok ? 'text-emerald-400' : 'text-amber-400'}
          />
          <Stat
            label="Unpaid peg-outs"
            value={data.solvency.openUnpaidBurnsSats.toLocaleString()}
            sub="sats pending burn liabilities"
          />
          <Stat
            label="Hold UTXOs"
            value={data.reserve.holdUtxoCount}
            sub={`${data.reserve.holdMatureUtxoCount} mature (≥${data.falcon.minConfirmations} conf)`}
          />
          <Stat label="Challenge CSV" value={data.reserve.challengeCsv} sub="relative lock (blocks)" />
          <Stat
            label="Mint cap"
            value={
              data.falcon.mintCapSats != null
                ? fmtBtc(data.falcon.mintCapSats)
                : '—'
            }
            sub="protocol max FBTC"
          />
        </div>
      </section>

      {/* Headers */}
      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
          Header watches — Falcon &amp; Bitcoin
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <Stat
            label="Falcon BTC tip"
            value={data.headers.falconTipHeight?.toLocaleString() ?? '—'}
            sub={short(data.falcon.tipHash, 8)}
            accent="text-brand-400"
          />
          <Stat
            label="Bitcoin tip"
            value={data.headers.bitcoinTipHeight?.toLocaleString() ?? '—'}
            sub={short(data.bitcoin.tipHash, 8)}
          />
          <Stat
            label="Header lag"
            value={
              data.headers.lagBlocks == null
                ? '—'
                : data.headers.lagBlocks <= 0
                  ? '0'
                  : data.headers.lagBlocks
            }
            sub={data.headers.note}
            accent={
              data.headers.synced === true
                ? 'text-emerald-400'
                : data.headers.synced === false
                  ? 'text-amber-400'
                  : undefined
            }
          />
          <Stat
            label="Min confirmations"
            value={data.falcon.minConfirmations}
            sub="peg-in claim threshold"
          />
          <Stat
            label="Falcon ledger"
            value={data.falcon.ledger ? `#${data.falcon.ledger.toLocaleString()}` : '—'}
          />
          <Stat
            label="Watch hash match"
            value={data.reserve.watchMatchesConfig ? 'Yes' : 'Check'}
            sub="config ↔ on-ledger"
            accent={data.reserve.watchMatchesConfig ? 'text-emerald-400' : 'text-amber-400'}
          />
        </div>
        {hold && (
          <div className="mt-3 card p-3 text-xs space-y-1">
            <div className="text-slate-500 uppercase tracking-wider text-[10px]">Protocol hold</div>
            <a
              href={`${explorer}/address/${hold}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-brand-400 hover:text-brand-300 break-all"
            >
              {hold}
            </a>
            <div className="font-mono text-slate-500 text-[11px]">
              watch {short(data.falcon.watchScriptHash, 16)}
            </div>
          </div>
        )}
      </section>

      {/* Challenges */}
      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
          Challenges &amp; peg-out activity
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <Stat
            label="Open challenge windows"
            value={data.challenges.openChallengeWindows}
            accent={data.challenges.openChallengeWindows > 0 ? 'text-amber-400' : undefined}
          />
          <Stat label="Pending peg-outs" value={data.challenges.pendingPegOuts} />
          <Stat label="Awaiting BTC pay" value={data.challenges.awaitingBtcPayment} />
          <Stat
            label="Paid / finalized"
            value={data.challenges.paidOrFinalized}
            accent="text-emerald-400"
          />
        </div>
        <p className="text-[11px] text-slate-500 leading-snug mb-4">{data.challenges.note}</p>

        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th className="px-4 py-2.5 font-medium">Seq</th>
                <th className="px-4 py-2.5 font-medium">Account</th>
                <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                <th className="px-4 py-2.5 font-medium">Phase</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">BTC tx</th>
              </tr>
            </thead>
            <tbody>
              {data.activity.recent.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500 text-xs">
                    No BtcWithdrawal objects on scanned accounts
                  </td>
                </tr>
              )}
              {data.activity.recent.map((w) => (
                <tr
                  key={`${w.account}-${w.seq}`}
                  className="border-b border-slate-800/80 hover:bg-slate-900/40"
                >
                  <td className="px-4 py-2 font-mono text-xs text-slate-300">{w.seq}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-400">{short(w.account, 6)}</td>
                  <td className="px-4 py-2 font-mono text-xs text-right text-slate-200">
                    {w.amountBtc}
                    <span className="text-slate-600 ml-1">BTC</span>
                  </td>
                  <td className={`px-4 py-2 text-xs font-medium ${phaseColor(w.phase)}`}>
                    {w.phase.replace(/_/g, ' ')}
                    {w.inChallengeWindow && (
                      <span className="block text-[10px] text-amber-500/80">
                        until ledger {w.challengeEndLedger}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-400">{w.statusLabel}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {w.btcTxId ? (
                      <a
                        href={`${explorer}/tx/${w.btcTxId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-400 hover:text-brand-300"
                      >
                        {short(w.btcTxId, 8)}
                      </a>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[11px] text-slate-600">
          Totals: {data.activity.totals.withdrawals} withdrawals ·{' '}
          {data.activity.totals.pendingSats.toLocaleString()} sats pending ·{' '}
          {data.activity.totals.paidSats.toLocaleString()} sats paid/finalized (scanned accounts)
        </div>
      </section>

      {/* Amendment footer */}
      <section className="card p-4 text-xs text-slate-500 flex flex-wrap gap-4">
        <span>
          Amendment{' '}
          <span className="text-slate-300">{data.amendment.name}</span>:{' '}
          {data.amendment.enabled ? (
            <span className="text-emerald-400">enabled</span>
          ) : data.amendment.supported ? (
            <span className="text-amber-400">supported</span>
          ) : (
            <span className="text-red-400">missing</span>
          )}
        </span>
        <span>
          Chain id <span className="text-slate-300 font-mono">{data.falcon.chainId ?? '—'}</span>
        </span>
      </section>
    </div>
  )
}
