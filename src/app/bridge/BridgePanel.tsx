'use client'

import { useEffect, useState } from 'react'

type Op = { name: string; xonly: string; availableSats: number; lastSeen: number }
const MEMPOOL = 'https://mempool.space/testnet4'
// Set NEXT_PUBLIC_FPL_BRIDGE_LIVE=1 once the bridge is active on the Falcon ledger.
const LIVE = process.env.NEXT_PUBLIC_FPL_BRIDGE_LIVE === '1'

export default function BridgePanel() {
  const [ops, setOps] = useState<Op[] | null>(null)
  const [txid, setTxid] = useState('')
  const [status, setStatus] = useState<string>('')

  useEffect(() => {
    fetch('/api/scan/btc-operators', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setOps(Array.isArray(j.operators) ? j.operators : []))
      .catch(() => setOps([]))
  }, [])

  async function lookup() {
    const t = txid.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(t)) return setStatus('Enter a 64-character testnet4 txid.')
    setStatus('Checking…')
    try {
      const r = await fetch(`${MEMPOOL}/api/tx/${t}/status`)
      if (!r.ok) return setStatus('Not found on testnet4.')
      const s = (await r.json()) as { confirmed: boolean; block_height?: number }
      setStatus(s.confirmed ? `Confirmed in testnet4 block ${s.block_height}.` : 'In mempool, unconfirmed.')
    } catch {
      setStatus('Lookup failed.')
    }
  }

  return (
    <div className="space-y-4">
      {!LIVE && (
        <div className="rounded-lg border border-slate-700 p-4 text-sm text-slate-300">
          Deposits and withdrawals open when the bridge activates on the Falcon PL ledger. Until then this page shows the
          operator network and lets you track testnet4 transactions.
        </div>
      )}
      <div className="rounded-lg border border-slate-700 p-4 space-y-2">
        <div className="font-semibold">Deposit (testnet4 tBTC)</div>
        <p className="text-sm text-slate-400">
          {LIVE
            ? 'Request a deposit with your Falcon PL account name; the operators presign and bind the graph, then show your peg-in address.'
            : 'Not open yet.'}
        </p>
      </div>
      <div className="rounded-lg border border-slate-700 p-4 space-y-2">
        <div className="font-semibold">Withdraw to a testnet4 address</div>
        <div className="flex gap-2">
          <input disabled={!LIVE} placeholder="tb1… testnet4 address" className="flex-1 rounded bg-slate-900 border border-slate-700 px-2 py-1 text-sm" />
          <input disabled={!LIVE} placeholder="sats" className="w-28 rounded bg-slate-900 border border-slate-700 px-2 py-1 text-sm" />
          <button disabled={!LIVE} className="rounded px-3 py-1 text-sm border border-slate-600 disabled:opacity-40">Burn &amp; withdraw</button>
        </div>
      </div>
      <div className="rounded-lg border border-slate-700 p-4 space-y-2">
        <div className="font-semibold">Track a transaction</div>
        <div className="flex gap-2">
          <input value={txid} onChange={(e) => setTxid(e.target.value)} placeholder="testnet4 txid" className="flex-1 rounded bg-slate-900 border border-slate-700 px-2 py-1 text-sm font-mono" />
          <button onClick={lookup} className="rounded px-3 py-1 text-sm border border-slate-600">Check</button>
        </div>
        {status && (
          <div className="text-sm text-slate-300">
            {status}{' '}
            {/^[0-9a-f]{64}$/i.test(txid.trim()) && (
              <a className="hover:underline" style={{ color: '#D4922A' }} href={`${MEMPOOL}/tx/${txid.trim()}`} target="_blank" rel="noreferrer">
                View on mempool.space
              </a>
            )}
          </div>
        )}
      </div>
      <div className="rounded-lg border border-slate-700 p-4">
        <div className="font-semibold mb-2">Operators (testnet4)</div>
        {ops === null ? (
          <div className="text-sm text-slate-400">Loading…</div>
        ) : ops.length === 0 ? (
          <div className="text-sm text-slate-400">No operator feed available.</div>
        ) : (
          <ul className="text-sm text-slate-300 space-y-1">
            {ops.map((o) => (
              <li key={o.xonly} className="font-mono">
                {o.name || o.xonly.slice(0, 12)} — {o.availableSats.toLocaleString()} sats available
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
