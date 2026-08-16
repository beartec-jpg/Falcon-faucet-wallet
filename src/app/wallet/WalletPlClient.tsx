'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import Logo from '@/components/Logo'
import ProductShell from '@/components/ProductShell'

const STORE = 'fpl-wallet-v1'
const TEST_ACCOUNTS = ['alice', 'bob', 'carol', 'dave'] as const

type Acct = {
  name: string
  exists: boolean
  balance: number
  sequence: number
  claimable: number
  accountType?: string
  allowlist?: string[]
  vaultLocked?: boolean
}

type Snap = {
  online: boolean
  tip?: number
  networkId?: number
  epoch?: number
  firstClaimEpoch?: number
  product?: string
  account: Acct | null
  error?: string
}

function loadStored(): string {
  if (typeof window === 'undefined') return ''
  try {
    const raw = localStorage.getItem(STORE)
    if (!raw) return ''
    const j = JSON.parse(raw) as { account?: string }
    return String(j.account ?? '')
  } catch {
    return ''
  }
}

function saveStored(account: string) {
  localStorage.setItem(STORE, JSON.stringify({ account, createdAt: Date.now() }))
}

function clearStored() {
  localStorage.removeItem(STORE)
  try {
    indexedDB.deleteDatabase('qxrp-wallet')
  } catch {
    /* ignore */
  }
}

