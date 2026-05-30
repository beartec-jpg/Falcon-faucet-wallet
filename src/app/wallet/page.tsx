'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import {
  isPasskeySupported,
  registerPasskey,
  authenticatePasskey,
} from '@/lib/passkey'
import { encryptSeed, decryptSeed } from '@/lib/wallet-crypto'
import {
  saveWallet,
  loadWallets,
  deleteWallet,
  type StoredWallet,
} from '@/lib/wallet-store'
import {
  generateWallet,
  keysFromSeed,
  signPayment,
  qxrpToDrops,
} from '@/lib/wallet-sign-client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TxRecord {
  hash:         string
  type:         string
  amount?:      string
  destination?: string
  account:      string
  result:       string
  date?:        number
}

interface AccountData {
  balance:      number
  sequence:     number
  exists:       boolean
  transactions: TxRecord[]
  currentLedger: number
}

type View = 'loading' | 'no-wallet' | 'restore' | 'dashboard' | 'send' | 'receive' | 'node'

// ─── Constants ────────────────────────────────────────────────────────────────

const DROPS_PER_QXRP = 1_000_000

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shortAddr(addr: string): string {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`
}

function fmtDrops(drops: string | undefined): string {
  if (!drops) return '—'
  const n = parseInt(drops, 10)
  if (isNaN(n)) return '—'
  return (n / DROPS_PER_QXRP).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  })
}

function fmtDate(rippleDate?: number): string {
  if (!rippleDate) return ''
  // Ripple epoch starts 2000-01-01 (946684800 unix seconds)
  return new Date((rippleDate + 946684800) * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ─── Spinner ─────────────────────────────────────────────────────────────────

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin-slow ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function WalletPage() {
  const [view,    setView]    = useState<View>('loading')
  const [wallet,  setWallet]  = useState<StoredWallet | null>(null)
  const [account, setAccount] = useState<AccountData | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [busy,    setBusy]    = useState(false)
  const [copied,  setCopied]  = useState(false)
  const [nodeName, setNodeName] = useState('my-qxrp-node')

  // Create-wallet form
  const [createLabel, setCreateLabel] = useState('')

  // Send form
  const [sendTo,     setSendTo]     = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sendResult, setSendResult] = useState<{
    success: boolean; hash?: string; message: string
  } | null>(null)

  // Restore form
  const [restoreSeed,  setRestoreSeed]  = useState('')
  const [restoreLabel, setRestoreLabel] = useState('')

  // ── Fetch account balance ─────────────────────────────────────────────────

  const refreshBalance = useCallback(async (address: string) => {
    try {
      const r = await fetch(`/api/wallet/account?address=${encodeURIComponent(address)}`)
      if (!r.ok) return
      const data: AccountData = await r.json()
      setAccount(data)
    } catch { /* non-fatal */ }
  }, [])

  // ── On mount: load wallet from IndexedDB ──────────────────────────────────

  useEffect(() => {
    loadWallets().then(wallets => {
      if (wallets.length > 0) {
        setWallet(wallets[0])
        setView('dashboard')
        refreshBalance(wallets[0].address)
      } else {
        setView('no-wallet')
      }
    }).catch(() => setView('no-wallet'))
  }, [refreshBalance])

  // ── Create wallet ─────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!isPasskeySupported()) {
      setError('Passkeys need a secure context (HTTPS or localhost). Please use the live site.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const label = createLabel.trim() || 'My qXRP Wallet'

      // 1. Generate XRPL keypair + seed (browser-side, never leaves device)
      const { seed, address, publicKey } = await generateWallet()

      // 2. Register passkey + get key material for encryption
      const { credentialId, keyBytes, hasPrf } = await registerPasskey(label)

      // 3. Encrypt seed with AES-GCM keyed from passkey material
      const encrypted = await encryptSeed(seed, keyBytes, hasPrf)

      // 4. Save to IndexedDB
      const stored: StoredWallet = {
        credentialId,
        address,
        publicKey,
        label,
        encrypted,
        hasPrf,
        createdAt: Date.now(),
      }
      await saveWallet(stored)

      setWallet(stored)
      setView('dashboard')
      refreshBalance(address)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Wallet creation failed')
    } finally {
      setBusy(false)
    }
  }

  // ── Restore from seed ─────────────────────────────────────────────────────

  const handleRestore = async () => {
    if (!isPasskeySupported()) {
      setError('Passkeys need a secure context (HTTPS or localhost).')
      return
    }
    const seed = restoreSeed.trim()
    if (!seed) { setError('Please enter your XRPL secret'); return }

    setBusy(true)
    setError(null)
    try {
      // Validate seed by deriving keys
      const { address, publicKey } = await keysFromSeed(seed)

      const label = restoreLabel.trim() || 'Restored Wallet'
      const { credentialId, keyBytes, hasPrf } = await registerPasskey(label)
      const encrypted = await encryptSeed(seed, keyBytes, hasPrf)

      const stored: StoredWallet = {
        credentialId, address, publicKey, label, encrypted, hasPrf,
        createdAt: Date.now(),
      }
      await saveWallet(stored)

      setWallet(stored)
      setRestoreSeed('')
      setView('dashboard')
      refreshBalance(address)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Restore failed. Check your seed.')
    } finally {
      setBusy(false)
    }
  }

  // ── Send transaction ──────────────────────────────────────────────────────

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!wallet || !account) return

    const to      = sendTo.trim()
    const amtQxrp = parseFloat(sendAmount)

    if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(to)) {
      setError('Invalid destination address'); return
    }
    if (isNaN(amtQxrp) || amtQxrp <= 0) {
      setError('Invalid amount'); return
    }
    if (amtQxrp > account.balance) {
      setError('Insufficient balance'); return
    }

    setBusy(true)
    setError(null)
    setSendResult(null)

    try {
      // 1. Authenticate — triggers biometric/PIN prompt
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)

      // 2. Decrypt seed (never sent to server)
      const seed = await decryptSeed(wallet.encrypted, keyBytes)

      // 3. Sign TX entirely in browser
      const { tx_blob } = await signPayment(
        {
          account:            wallet.address,
          destination:        to,
          amountDrops:        qxrpToDrops(amtQxrp),
          sequence:           account.sequence,
          lastLedgerSequence: account.currentLedger + 20,
        },
        seed
      )

      // 4. Submit signed blob to server proxy (no private data sent)
      const res = await fetch('/api/wallet/submit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tx_blob }),
      })
      const data = await res.json()

      setSendResult({
        success: !!data.success,
        hash:    data.hash,
        message: data.message ?? data.result ?? (data.success ? 'Submitted!' : 'Failed'),
      })

      if (data.success) {
        setSendTo('')
        setSendAmount('')
        setTimeout(() => refreshBalance(wallet.address), 3000)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Transaction failed')
    } finally {
      setBusy(false)
    }
  }

  // ── Copy address ──────────────────────────────────────────────────────────

  const copyAddress = () => {
    if (!wallet) return
    navigator.clipboard.writeText(wallet.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col">

      <Header current="wallet" />

      <main className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-lg space-y-4">

          {/* ── Loading ── */}
          {view === 'loading' && (
            <div className="flex items-center justify-center py-24 text-slate-500 gap-3">
              <Spinner className="w-5 h-5" />
              <span>Loading wallet…</span>
            </div>
          )}

          {/* ── No wallet — create / restore ── */}
          {view === 'no-wallet' && (
            <>
              <div className="text-center space-y-2 pb-2">
                <h1 className="text-3xl font-bold text-white">
                  qXRP <span className="text-brand-500">Wallet</span>
                </h1>
                <p className="text-slate-400 text-sm">
                  Your keys stay on this device, secured by passkey
                </p>
              </div>

              <div className="card p-6 space-y-4">
                {/* Security notice */}
                <div className="flex items-start gap-3 text-sm text-slate-400 bg-slate-800/50 rounded-xl px-4 py-3">
                  <svg className="w-5 h-5 text-brand-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                  <span>
                    Wallet creation and every transaction uses your device passkey
                    (Face ID, fingerprint, or PIN). Your private key is encrypted
                    locally — no server ever sees it.
                  </span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Wallet name <span className="text-slate-600">(optional)</span></label>
                  <input
                    type="text"
                    value={createLabel}
                    onChange={e => setCreateLabel(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !busy && handleCreate()}
                    placeholder="My qXRP Wallet"
                    className="input-field"
                    disabled={busy}
                    maxLength={40}
                  />
                </div>

                <button onClick={handleCreate} disabled={busy} className="btn-primary flex items-center justify-center gap-2">
                  {busy ? (
                    <><Spinner /> Creating wallet…</>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                      Create Wallet with Passkey
                    </>
                  )}
                </button>

                <div className="text-center">
                  <button
                    onClick={() => { setView('restore'); setError(null) }}
                    className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    Restore from existing seed →
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── Restore from seed ── */}
          {view === 'restore' && (
            <>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setView('no-wallet'); setError(null) }}
                  className="text-slate-500 hover:text-slate-300 transition-colors p-1"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h2 className="font-semibold text-white">Restore Existing Wallet</h2>
              </div>

              <div className="card p-6 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">XRPL secret (seed)</label>
                  <input
                    type="text"
                    value={restoreSeed}
                    onChange={e => setRestoreSeed(e.target.value)}
                    placeholder="sXXX…"
                    className="input-field"
                    disabled={busy}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Wallet name <span className="text-slate-600">(optional)</span></label>
                  <input
                    type="text"
                    value={restoreLabel}
                    onChange={e => setRestoreLabel(e.target.value)}
                    placeholder="Restored Wallet"
                    className="input-field"
                    disabled={busy}
                    maxLength={40}
                  />
                </div>
                <button
                  onClick={handleRestore}
                  disabled={busy || !restoreSeed.trim()}
                  className="btn-primary flex items-center justify-center gap-2"
                >
                  {busy ? <><Spinner /> Restoring…</> : 'Restore & Secure with Passkey'}
                </button>
              </div>
            </>
          )}

          {/* ── Dashboard / Send / Receive ── */}
          {(view === 'dashboard' || view === 'send' || view === 'receive' || view === 'node') && wallet && (
            <>
              {/* Address + Balance card */}
              <div className="card p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-slate-500 mb-0.5">{wallet.label}</div>
                    <div className="font-mono text-slate-300 text-sm">{shortAddr(wallet.address)}</div>
                  </div>
                  <button
                    onClick={copyAddress}
                    className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors"
                    title="Copy full address"
                  >
                    {copied ? (
                      <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>

                {/* Balance */}
                <div>
                  <div className="text-xs text-slate-500 mb-1">Balance</div>
                  {account === null ? (
                    <div className="text-2xl font-bold text-slate-600">—</div>
                  ) : !account.exists ? (
                    <div>
                      <div className="text-2xl font-bold text-slate-600">0 <span className="text-lg text-slate-700">qXRP</span></div>
                      <div className="text-xs text-slate-600 mt-1">Account not yet activated — fund it first</div>
                    </div>
                  ) : (
                    <div className="text-3xl font-bold text-white">
                      {account.balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                      <span className="text-brand-500 text-xl ml-2">qXRP</span>
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setView('send'); setError(null); setSendResult(null) }}
                    disabled={!account?.exists}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-brand-500 hover:bg-brand-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 transition-colors"
                  >
                    Send
                  </button>
                  <button
                    onClick={() => setView(view === 'receive' ? 'dashboard' : 'receive')}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                  >
                    {view === 'receive' ? 'Done' : 'Receive'}
                  </button>
                  <button
                    onClick={() => setView(view === 'node' ? 'dashboard' : 'node')}
                    className={`py-2.5 px-3 rounded-xl text-sm font-semibold transition-colors ${
                      view === 'node'
                        ? 'bg-cyan-600 text-white'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-400'
                    }`}
                    title="Run a validator node"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M5 12H3m2 0a2 2 0 100-4 2 2 0 000 4zm0 0a2 2 0 100 4 2 2 0 000-4zm8-4H9m4 0a2 2 0 100-4 2 2 0 000 4zm0 0a2 2 0 100 4 2 2 0 000-4zm8-4h-2m2 0a2 2 0 100-4 2 2 0 000 4zm0 0a2 2 0 100 4 2 2 0 000-4" />
                    </svg>
                  </button>
                  <button
                    onClick={() => refreshBalance(wallet.address)}
                    className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors"
                    title="Refresh balance"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* ── Receive panel ── */}
              {view === 'receive' && (
                <div className="card p-5 space-y-4">
                  <h3 className="font-semibold text-white text-sm">Receive qXRP</h3>
                  <div className="bg-white rounded-xl p-3 mx-auto w-fit">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(wallet.address)}&size=180x180&margin=0`}
                      alt="Address QR code"
                      width={180}
                      height={180}
                      className="rounded"
                    />
                  </div>
                  <div className="bg-slate-800 rounded-xl px-3 py-2.5 font-mono text-xs text-slate-300 break-all text-center leading-relaxed">
                    {wallet.address}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={copyAddress}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                    >
                      {copied ? '✓ Copied!' : 'Copy Address'}
                    </button>
                    <Link
                      href={`/?address=${encodeURIComponent(wallet.address)}`}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors text-center"
                    >
                      Get from Faucet →
                    </Link>
                  </div>
                </div>
              )}

              {/* ── Send panel ── */}
              {view === 'send' && (
                <div className="card p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setView('dashboard'); setError(null); setSendResult(null) }}
                      className="text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <h3 className="font-semibold text-white text-sm">Send qXRP</h3>
                  </div>

                  {sendResult ? (
                    <div className={`rounded-xl px-4 py-4 space-y-2 ${
                      sendResult.success
                        ? 'bg-emerald-500/10 border border-emerald-500/20'
                        : 'bg-red-500/10 border border-red-500/20'
                    }`}>
                      <div className={`flex items-center gap-2 font-medium text-sm ${sendResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                        {sendResult.success ? (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                        {sendResult.success ? 'Transaction submitted!' : 'Transaction failed'}
                      </div>
                      {sendResult.hash && (
                        <div className="font-mono text-xs text-slate-400 break-all">{sendResult.hash}</div>
                      )}
                      <div className="text-xs text-slate-500">{sendResult.message}</div>
                      <button
                        onClick={() => { setSendResult(null); setView('dashboard') }}
                        className="text-sm text-brand-400 hover:text-brand-300 transition-colors"
                      >
                        ← Back to wallet
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleSend} className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-xs text-slate-400">Destination address</label>
                        <input
                          type="text"
                          value={sendTo}
                          onChange={e => { setSendTo(e.target.value); setError(null) }}
                          placeholder="rXXX…"
                          className="input-field"
                          disabled={busy}
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs text-slate-400">Amount (qXRP)</label>
                        <input
                          type="number"
                          value={sendAmount}
                          onChange={e => { setSendAmount(e.target.value); setError(null) }}
                          placeholder="0.000000"
                          min="0.000001"
                          step="any"
                          className="input-field"
                          disabled={busy}
                        />
                        {account?.exists && (
                          <div className="flex justify-between text-xs text-slate-600">
                            <span>Available: {account.balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} qXRP</span>
                            <button
                              type="button"
                              onClick={() => setSendAmount(String(Math.max(0, account.balance - 0.000012)))}
                              className="text-brand-500 hover:text-brand-400 transition-colors"
                            >
                              Max
                            </button>
                          </div>
                        )}
                      </div>
                      <button
                        type="submit"
                        disabled={busy || !sendTo.trim() || !sendAmount}
                        className="btn-primary flex items-center justify-center gap-2"
                      >
                        {busy ? (
                          <><Spinner /> Waiting for passkey…</>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                            </svg>
                            Sign &amp; Send with Passkey
                          </>
                        )}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* ── Node panel (one-command validator onboarding) ── */}
              {view === 'node' && (
                <div className="card p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M5 12H3m2 0a2 2 0 100-4 2 2 0 000 4zm0 0a2 2 0 100 4 2 2 0 000-4zm8-4H9m4 0a2 2 0 100-4 2 2 0 000 4zm0 0a2 2 0 100 4 2 2 0 000-4zm8-4h-2m2 0a2 2 0 100-4 2 2 0 000 4zm0 0a2 2 0 100 4 2 2 0 000-4" />
                    </svg>
                    <h3 className="font-semibold text-white text-sm">Run a Validator Node</h3>
                  </div>

                  {/* THE EXACT WARNING USER REQUESTED */}
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-200">
                    <div className="flex gap-2.5">
                      <div className="text-base mt-px">⚠️</div>
                      <div className="text-sm leading-snug">
                        <span className="font-semibold">You need 1,000 qXRP to bond.</span><br />
                        It is <span className="underline">recommended to get that first</span> from the faucet before running the command.
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400">
                    One command on any Ubuntu 22.04/24.04 VPS. The installer will <span className="text-amber-300">print a new validator r-address</span> — you fund that one (not this wallet). It then auto-bonds once it sees ≥1,100 qXRP.
                    This wallet address is used as the <span className="text-emerald-300">payout / withdraw destination</span>.
                  </p>

                  {/* Payout address (auto-linked) */}
                  <div className="bg-slate-800/70 rounded-xl px-3 py-2 space-y-0.5">
                    <div className="text-[10px] text-slate-500">Payout / withdraw address (auto-linked via --payout)</div>
                    <div className="font-mono text-xs text-emerald-300 break-all">{wallet.address}</div>
                  </div>

                  {/* Node name + live command */}
                  <div className="space-y-2">
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-1">Node name (optional)</label>
                      <input
                        value={nodeName}
                        onChange={(e) => setNodeName(e.target.value || 'my-qxrp-node')}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-mono text-white focus:outline-none focus:border-cyan-500/60"
                        placeholder="my-qxrp-node"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="text-[10px] text-slate-500">One-liner — copy and paste into your server terminal:</div>
                      <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-[11px] text-emerald-300 font-mono whitespace-pre-wrap break-all leading-snug">
{`curl -fsSL https://raw.githubusercontent.com/beartec-jpg/qXRP/develop/bin/install/install-qxrp-validator.sh | bash -s -- \\
  --payout ${wallet.address} \\
  --node-name ${nodeName || 'my-qxrp-node'}`}
                      </pre>

                      <button
                        onClick={async () => {
                          const cmd = `curl -fsSL https://raw.githubusercontent.com/beartec-jpg/qXRP/develop/bin/install/install-qxrp-validator.sh | bash -s -- \\
  --payout ${wallet.address} \\
  --node-name ${nodeName || 'my-qxrp-node'}`
                          await navigator.clipboard.writeText(cmd)
                          setCopied(true)
                          setTimeout(() => setCopied(false), 2200)
                        }}
                        className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-semibold text-sm transition flex items-center justify-center gap-2"
                      >
                        {copied ? (
                          <>Copied to clipboard ✓</>
                        ) : (
                          <>📋 Copy one-liner command</>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Accurate what happens */}
                  <div className="space-y-1.5 pt-1">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">What the command does</div>
                    <ol className="space-y-0.5 text-xs text-slate-400">
                      {[
                        'Installs Docker + starts official qXRP validator container',
                        'Generates validator keys (classical + Falcon identity)',
                        'Prints a NEW validator r-address in huge text — fund this',
                        'Polls until ≥1,100 qXRP, then auto-submits ValidatorRegister + Bond(1000)',
                        'Installs reward claimer (cron) — claims go into the validator account',
                        `Your --payout (${wallet.address.slice(0,10)}…) is saved for easy future withdrawals`,
                      ].map((step, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-cyan-600 font-mono flex-shrink-0 text-[10px]">{String(i + 1).padStart(2, '0')}</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-800">
                    Rewards land in the validator account. Withdraw excess to this wallet later via the portal or manually.
                    Full guide + troubleshooting:{' '}
                    <a href="https://github.com/beartec-jpg/qXRP/blob/develop/docs/validator-onboarding.md" target="_blank" className="underline text-slate-400 hover:text-slate-300">
                      validator-onboarding.md
                    </a>
                  </div>

                  <button
                    onClick={() => setView('dashboard')}
                    className="text-xs text-slate-600 hover:text-slate-400 transition-colors w-full text-center py-1"
                  >
                    ← Back to wallet
                  </button>
                </div>
              )}

              {/* ── Faucet shortcut ── */}
              {view === 'dashboard' && (
                <Link
                  href={`/?address=${encodeURIComponent(wallet.address)}`}
                  className="card px-4 py-3 flex items-center justify-between text-sm hover:border-brand-500/40 transition-all"
                >
                  <div className="flex items-center gap-2 text-slate-400">
                    <svg className="w-4 h-4 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Top up from Faucet
                  </div>
                  <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              )}

              {/* ── Transaction history ── */}
              {view === 'dashboard' && account && account.transactions.length > 0 && (
                <div className="card divide-y divide-slate-800/60">
                  <div className="px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Recent Transactions
                  </div>
                  {account.transactions.map((tx, i) => {
                    const incoming = tx.destination === wallet.address
                    const amt = fmtDrops(tx.amount)
                    const ok  = tx.result === 'tesSUCCESS'
                    return (
                      <div key={tx.hash ?? i} className="px-4 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-7 h-7 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
                            incoming ? 'bg-emerald-500/15 text-emerald-400' : 'bg-brand-500/15 text-brand-400'
                          }`}>
                            {incoming ? '↓' : '↑'}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm text-slate-300 truncate">{tx.type}</div>
                            <div className="text-xs text-slate-600 font-mono truncate">
                              {tx.hash ? `${tx.hash.slice(0, 12)}…` : ''}
                            </div>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 pl-3">
                          <div className={`text-sm font-medium ${
                            !ok ? 'text-red-400' : incoming ? 'text-emerald-400' : 'text-slate-300'
                          }`}>
                            {!ok ? 'failed' : `${incoming ? '+' : '-'}${amt} qXRP`}
                          </div>
                          <div className="text-xs text-slate-600">{fmtDate(tx.date)}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* ── Remove wallet ── */}
              {view === 'dashboard' && (
                <button
                  onClick={async () => {
                    if (!confirm('Remove this wallet from this device? Make sure you have a copy of your seed phrase first.')) return
                    await deleteWallet(wallet.credentialId)
                    setWallet(null)
                    setAccount(null)
                    setView('no-wallet')
                  }}
                  className="text-xs text-slate-700 hover:text-red-500 transition-colors w-full text-center py-2"
                >
                  Remove wallet from this device
                </button>
              )}
            </>
          )}

          {/* ── Global error ── */}
          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400 flex items-start gap-2">
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}

          {/* ── Footer note ── */}
          <p className="text-center text-xs text-slate-700">
            Testnet tokens · No real value ·{' '}
            <a
              href="https://github.com/beartec-jpg/qXRP"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-500 underline underline-offset-2 transition-colors"
            >
              qXRP on GitHub
            </a>
          </p>
        </div>
      </main>
    </div>
  )
}
