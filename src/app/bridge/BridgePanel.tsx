'use client'

import { useCallback, useEffect, useState } from 'react'
import { loadPrimaryWallet } from '@/lib/wallet-store'
import { authenticatePasskey } from '@/lib/passkey'
import { decryptSeed } from '@/lib/wallet-crypto'
import { plAccountId } from '@/lib/pl-names'
import { fetchSequenceInfo } from '@/lib/wallet-submit'
import { signRailWithdraw } from '@/lib/pl-wallet-sign'
import { useNetwork } from '@/components/NetworkProvider'
import {
  FPL_SIGNET_EXPLORER,
  STATE_LABEL,
  createDeposit,
  depositorPubkey,
  getDeposit,
  listDeposits,
  postSignatures,
  signDepositorRequest,
  type Tn4Deposit,
} from '@/lib/tn4-bridge'

type Op = { name: string; xonly: string; availableSats: number; lastSeen: number }
const MEMPOOL = 'https://mempool.space/testnet4'
// Set NEXT_PUBLIC_FPL_BRIDGE_LIVE=1 once the bridge is active on the Falcon ledger.
const LIVE = process.env.NEXT_PUBLIC_FPL_BRIDGE_LIVE === '1'

export default function BridgePanel() {
  const [ops, setOps] = useState<Op[] | null>(null)
  const [txid, setTxid] = useState('')
  const [status, setStatus] = useState<string>('')
  const { networkKey } = useNetwork()
  const [account, setAccount] = useState('')
  const [deps, setDeps] = useState<Tn4Deposit[]>([])
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [wdTo, setWdTo] = useState('')
  const [wdSats, setWdSats] = useState('')
  const [wdResult, setWdResult] = useState('')

  useEffect(() => {
    if (!LIVE) return
    loadPrimaryWallet().then((w) => w && setAccount(plAccountId(w))).catch(() => {})
  }, [])

  const refresh = useCallback(async () => {
    if (!LIVE || !account) return
    try {
      setDeps((await listDeposits(account)).sort((a, b) => b.created - a.created))
    } catch {
      /* intake unreachable: keep last view */
    }
  }, [account])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 15_000)
    return () => clearInterval(t)
  }, [refresh])

  async function walletBtcSecret(): Promise<{ secret: string; falconSecret: string }> {
    const w = await loadPrimaryWallet()
    if (!w) throw new Error('Open or create your Falcon wallet first.')
    if (!w.btcEncrypted) throw new Error('This wallet has no Bitcoin key yet — open Multi-chain BTC in the wallet once.')
    const { keyBytes } = await authenticatePasskey(w.credentialId, w.hasPrf)
    const secret = (await decryptSeed(w.btcEncrypted, keyBytes)).replace(/^0x/i, '')
    const falconSecret = await decryptSeed(w.encrypted, keyBytes)
    return { secret, falconSecret }
  }

  async function run(label: string, f: () => Promise<void>) {
    setBusy(label)
    setErr('')
    try {
      await f()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  const startDeposit = () =>
    run('Requesting deposit address…', async () => {
      const { secret } = await walletBtcSecret()
      await createDeposit(account, depositorPubkey(secret))
      await refresh()
    })

  const signDeposit = (d: Tn4Deposit) =>
    run('Signing peg-in in your browser…', async () => {
      const full = await getDeposit(d.id)
      if (!full.depositor_request) throw new Error('Nothing to sign yet.')
      const { secret } = await walletBtcSecret()
      const signed = signDepositorRequest(full.depositor_request, secret)
      // keep a local copy: the signed refund lets you reclaim the deposit after the timelock
      localStorage.setItem(`fpl-tn4-signed-${d.id}`, JSON.stringify({ ...signed, request: full.depositor_request }))
      await postSignatures(d.id, signed)
      await refresh()
    })

  const withdraw = () =>
    run('Burning BTC4 on Falcon PL…', async () => {
      const amount = Math.floor(Number(wdSats))
      if (!/^tb1[0-9a-z]{20,80}$/.test(wdTo.trim())) throw new Error('Enter a testnet4 tb1… address.')
      if (!(amount >= 10_000)) throw new Error('Minimum withdrawal is 10,000 sats.')
      const { falconSecret } = await walletBtcSecret()
      const seq = await fetchSequenceInfo(account, networkKey)
      const tx = await signRailWithdraw({ account, sequence: seq.sequence, asset: 'BTC4', amount, externalTo: wdTo.trim(), falconSecret })
      const r = await fetch('/api/wallet/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx, network: networkKey }),
      })
      const out = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string; message?: string }
      if (!r.ok || out.success === false) throw new Error(out.error || out.message || 'Submit failed')
      setWdResult('Burn submitted. An operator fronts the testnet4 payout; it then claims through its presigned graph.')
    })

  function downloadRefund(id: string) {
    const v = localStorage.getItem(`fpl-tn4-signed-${id}`)
    if (!v) return setErr('No signed refund stored in this browser for that deposit.')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([v], { type: 'application/json' }))
    a.download = `falcon-tn4-peg-in-${id}-signed.json`
    a.click()
  }

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
          Deposits and withdrawals open when the bridge activates at Falcon PL ledger height 730,000 (~27–28 Oct 2026). Until then this page shows the
          operator network and lets you track testnet4 transactions.
        </div>
      )}
      <div className="rounded-lg border border-slate-700 p-4 space-y-2">
        <div className="font-semibold">Deposit (testnet4 tBTC)</div>
        <p className="text-sm text-slate-400">
          {LIVE
            ? 'Your wallet’s Bitcoin key (decrypted only in this browser) is the depositor key. Send testnet4 tBTC to the address shown, then sign the peg-in; the three operators presign the BitVM2 graph and bind it on the Falcon ledger before the peg-in is broadcast.'
            : 'Not open yet.'}
        </p>
        {LIVE && (
          <button disabled={!account || !!busy} onClick={startDeposit} className="rounded px-3 py-1 text-sm border border-slate-600 disabled:opacity-40">
            {account ? `New deposit to ${account}` : 'Open your wallet first'}
          </button>
        )}
        {busy && <div className="text-sm text-slate-300">{busy}</div>}
        {err && <div className="text-sm text-red-400">{err}</div>}
        {LIVE && deps.length > 0 && (
          <ul className="space-y-3 pt-2">
            {deps.map((d) => (
              <li key={d.id} className="rounded border border-slate-800 p-3 text-sm space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="font-mono text-slate-400">#{d.id}</span>
                  <span className="text-slate-200">{STATE_LABEL[d.state] || d.state}</span>
                </div>
                {d.state === 'awaiting_funding' && (
                  <div className="text-slate-300">
                    Send {((d.send_sats_min ?? 0) / 1e8).toFixed(8)}–{((d.send_sats_max ?? 0) / 1e8).toFixed(8)} tBTC (testnet4 only) to{' '}
                    <span className="font-mono break-all">{d.address}</span>
                  </div>
                )}
                {d.state === 'awaiting_signature' && (
                  <button disabled={!!busy} onClick={() => signDeposit(d)} className="rounded px-3 py-1 text-sm border border-slate-600 disabled:opacity-40">
                    Sign peg-in with your wallet
                  </button>
                )}
                <TxLink label="Funding" txid={d.funding?.split(':')[0]} />
                <TxLink label="Peg-in deposit" txid={d.deposit_txid} />
                <TxLink label="Peg-in confirm" txid={d.peg_in_confirm_txid} extra={d.confirmations ? ` (${d.confirmations} conf)` : ''} />
                {d.ceremony?.seats && (
                  <div className="text-slate-400">
                    Presigned by {d.ceremony.seats.map((s) => s.id).join(', ')}
                    {d.ceremony.attestations ? ` — ${d.ceremony.attestations} signed key-deletion attestations` : ''}
                  </div>
                )}
                {localStorageHas(d.id) && (
                  <button onClick={() => downloadRefund(d.id)} className="text-xs hover:underline" style={{ color: '#D4922A' }}>
                    Download your signed peg-in (incl. refund) JSON
                  </button>
                )}
                {d.last_error && <div className="text-xs text-slate-500">operator note: {d.last_error}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-lg border border-slate-700 p-4 space-y-2">
        <div className="font-semibold">Withdraw to a testnet4 address</div>
        <div className="flex gap-2">
          <input disabled={!LIVE} value={wdTo} onChange={(e) => setWdTo(e.target.value)} placeholder="tb1… testnet4 address" className="flex-1 rounded bg-slate-900 border border-slate-700 px-2 py-1 text-sm" />
          <input disabled={!LIVE} value={wdSats} onChange={(e) => setWdSats(e.target.value)} placeholder="sats" className="w-28 rounded bg-slate-900 border border-slate-700 px-2 py-1 text-sm" />
          <button disabled={!LIVE || !account || !!busy} onClick={withdraw} className="rounded px-3 py-1 text-sm border border-slate-600 disabled:opacity-40">Burn &amp; withdraw</button>
        </div>
        {wdResult && <div className="text-sm text-slate-300">{wdResult}</div>}
        <p className="text-xs text-slate-500">
          If no operator pays within the refund window, the burned BTC4 is credited back on Falcon PL.
        </p>
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
      <div className="rounded-lg border border-slate-700 p-4 space-y-1 text-sm">
        <div className="font-semibold">Challenge path evidence (FPL signet)</div>
        <p className="text-slate-400">
          The challenge → Assert → Disprove path runs on the public Falcon PL test signet (the Disprove transaction is non-standard,
          so it is mined there). Latest run: Disprove{' '}
          <a className="hover:underline font-mono" style={{ color: '#D4922A' }} target="_blank" rel="noreferrer"
            href={`${FPL_SIGNET_EXPLORER}/tx/cd693dc09dc3ed6b24ceeeb110f41a591cb414f1b2892709c209474d41e8fd53`}>
            cd693dc0…
          </a>{' '}
          — <a className="hover:underline" style={{ color: '#D4922A' }} target="_blank" rel="noreferrer" href={FPL_SIGNET_EXPLORER}>signet explorer</a>.
        </p>
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

function TxLink({ label, txid, extra = '' }: { label: string; txid?: string | null; extra?: string }) {
  if (!txid) return null
  return (
    <div className="text-slate-400">
      {label}:{' '}
      <a className="font-mono hover:underline" style={{ color: '#D4922A' }} href={`${MEMPOOL}/tx/${txid}`} target="_blank" rel="noreferrer">
        {txid.slice(0, 12)}…
      </a>
      {extra}
    </div>
  )
}

function localStorageHas(id: string): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage.getItem(`fpl-tn4-signed-${id}`)
  } catch {
    return false
  }
}