export default function WalletPlClient({ mode = 'wallet' }: { mode?: 'wallet' | 'vault' }) {
  const [name, setName] = useState('')
  const [snap, setSnap] = useState<Snap | null>(null)
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('10')
  const [nominate, setNominate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const isVaultPage = mode === 'vault'

  const refresh = useCallback(async (account: string) => {
    const q = account ? `?account=${encodeURIComponent(account)}` : ''
    const r = await fetch(`/api/wallet/pl${q}`, { cache: 'no-store' })
    const d = (await r.json()) as Snap & { error?: string }
    if (!r.ok && !d.online) {
      setSnap({ online: false, account: null, error: d.error })
      return
    }
    setSnap(d)
  }, [])

  useEffect(() => {
    const stored = loadStored()
    if (stored) setName(stored)
    void refresh(stored)
    const id = setInterval(() => void refresh(loadStored()), 5_000)
    return () => clearInterval(id)
  }, [refresh])

  const openAccount = async (account: string) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      saveStored(account)
      setName(account)
      await refresh(account)
      setNotice(`Opened ${account} on Falcon PL 2300. Old 1001 wallets on this device are ignored.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open')
    } finally {
      setBusy(false)
    }
  }

  const activateVault = async () => {
    const account = snap?.account?.name
    const dest = nominate.trim()
    if (!account || !dest) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const r = await fetch('/api/wallet/pl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'vault-activate', account, destination: dest }),
      })
      const d = (await r.json()) as { error?: string; destination?: string }
      if (!r.ok) throw new Error(d.error ?? 'Vault activate failed')
      setNotice(
        `Vault activated. Protocol will only pay ${d.destination ?? dest} from this account.`,
      )
      await refresh(account)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vault activate failed')
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    const from = snap?.account?.name
    if (!from) return
    const dest =
      snap?.account?.accountType === 'vault'
        ? snap.account.allowlist?.[0] ?? ''
        : to.trim()
    if (!dest) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const r = await fetch('/api/wallet/pl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pay', from, to: dest, amount: Number(amount) }),
      })
      const d = (await r.json()) as { error?: string; txId?: string; amount?: number; to?: string }
      if (!r.ok) throw new Error(d.error ?? 'Send failed')
      setNotice(`Sent ${d.amount} FPL to ${d.to} · ${d.txId?.slice(0, 12)}…`)
      setTo('')
      await refresh(from)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    clearStored()
    setName('')
    setSnap((s) => (s ? { ...s, account: null } : s))
    setNotice('This device is wiped. Pick a test account to start again.')
  }

  const acct = snap?.account

  return (
    <ProductShell intensity={0.45}>
      <Header
        current={isVaultPage ? 'vault' : 'wallet'}
        subtitle={isVaultPage ? 'Vault · one nominated payout' : 'Falcon PL · 2300'}
      />
      <div className="bg-amber-950/50 border-b border-amber-800/40 px-4 py-2 text-center text-xs text-amber-200/90">
        <span className="font-medium">Falcon PL</span>
        {' · '}Network ID 2300
        {isVaultPage
          ? ' · Activate a vault by nominating the only address the protocol may pay'
          : ' · Fresh FPL test wallets — old 1001 passkey wallets are not used'}
      </div>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg space-y-6">
          <Logo />
          <div className="text-center space-y-1">
            <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-brand-400/90">
              {isVaultPage ? 'FPL vault' : 'FPL wallet'}
            </p>
            <h1 className="text-3xl font-bold text-white tracking-tight">
              {isVaultPage ? 'Destination-locked vault' : 'Test wallet'}
            </h1>
            <p className="text-slate-400 text-sm">
              {isVaultPage
                ? 'Nominate one payout address to activate. After lock the protocol rejects every other destination.'
                : 'Named Falcon-512 accounts already on 2300. Pick one, send FPL, or activate a vault.'}
            </p>
          </div>

          <div className="card p-5 space-y-3 border-brand-500/20 bg-slate-900/70">
            <div className="text-xs text-slate-500 uppercase tracking-wider">Open a test account</div>
            <div className="grid grid-cols-2 gap-2">
              {TEST_ACCOUNTS.map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  onClick={() => void openAccount(id)}
                  className={`py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
                    acct?.name === id
                      ? 'bg-brand-500/20 text-brand-300 border-brand-500/40'
                      : 'bg-slate-800 text-slate-200 border-slate-700 hover:border-brand-500/40'
                  }`}
                >
                  {id}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (name.trim()) void openAccount(name.trim())
              }}
            >
              <input
                className="input-field flex-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="or type a PL name"
                spellCheck={false}
              />
              <button type="submit" className="btn-primary w-auto px-4" disabled={busy || !name.trim()}>
                Open
              </button>
            </form>
          </div>

          {snap && (
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Tip" value={snap.tip != null ? `#${snap.tip.toLocaleString()}` : '—'} />
              <Stat label="Mesh" value={snap.online ? 'live' : 'offline'} />
              <Stat label="Balance" value={acct ? `${acct.balance.toLocaleString()} FPL` : '—'} />
              <Stat label="Sequence" value={acct ? String(acct.sequence) : '—'} />
            </div>
          )}

          {acct && (
            <div className="card p-5 space-y-4 border-brand-500/20 bg-slate-900/70">
              <div>
                <div className="text-xs text-slate-500 uppercase tracking-wider">Receive</div>
                <div className="mt-1 font-mono text-lg text-brand-300">{acct.name}</div>
                <p className="text-xs text-slate-500 mt-1">
                  Type: {acct.accountType ?? 'hot'}
                  {acct.vaultLocked ? ' · locked' : ''}
                  {acct.allowlist && acct.allowlist.length > 0
                    ? ` · payout only to ${acct.allowlist.join(', ')}`
                    : ''}
                </p>
              </div>

              {acct.accountType !== 'vault' && (
                <div className="space-y-2 rounded-xl border border-brand-500/30 bg-slate-950/40 p-3">
                  <div className="text-xs text-slate-500 uppercase tracking-wider">
                    {isVaultPage ? 'Nominate payout address' : 'Activate vault'}
                  </div>
                  <p className="text-xs text-slate-500">
                    This address is the only destination the protocol will allow. Activation locks it
                    permanently — it cannot be changed.
                  </p>
                  <input
                    className="input-field"
                    value={nominate}
                    onChange={(e) => setNominate(e.target.value)}
                    placeholder="dave"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="w-full py-3 rounded-xl font-semibold text-brand-200 bg-slate-800 hover:bg-slate-700 border border-brand-500/40 disabled:opacity-50"
                    disabled={busy || !nominate.trim() || nominate.trim() === acct.name}
                    onClick={() => void activateVault()}
                  >
                    {busy ? 'Activating…' : 'Activate vault'}
                  </button>
                </div>
              )}

              {(acct.accountType === 'vault' || !isVaultPage) && (
              <div className="space-y-2">
                <div className="text-xs text-slate-500 uppercase tracking-wider">
                  {acct.accountType === 'vault' ? 'Send to nominated address' : 'Send FPL'}
                </div>
                {acct.accountType === 'vault' ? (
                  <input
                    className="input-field"
                    value={acct.allowlist?.[0] ?? ''}
                    readOnly
                  />
                ) : (
                  <input
                    className="input-field"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="bob"
                    spellCheck={false}
                  />
                )}
                <input
                  className="input-field"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="numeric"
                  placeholder="10"
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={
                    busy ||
                    !amount ||
                    (acct.accountType === 'vault' ? !acct.allowlist?.[0] : !to.trim())
                  }
                  onClick={() => void send()}
                >
                  {busy ? 'Sending…' : `Send ${amount || '0'} FPL`}
                </button>
              </div>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}
          {notice && (
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-300">
              {notice}
            </div>
          )}

          <div className="flex flex-wrap gap-3 text-sm">
            <Link href="/faucet" className="text-brand-400 hover:text-brand-300">
              Faucet →
            </Link>
            {isVaultPage ? (
              <Link href="/wallet" className="text-slate-500 hover:text-brand-400">
                Wallet
              </Link>
            ) : (
              <Link href="/vault" className="text-slate-500 hover:text-brand-400">
                Vault
              </Link>
            )}
            <Link href="/scan" className="text-slate-500 hover:text-brand-400">
              Explorer
            </Link>
            <button type="button" onClick={reset} className="ml-auto text-slate-500 hover:text-red-400">
              Wipe this device
            </button>
          </div>
        </div>
      </main>
    </ProductShell>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-4 py-3 border-slate-800/80 bg-slate-900/60">
      <div className="text-xs text-slate-500 mb-0.5">{label}</div>
      <div className="font-mono text-sm text-slate-200">{value}</div>
    </div>
  )
}
