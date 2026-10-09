'use client'

/**
 * Falcon PL 2300 rewards: live epoch economy from the chain (/api/pl2300/rewards)
 * and a browser-signed Claim with the wallet passkey (Falcon-512 WASM).
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useNetwork } from '@/components/NetworkProvider'
import { authenticatePasskey } from '@/lib/passkey'
import { decryptSeed } from '@/lib/wallet-crypto'
import { loadPrimaryWallet, type StoredWallet } from '@/lib/wallet-store'
import { plAccountId } from '@/lib/pl-names'
import { signPlClaim } from '@/lib/pl-wallet-sign'
import { fetchSequenceInfo } from '@/lib/wallet-submit'

type Seat = {
  id: string
  bond: string
  jailed: boolean
  jailCount: number
  packTxsEpoch: string
  claimable: string | null
  projected: string
}
type Me = {
  account: string
  exists: boolean
  balance: string
  sequence: number
  claimable: string
  watcherWork: string
  watcherSlots: string
  lpPositions: number
  lendPositions: number
  projected: { total: string; validator: string; watcher: string; amm: string; lend: string }
  ammWeight: string
  lendWeight: string
  watcherWeight: string
}
type Rewards = {
  ok: boolean
  error?: string
  tip: number
  product: string
  epoch: number
  lastSettledEpoch: number
  firstClaimEpoch: number
  epochMs: number
  settleInMs: number
  treasury: string
  emissionBps: number
  emissionPctPerYear: number
  emit: string
  buckets: { validators: string; watchers: string; amm: string; lend: string }
  lpCap: string
  watcherCap: string
  validatorPot: string
  packHalf: string
  checkHalf: string
  packTxsTotal: string
  eligibleValidators: number
  watchers: { id: string; work: string; slots: string; weight: string; projected: string }[]
  lps: { id: string; amm: string; lend: string }[]
  seats: Seat[]
  me: Me | null
  notes: string[]
}

const FEE = 2

function fpl(v: string | null | undefined): string {
  if (v == null) return '—'
  const s = String(v).replace(/^0+(?=\d)/, '')
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function short(v: string | null | undefined): string {
  if (v == null) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return fpl(v)
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

function dur(ms: number): string {
  if (!(ms > 0)) return '—'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-lg text-white">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}

async function submitSigned(tx: { rawJson?: string }, networkKey: string) {
  const res = await fetch('/api/wallet/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tx.rawJson ? { tx_json: tx.rawJson, network: networkKey } : { tx, network: networkKey }),
  })
  const out = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
  if (!res.ok || out.error) throw new Error(out.error || out.message || 'Submit failed')
  return out
}

export default function PlRewards() {
  const { network } = useNetwork()
  const [wallet, setWallet] = useState<StoredWallet | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [data, setData] = useState<Rewards | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const account = wallet ? plAccountId(wallet) : ''

  useEffect(() => {
    void loadPrimaryWallet()
      .then(setWallet)
      .finally(() => setLoaded(true))
  }, [])

  const refresh = useCallback(async () => {
    try {
      const q = account ? `?account=${encodeURIComponent(account)}` : ''
      const r = await fetch(`/api/pl2300/rewards${q}`, { cache: 'no-store' })
      const d = (await r.json()) as Rewards
      if (!r.ok || !d.ok) throw new Error(d.error || 'Rewards unavailable')
      setData(d)
      setErr(null)
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e))
    }
  }, [account])

  useEffect(() => {
    if (!loaded) return
    void refresh()
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [loaded, refresh])

  const claim = async () => {
    if (!wallet || !account) return
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      if (data?.me && BigInt(data.me.balance) < BigInt(FEE)) {
        throw new Error(`You need ${FEE} FPL for the claim fee. Use the faucet first.`)
      }
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falconSecret = await decryptSeed(wallet.encrypted, keyBytes)
      const seq = await fetchSequenceInfo(account, network.key)
      const tx = await signPlClaim({
        account,
        sequence: seq.sequence,
        fee: FEE,
        networkId: network.networkId,
        falconSecret,
      })
      await submitSigned(tx, network.key)
      setMsg(`Claim submitted (tx ${tx.tx_id.slice(0, 16)}…). Your balance updates when the next ledger closes.`)
      setTimeout(() => void refresh(), 4_000)
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  const me = data?.me
  const canClaim = Boolean(me && BigInt(me.claimable || '0') > 0n)

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-400/90">Falcon PL 2300</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">Rewards</h1>
        <p className="mt-1 text-sm text-slate-400">
          Each 7-day epoch the chain emits {data ? (data.emissionBps / 100).toFixed(2) : '0.30'}% of the treasury
          (about {data ? data.emissionPctPerYear.toFixed(1) : '14.5'}% a year of what is left). 55% validators, 20% AMM
          LPs, 20% lenders, 5% watchers. Settled rewards wait in <em>claimable</em> until you claim them.
        </p>
      </div>

      {err && <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{err}</div>}
      {msg && <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{msg}</div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Epoch" value={data ? String(data.epoch) : '—'} sub={data ? `settled ${data.lastSettledEpoch}` : undefined} />
        <Stat label="Settles in" value={data ? dur(data.settleInMs) : '—'} sub="chain time" />
        <Stat label="Emission this epoch" value={data ? short(data.emit) : '—'} sub={data ? `${fpl(data.emit)} FPL` : undefined} />
        <Stat label="Treasury" value={data ? short(data.treasury) : '—'} sub={data ? `tip ${data.tip.toLocaleString()}` : undefined} />
      </div>

      <div className="card space-y-4 border-brand-500/20 bg-slate-900/70 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Your rewards</h2>
            <p className="text-xs text-slate-400">{account ? <span className="font-mono">{account}</span> : 'No wallet on this device.'}</p>
          </div>
          {wallet ? (
            <button type="button" className="btn-primary !w-auto px-6" disabled={busy || !canClaim} onClick={() => void claim()}>
              {busy ? 'Signing…' : `Claim ${me ? fpl(me.claimable) : '0'} FPL`}
            </button>
          ) : (
            <Link href="/wallet" className="btn-primary !w-auto px-6 text-center">
              Open wallet
            </Link>
          )}
        </div>
        {me && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Claimable now" value={fpl(me.claimable)} sub="FPL, settled" />
            <Stat label="Projected this epoch" value={fpl(me.projected.total)} sub="if it settled now" />
            <Stat label="Balance" value={fpl(me.balance)} sub="FPL" />
            <Stat
              label="Earning from"
              value={
                [
                  BigInt(me.projected.validator) > 0n && 'validator',
                  BigInt(me.projected.amm) > 0n && 'AMM LP',
                  BigInt(me.projected.lend) > 0n && 'lending',
                  BigInt(me.projected.watcher) > 0n && 'watcher',
                ]
                  .filter(Boolean)
                  .join(' · ') || 'nothing yet'
              }
            />
          </div>
        )}
        {me && (
          <div className="grid grid-cols-1 gap-2 text-xs text-slate-400 md:grid-cols-2">
            <div>AMM LP: weight {fpl(me.ammWeight)} → {fpl(me.projected.amm)} FPL (cap {fpl(data?.lpCap)})</div>
            <div>Lending: weight {fpl(me.lendWeight)} → {fpl(me.projected.lend)} FPL (cap {fpl(data?.lpCap)})</div>
            <div>
              Watcher: work {me.watcherWork} × slots {me.watcherSlots}/168 → {fpl(me.projected.watcher)} FPL (cap{' '}
              {fpl(data?.watcherCap)}) · <Link href="/faucet" className="text-brand-300 underline">watch</Link>
            </div>
            <div>Validator: {fpl(me.projected.validator)} FPL</div>
          </div>
        )}
        <p className="text-[11px] text-slate-500">
          Claim signs a <span className="font-mono">claim</span> tx with your passkey in this browser (fee {FEE} FPL).
        </p>
      </div>

      {data && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="card space-y-2 bg-slate-900/70 p-5 text-sm">
            <h3 className="font-semibold text-white">This epoch&apos;s buckets</h3>
            {[
              ['Validators (55%)', data.buckets.validators],
              ['AMM LPs (20%)', data.buckets.amm],
              ['Lenders (20%)', data.buckets.lend],
              ['Watchers (5%)', data.buckets.watchers],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between font-mono text-xs">
                <span className="text-slate-400">{k}</span>
                <span className="text-slate-200">{fpl(v)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-slate-800 pt-2 font-mono text-xs">
              <span className="text-slate-400">Validator pot (with unspent caps)</span>
              <span className="text-slate-200">{fpl(data.validatorPot)}</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Pot: half by packed txs ({short(data.packTxsTotal)} so far), half split equally over {data.eligibleValidators}{' '}
              bonded seats. Per-account caps: LP {fpl(data.lpCap)}, watcher {fpl(data.watcherCap)}; what caps leave
              unpaid goes to the validator pot.
            </p>
          </div>
          <div className="card space-y-2 bg-slate-900/70 p-5 text-sm">
            <h3 className="font-semibold text-white">Watchers &amp; LPs (projected)</h3>
            {data.watchers.map((w) => (
              <div key={w.id} className="flex justify-between font-mono text-xs">
                <span className="text-slate-400">
                  {w.id} · work {w.work} · slots {w.slots}
                </span>
                <span className="text-slate-200">{fpl(w.projected)}</span>
              </div>
            ))}
            {data.lps.map((l) => (
              <div key={l.id} className="flex justify-between font-mono text-xs">
                <span className="text-slate-400">{l.id} · LP</span>
                <span className="text-slate-200">{fpl((BigInt(l.amm) + BigInt(l.lend)).toString())}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && (
        <div className="card overflow-x-auto bg-slate-900/70 p-5">
          <h3 className="mb-3 text-sm font-semibold text-white">Validator seats</h3>
          <table className="w-full text-left font-mono text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 pr-3">seat</th>
                <th className="py-1 pr-3">status</th>
                <th className="py-1 pr-3 text-right">packed txs (epoch)</th>
                <th className="py-1 pr-3 text-right">claimable</th>
                <th className="py-1 text-right">projected</th>
              </tr>
            </thead>
            <tbody>
              {data.seats.map((s) => (
                <tr key={s.id} className="border-t border-slate-800 text-slate-300">
                  <td className="py-1 pr-3">{s.id}</td>
                  <td className={`py-1 pr-3 ${s.jailed ? 'text-amber-400' : 'text-emerald-400'}`}>{s.jailed ? 'jailed' : 'active'}</td>
                  <td className="py-1 pr-3 text-right">{fpl(s.packTxsEpoch)}</td>
                  <td className="py-1 pr-3 text-right">{short(s.claimable)}</td>
                  <td className="py-1 text-right">{short(s.projected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <ul className="list-disc space-y-1 pl-5 text-[11px] text-slate-500">
          {data.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
