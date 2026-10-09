'use client'

import { useState } from 'react'
import { claimV3Refund, type Pl2300BridgeConfig } from '@/lib/pl-dest-lock'
import { qcV3Bridge } from '@/lib/pl-v3-claims'

/**
 * Claim a FalconQcBridgeV3 refund (a V3 deposit that expired unminted).
 * Renders nothing until this site has a V3 bridge address configured.
 */
export function V3RefundClaim(props: {
  cfg: Pl2300BridgeConfig
  evmAddress?: string
  /** Decrypts the Sepolia key after a passkey prompt. */
  getEvmKey: () => Promise<string>
}) {
  const [depositId, setDepositId] = useState('')
  const [asset, setAsset] = useState<'ETH' | 'USDC'>('ETH')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  if (!qcV3Bridge(props.cfg) || !props.evmAddress) return null

  const explorer = props.cfg.sepolia.explorer_url || 'https://sepolia.etherscan.io'

  async function onClaim() {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const evmPrivateKey = await props.getEvmKey()
      const out = await claimV3Refund({
        cfg: props.cfg,
        evmPrivateKey,
        depositId,
        asset,
        onStep: setStep,
      })
      setDone(out.alreadyTaken ? 'already-taken' : out.takeHash)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Refund claim failed')
    } finally {
      setBusy(false)
      setStep(null)
    }
  }

  return (
    <details className="text-xs text-slate-500">
      <summary className="cursor-pointer hover:text-slate-300">Claim a V3 deposit refund</summary>
      <div className="mt-2 space-y-2">
        <p className="text-slate-400">
          A V3 deposit that was not minted before it expired is refunded to the address that sent it. Use that
          same wallet ({props.evmAddress.slice(0, 10)}…).
        </p>
        <input
          type="text"
          value={depositId}
          onChange={(e) => setDepositId(e.target.value)}
          placeholder="Deposit id (0x…)"
          spellCheck={false}
          className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 font-mono text-xs text-slate-200"
        />
        <div className="flex gap-2">
          <select
            value={asset}
            onChange={(e) => setAsset(e.target.value === 'USDC' ? 'USDC' : 'ETH')}
            className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-2 text-xs text-slate-200"
          >
            <option value="ETH">ETH</option>
            <option value="USDC">USDC</option>
          </select>
          <button
            type="button"
            onClick={onClaim}
            disabled={busy || !depositId.trim()}
            className="flex-1 py-2 rounded-xl border border-slate-700 text-slate-300 text-xs hover:bg-slate-800/60 disabled:opacity-50"
          >
            {busy ? step ?? 'Working…' : 'Claim refund'}
          </button>
        </div>
        {error && <p className="text-red-400 break-words">{error}</p>}
        {done === 'already-taken' && <p className="text-emerald-400">This refund was already taken.</p>}
        {done && done !== 'already-taken' && (
          <p className="text-emerald-400 break-all">
            Refund taken:{' '}
            <a className="underline" href={`${explorer}/tx/${done}`} target="_blank" rel="noreferrer">
              {done.slice(0, 18)}…
            </a>
          </p>
        )}
      </div>
    </details>
  )
}
