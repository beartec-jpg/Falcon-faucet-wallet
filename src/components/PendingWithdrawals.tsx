'use client'

import { useState } from 'react'
import { formatUnits } from 'ethers'
import {
  listPendingWithdrawals,
  openPendingWithdrawal,
  takePendingWithdrawal,
  type PendingWithdrawal,
  type Pl2300BridgeConfig,
} from '@/lib/pl-dest-lock'

/** EVM addresses with an open/take running (module-level: a remount cannot start a second take). */
const inFlight = new Set<string>()

function fmtAmount(n: PendingWithdrawal): string {
  const dp = n.asset === 'USDC' ? 6 : 18
  try {
    return `${formatUnits(BigInt(n.amount), dp)} ${n.asset}`
  } catch {
    return `${n.amount} ${n.asset} (base units)`
  }
}

/**
 * Pending withdrawals: ETH/USDC notes this wallet burned on Falcon PL (or that pay its Sepolia
 * address), found from node status — no browser storage needed. Per note: open the claim via
 * the operator (walletd pays gas), then take() it with this wallet's built-in Sepolia key.
 * Never burns again.
 */
export function PendingWithdrawals(props: {
  cfg: Pl2300BridgeConfig
  account: string
  evmAddress?: string
  getEvmKey: () => Promise<string>
  disabled?: boolean
  onBusyChange?: (busy: boolean) => void
}) {
  const [notes, setNotes] = useState<PendingWithdrawal[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyNote, setBusyNote] = useState<string | null>(null)
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [doneTx, setDoneTx] = useState<string | null>(null)

  if (!props.evmAddress || !props.account) return null
  const evmAddress = props.evmAddress
  const explorer = props.cfg.sepolia.explorer_url || 'https://sepolia.etherscan.io'
  const mine = (a?: string) => !!a && a.toLowerCase() === evmAddress.toLowerCase()

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      setNotes(await listPendingWithdrawals({ cfg: props.cfg, account: props.account, evmAddress }))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load withdrawals')
    } finally {
      setLoading(false)
    }
  }

  async function run(noteId: string, fn: () => Promise<void>) {
    if (busyNote || props.disabled) return
    const lockKey = evmAddress.toLowerCase()
    if (inFlight.has(lockKey)) {
      setError('Another claim for this wallet is already running')
      return
    }
    inFlight.add(lockKey)
    setBusyNote(noteId)
    props.onBusyChange?.(true)
    setError(null)
    setInfo(null)
    setDoneTx(null)
    try {
      await fn()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Claim failed')
    } finally {
      inFlight.delete(lockKey)
      setBusyNote(null)
      props.onBusyChange?.(false)
      setStep(null)
      await refresh()
    }
  }

  const onOpen = (n: PendingWithdrawal) =>
    run(n.noteId, async () => {
      setStep('Opening the claim (operator pays gas)…')
      const r = await openPendingWithdrawal({ account: props.account, note: n })
      if (r.waiting) {
        setInfo(r.message || 'No bridge header covers this note yet. Try again in a few minutes.')
        return
      }
      setInfo(r.alreadyOpen ? 'Claim was already open.' : 'Claim opened. You can take it now.')
      if (r.tx) setDoneTx(r.tx)
    })

  const onTake = (n: PendingWithdrawal) =>
    run(n.noteId, async () => {
      if (n.chain.status !== 'open') throw new Error('Claim is not open')
      const evmPrivateKey = await props.getEvmKey()
      const out = await takePendingWithdrawal({
        cfg: props.cfg,
        evmPrivateKey,
        noteId: n.noteId,
        bridge: n.chain.bridge,
        onStep: setStep,
      })
      if (out.alreadyTaken) setInfo('This withdrawal was already taken (paid).')
      else {
        setInfo(`Taken: ${fmtAmount(n)} sent to ${evmAddress.slice(0, 10)}…`)
        setDoneTx(out.takeHash)
      }
    })

  return (
    <details
      className="text-xs text-slate-500"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open && notes === null && !loading) void refresh()
      }}
    >
      <summary className="cursor-pointer hover:text-slate-300">Pending withdrawals (claim)</summary>
      <div className="mt-2 space-y-2">
        <p className="text-slate-400">
          ETH / USDC you bridged out from {props.account}, paying this wallet&apos;s Sepolia address (
          {evmAddress.slice(0, 10)}…). Open the claim if needed, then Take. Nothing is burned again.
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || !!busyNote}
          className="py-1 px-3 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800/60 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {notes && notes.length === 0 && <p className="text-slate-400">No ETH / USDC withdrawals found for this wallet.</p>}
        {notes?.map((n) => {
          const st = n.chain.status
          const label =
            st === 'open' ? `open on ${n.chain.version.toUpperCase()}, ready to take` : st === 'taken' ? 'taken (paid)' : 'needs openClaim'
          const payable = mine(n.dest) && (!n.claimDest || mine(n.claimDest))
          const busy = busyNote === n.noteId
          return (
            <div key={n.noteId} className="rounded-lg border border-slate-800 p-2 space-y-1" data-note-id={n.noteId}>
              <div className="flex justify-between gap-2">
                <span className="text-slate-200">{fmtAmount(n)}</span>
                <span className={st === 'open' ? 'text-emerald-400' : st === 'taken' ? 'text-slate-500' : 'text-amber-300'}>
                  {label}
                </span>
              </div>
              <div className="font-mono break-all text-slate-500">note {n.noteId}</div>
              {!payable && <div className="text-amber-300">Pays {n.claimDest || n.dest}, not this wallet: only that address can take it.</div>}
              {st !== 'taken' && payable && (
                <button
                  type="button"
                  onClick={() => void (st === 'open' ? onTake(n) : onOpen(n))}
                  disabled={!!busyNote || props.disabled}
                  className="w-full py-2 rounded-xl border border-slate-700 text-slate-200 hover:bg-slate-800/60 disabled:opacity-50"
                >
                  {busy ? step ?? 'Working…' : st === 'open' ? 'Take' : 'Open claim'}
                </button>
              )}
            </div>
          )
        })}
        {error && <p className="text-red-400 break-words">{error}</p>}
        {info && <p className="text-emerald-400 break-words">{info}</p>}
        {doneTx && (
          <p className="break-all">
            Tx:{' '}
            <a className="underline text-emerald-400" href={`${explorer}/tx/${doneTx}`} target="_blank" rel="noreferrer">
              {doneTx.slice(0, 18)}…
            </a>
          </p>
        )}
      </div>
    </details>
  )
}
