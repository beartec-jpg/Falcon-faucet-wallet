'use client'

/**
 * Falcon Vault — air-gapped custody surface (separate from hot wallet).
 *
 * Hot portal stores PUBLIC metadata only. Secrets live on the cold signer
 * (encrypted vault JSON on offline media). Unlock via multi-part QR challenge
 * from cold; Payment send uses multi-part QR sign loop.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import Header from '@/components/Header'
import NetworkBanner from '@/components/NetworkBanner'
import { useNetwork } from '@/components/NetworkProvider'
import { withNetworkQuery } from '@/lib/network-query'
import { generateWallet, buildPaymentTxJson, qxrpToDrops, WALLET_BASE_FEE } from '@/lib/wallet-sign-client'
import {
  createEncryptedVaultFile,
  downloadVaultFile,
  parseVaultFile,
  publicFromVaultFile,
  validateVaultPassphrase,
  vaultFingerprint,
  type EncryptedVaultFile,
} from '@/lib/vault-export'
import {
  loadPrimaryVault,
  replacePrimaryVault,
  deleteVault,
  newVaultId,
  type VaultPublicRecord,
} from '@/lib/vault-store'
import {
  clearVaultSession,
  isVaultUnlocked,
  loadVaultSession,
  openVaultSession,
  sessionRemainingMs,
  VAULT_SESSION_TTL_MS,
} from '@/lib/vault-session'
import {
  CODEC_VERSION,
  createUnlockChallenge,
  encodeUnlockChallenge,
  encodeUnsignedPayment,
  parseSignedTx,
  parseUnlockResponse,
  type VaultUnlockChallenge,
  type VaultUnsignedPayment,
} from '@/lib/vault-protocol'
import { verifyUnlockResponse } from '@/lib/vault-unlock-verify'
import { encodeMultiQr, type EncodedMultiQr } from '@/lib/multi-qr'
import {
  fetchSequenceInfo,
  submitWalletTx,
  DEFAULT_LEDGER_OFFSET,
} from '@/lib/wallet-submit'
import { isValidFalconAddress, parseFalconAddressFromScan } from '@/lib/parse-falcon-address'

const MultiQrDisplay = dynamic(() => import('@/components/MultiQrDisplay'), { ssr: false })
const MultiQrScanner = dynamic(() => import('@/components/MultiQrScanner'), { ssr: false })
const AddressQrScanner = dynamic(() => import('@/components/AddressQrScanner'), { ssr: false })

type View =
  | 'loading'
  | 'empty'
  | 'create'
  | 'locked'
  | 'unlock-chal'
  | 'unlock-scan'
  | 'unlocked'
  | 'receive'
  | 'send'
  | 'send-unsigned'
  | 'send-scan-signed'

interface AccountSnap {
  balance: number
  exists: boolean
  sequence: number
  currentLedger: number
}

export default function VaultPage() {
  const { network } = useNetwork()
  const [view, setView] = useState<View>('loading')
  const [vault, setVault] = useState<VaultPublicRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Create form
  const [label, setLabel] = useState('Vault')
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [downloaded, setDownloaded] = useState(false)
  const [acked, setAcked] = useState(false)

  // Unlock
  const [challenge, setChallenge] = useState<VaultUnlockChallenge | null>(null)
  const [chalEncoded, setChalEncoded] = useState<EncodedMultiQr | null>(null)
  const [sessionLeft, setSessionLeft] = useState(0)

  // Balance
  const [account, setAccount] = useState<AccountSnap | null>(null)

  // Send
  const [dest, setDest] = useState('')
  const [amount, setAmount] = useState('')
  const [scanDest, setScanDest] = useState(false)
  const [unsignedEnc, setUnsignedEnc] = useState<EncodedMultiQr | null>(null)
  const [sendHash, setSendHash] = useState<string | null>(null)

  const refreshVault = useCallback(async () => {
    const v = await loadPrimaryVault()
    setVault(v)
    if (!v) {
      setView('empty')
      return
    }
    if (isVaultUnlocked(v)) {
      setView('unlocked')
      setSessionLeft(sessionRemainingMs())
    } else {
      setView('locked')
    }
  }, [])

  useEffect(() => {
    refreshVault().catch((e) => {
      setError(e instanceof Error ? e.message : 'Failed to load vault')
      setView('empty')
    })
  }, [refreshVault])

  // Session countdown
  useEffect(() => {
    if (view !== 'unlocked' && view !== 'receive' && view !== 'send') return
    const t = setInterval(() => {
      const left = sessionRemainingMs()
      setSessionLeft(left)
      if (left <= 0 && vault) {
        clearVaultSession()
        setView('locked')
        setAccount(null)
      }
    }, 1000)
    return () => clearInterval(t)
  }, [view, vault])

  const loadBalance = useCallback(async (address: string) => {
    try {
      const res = await fetch(
        withNetworkQuery(`/api/wallet/account?address=${encodeURIComponent(address)}`, network.key),
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Account fetch failed')
      setAccount({
        balance: data.balance ?? 0,
        exists: !!data.exists,
        sequence: data.sequence ?? 0,
        currentLedger: data.currentLedger ?? 0,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Balance fetch failed')
    }
  }, [network.key])

  useEffect(() => {
    if ((view === 'unlocked' || view === 'send') && vault) {
      loadBalance(vault.address)
    }
  }, [view, vault, loadBalance])

  // ── Create vault ────────────────────────────────────────────────────────────

  async function handleCreateVault() {
    setError(null)
    const passErr = validateVaultPassphrase(pass)
    if (passErr) {
      setError(passErr)
      return
    }
    if (pass !== pass2) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    try {
      const keys = await generateWallet()
      const createdAt = Date.now()
      const file = await createEncryptedVaultFile(
        {
          falcon_secret: keys.falcon_secret,
          address: keys.address,
          publicKey: keys.publicKey,
          label: label.trim() || 'Vault',
          createdAt,
        },
        pass,
      )
      downloadVaultFile(file)
      setDownloaded(true)

      // Wipe secret reference (string GC only — best effort)
      ;(keys as { falcon_secret?: string }).falcon_secret = undefined

      const fingerprint =
        file.fingerprint ?? (await vaultFingerprint(keys.address, keys.publicKey))
      const record: VaultPublicRecord = {
        vaultId: newVaultId(),
        address: keys.address,
        publicKey: keys.publicKey,
        label: label.trim() || 'Vault',
        createdAt,
        fingerprint,
      }
      // Wait for user ack before saving — store pending in state via download flag
      sessionStorage.setItem(
        'falcon-vault-pending-public',
        JSON.stringify(record),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vault creation failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirmCreate() {
    if (!downloaded || !acked) return
    setBusy(true)
    setError(null)
    try {
      const raw = sessionStorage.getItem('falcon-vault-pending-public')
      if (!raw) throw new Error('Missing pending vault — create again')
      const record = JSON.parse(raw) as VaultPublicRecord
      await replacePrimaryVault(record)
      sessionStorage.removeItem('falcon-vault-pending-public')
      setVault(record)
      setPass('')
      setPass2('')
      setDownloaded(false)
      setAcked(false)
      clearVaultSession()
      setView('locked')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save vault')
    } finally {
      setBusy(false)
    }
  }

  /** Register public vault from an existing encrypted file (outer metadata only). */
  async function handleImportPublicFile(file: File) {
    setError(null)
    setBusy(true)
    try {
      const text = await file.text()
      const parsed = parseVaultFile(JSON.parse(text)) as EncryptedVaultFile
      const pub = publicFromVaultFile(parsed)
      const record: VaultPublicRecord = {
        vaultId: newVaultId(),
        ...pub,
        fingerprint: pub.fingerprint ?? (await vaultFingerprint(pub.address, pub.publicKey)),
      }
      await replacePrimaryVault(record)
      setVault(record)
      clearVaultSession()
      setView('locked')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  // ── Unlock ──────────────────────────────────────────────────────────────────

  function startUnlock() {
    if (!vault) return
    setError(null)
    const chal = createUnlockChallenge(vault.address)
    setChallenge(chal)
    const enc = encodeMultiQr(encodeUnlockChallenge(chal), 'vault-unlock-chal')
    setChalEncoded(enc)
    setView('unlock-chal')
  }

  async function onUnlockResponse(payload: string) {
    if (!vault || !challenge) return
    setError(null)
    setBusy(true)
    try {
      const resp = parseUnlockResponse(payload)
      const ok = await verifyUnlockResponse(challenge, resp, vault.publicKey)
      if (!ok) throw new Error('Unlock signature invalid or challenge mismatch')
      openVaultSession(vault)
      setSessionLeft(VAULT_SESSION_TTL_MS)
      setChallenge(null)
      setChalEncoded(null)
      setView('unlocked')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unlock failed')
      setView('locked')
    } finally {
      setBusy(false)
    }
  }

  function lockNow() {
    clearVaultSession()
    setSessionLeft(0)
    setAccount(null)
    setView('locked')
  }

  // ── Send (Payment) ──────────────────────────────────────────────────────────

  async function buildUnsignedPayment() {
    if (!vault) return
    setError(null)
    const destination = dest.trim()
    if (!isValidFalconAddress(destination)) {
      setError('Invalid destination address')
      return
    }
    const amt = parseFloat(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a valid amount')
      return
    }
    if (!network.live) {
      setError('Network is not live')
      return
    }
    setBusy(true)
    try {
      const seq = await fetchSequenceInfo(vault.address, network.key)
      if (!seq.exists) {
        throw new Error('Vault address is not funded on-ledger yet — receive FALCON first')
      }
      const amountDrops = qxrpToDrops(amt)
      const fee = WALLET_BASE_FEE
      const lastLedgerSequence = seq.currentLedger + DEFAULT_LEDGER_OFFSET
      const tx_json = buildPaymentTxJson({
        account: vault.address,
        destination,
        amountDrops,
        sequence: seq.sequence,
        lastLedgerSequence,
        networkId: network.networkId,
        publicKeyHex: vault.publicKey,
        fee,
      })
      const pkg: VaultUnsignedPayment = {
        type: 'falcon-unsigned-tx',
        v: 1,
        codecVersion: CODEC_VERSION,
        networkId: network.networkId,
        display: {
          transactionType: 'Payment',
          account: vault.address,
          destination,
          amountDrops,
          fee,
          sequence: seq.sequence,
          lastLedgerSequence,
        },
        tx_json,
      }
      setUnsignedEnc(encodeMultiQr(encodeUnsignedPayment(pkg), 'unsigned-tx'))
      setView('send-unsigned')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to build transaction')
    } finally {
      setBusy(false)
    }
  }

  async function onSignedPayload(payload: string) {
    setError(null)
    setBusy(true)
    try {
      const signed = parseSignedTx(payload)
      const result = await submitWalletTx(signed.tx_blob, network.key)
      setSendHash(result.hash ?? null)
      setUnsignedEnc(null)
      setAmount('')
      setDest('')
      setView('unlocked')
      if (vault) await loadBalance(vault.address)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed')
      setView('send')
    } finally {
      setBusy(false)
    }
  }

  async function removeVault() {
    if (!vault) return
    if (!confirm('Remove vault public record from this browser? The cold file is unaffected.')) return
    await deleteVault(vault.vaultId)
    clearVaultSession()
    setVault(null)
    setView('empty')
  }

  const sessionLabel = useMemo(() => {
    const s = Math.ceil(sessionLeft / 1000)
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${m}:${r.toString().padStart(2, '0')}`
  }, [sessionLeft])

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      <Header current="wallet" subtitle="Vault (cold)" />
      <NetworkBanner />

      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <span className="text-cyan-400">❄</span> Vault
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Air-gapped custody — secrets never stored on this device
            </p>
          </div>
          <Link href="/wallet" className="text-xs text-slate-400 hover:text-brand-400">
            ← Hot wallet
          </Link>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
            {error}
            <button type="button" className="ml-2 text-amber-400 underline" onClick={() => setError(null)}>
              dismiss
            </button>
          </div>
        )}

        {view === 'loading' && (
          <p className="text-slate-400 text-sm">Loading vault…</p>
        )}

        {/* Empty */}
        {view === 'empty' && (
          <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <p className="text-sm text-slate-300">
              No vault on this browser. Create one and move the encrypted file to your cold signer
              (offline phone / SD card). This browser keeps only the public address.
            </p>
            <button
              type="button"
              onClick={() => {
                setView('create')
                setError(null)
              }}
              className="w-full py-3 rounded-xl font-semibold bg-cyan-600 hover:bg-cyan-500 text-white"
            >
              Create vault
            </button>
            <label className="block w-full text-center text-sm text-slate-400 hover:text-slate-200 cursor-pointer py-2">
              Import public record from vault file
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleImportPublicFile(f)
                }}
              />
            </label>
          </div>
        )}

        {/* Create */}
        {view === 'create' && (
          <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="text-sm font-semibold text-white">Create vault</h2>
            <p className="text-xs text-slate-400">
              A new Falcon-512 key is generated here, encrypted into a vault file, then wiped.
              Store the file offline and load it on the cold signer.
            </p>
            <label className="block text-xs text-slate-400">
              Label
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="block text-xs text-slate-400">
              Vault file password
              <input
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
                autoComplete="new-password"
              />
            </label>
            <label className="block text-xs text-slate-400">
              Confirm password
              <input
                type="password"
                value={pass2}
                onChange={(e) => setPass2(e.target.value)}
                className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
                autoComplete="new-password"
              />
            </label>
            {!downloaded ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleCreateVault()}
                className="w-full py-3 rounded-xl font-semibold bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white"
              >
                {busy ? 'Generating…' : 'Generate & download vault file'}
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-emerald-400">
                  Vault file downloaded. Move it to offline storage (SD / USB), then confirm.
                </p>
                <label className="flex items-start gap-2 text-xs text-slate-300">
                  <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)} />
                  I saved the vault file offline. This browser will only keep the public address —
                  the secret will not be stored here.
                </label>
                <button
                  type="button"
                  disabled={!acked || busy}
                  onClick={() => void handleConfirmCreate()}
                  className="w-full py-3 rounded-xl font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white"
                >
                  Save public vault on this device
                </button>
              </div>
            )}
            <button
              type="button"
              className="w-full text-xs text-slate-500 hover:text-slate-300"
              onClick={() => setView('empty')}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Locked */}
        {view === 'locked' && vault && (
          <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🔒</span>
              <div>
                <p className="text-sm font-semibold text-white">{vault.label}</p>
                <p className="text-[11px] font-mono text-slate-500 break-all">{vault.address}</p>
                {vault.fingerprint && (
                  <p className="text-[10px] text-slate-600">fp {vault.fingerprint}</p>
                )}
              </div>
            </div>
            <p className="text-xs text-slate-400">
              Vault is locked. Unlock with your cold signer, or receive funds (address only).
            </p>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={startUnlock}
                className="flex-1 min-w-[140px] py-3 rounded-xl font-semibold bg-cyan-600 hover:bg-cyan-500 text-white"
              >
                Unlock vault
              </button>
              <button
                type="button"
                onClick={() => setView('receive')}
                className="flex-1 min-w-[140px] py-3 rounded-xl font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100"
              >
                Receive
              </button>
            </div>
            <button
              type="button"
              onClick={() => void removeVault()}
              className="w-full text-[11px] text-slate-600 hover:text-red-400"
            >
              Remove public record from this browser
            </button>
          </div>
        )}

        {/* Unlock: show challenge QR */}
        {view === 'unlock-chal' && chalEncoded && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-2">
            <MultiQrDisplay
              encoded={chalEncoded}
              title="1. Scan this challenge on cold signer"
              hint="On cold: Unlock vault → scan this animated QR → then show the response QR."
              onDone={() => setView('unlock-scan')}
              doneLabel="Cold scanned — scan response →"
            />
          </div>
        )}

        {view === 'unlock-scan' && (
          <MultiQrScanner
            title="2. Scan unlock response from cold"
            expectedCt="vault-unlock-resp"
            onComplete={(payload) => void onUnlockResponse(payload)}
            onClose={() => {
              setChallenge(null)
              setChalEncoded(null)
              setView('locked')
            }}
          />
        )}

        {/* Unlocked dashboard */}
        {view === 'unlocked' && vault && (
          <div className="space-y-4 rounded-2xl border border-cyan-500/20 bg-slate-900/60 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white flex items-center gap-1.5">
                  <span className="text-emerald-400">🔓</span> {vault.label}
                </p>
                <p className="text-[11px] font-mono text-slate-500 break-all">{vault.address}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-slate-500">Session</p>
                <p className="text-xs font-mono text-cyan-400">{sessionLabel}</p>
              </div>
            </div>
            <div className="rounded-xl bg-slate-950/80 border border-slate-800 px-4 py-3">
              <p className="text-[11px] text-slate-500">Balance</p>
              <p className="text-2xl font-bold text-white">
                {account ? account.balance.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—'}{' '}
                <span className="text-sm font-medium text-slate-400">FALCON</span>
              </p>
              {account && !account.exists && (
                <p className="text-[11px] text-amber-400 mt-1">Unfunded — receive FALCON to activate</p>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                disabled={!network.live}
                onClick={() => {
                  setView('send')
                  setSendHash(null)
                  setError(null)
                }}
                className="flex-1 min-w-[120px] py-2.5 rounded-xl text-sm font-semibold bg-brand-500 hover:bg-brand-400 disabled:opacity-40 text-slate-950"
              >
                Send
              </button>
              <button
                type="button"
                onClick={() => setView('receive')}
                className="flex-1 min-w-[120px] py-2.5 rounded-xl text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200"
              >
                Receive
              </button>
              <button
                type="button"
                onClick={lockNow}
                className="py-2.5 px-3 rounded-xl text-sm font-semibold bg-slate-800 text-slate-400"
              >
                Lock
              </button>
              <button
                type="button"
                onClick={() => vault && loadBalance(vault.address)}
                className="p-2.5 rounded-xl bg-slate-800 text-slate-400"
                title="Refresh"
              >
                ↻
              </button>
            </div>
            {sendHash && (
              <p className="text-xs text-emerald-400 break-all">
                Submitted · {sendHash}
              </p>
            )}
          </div>
        )}

        {/* Receive (works locked or unlocked) */}
        {view === 'receive' && vault && (
          <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-center">
            <h2 className="text-sm font-semibold text-white">Receive</h2>
            <div className="inline-block bg-white p-3 rounded-xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(vault.address)}&size=180x180&margin=0`}
                alt="Vault address QR"
                width={180}
                height={180}
              />
            </div>
            <p className="text-xs font-mono text-slate-300 break-all">{vault.address}</p>
            <button
              type="button"
              className="text-xs text-brand-400"
              onClick={() => void navigator.clipboard.writeText(vault.address)}
            >
              Copy address
            </button>
            <button
              type="button"
              className="block w-full mt-2 py-2 rounded-xl text-sm bg-slate-800 text-slate-200"
              onClick={() => setView(loadVaultSession() ? 'unlocked' : 'locked')}
            >
              Back
            </button>
          </div>
        )}

        {/* Send form */}
        {view === 'send' && vault && (
          <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="text-sm font-semibold text-white">Send FALCON (cold sign)</h2>
            <p className="text-[11px] text-slate-400">
              This device builds an unsigned payment. Your cold signer signs it via multi-part QR.
            </p>
            <label className="block text-xs text-slate-400">
              Destination
              <div className="flex gap-2 mt-1">
                <input
                  value={dest}
                  onChange={(e) => setDest(e.target.value)}
                  placeholder="r…"
                  className="flex-1 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white font-mono"
                />
                <button
                  type="button"
                  onClick={() => setScanDest(true)}
                  className="px-3 rounded-lg bg-slate-800 text-slate-300 text-xs"
                >
                  Scan
                </button>
              </div>
            </label>
            <label className="block text-xs text-slate-400">
              Amount (FALCON)
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void buildUnsignedPayment()}
              className="w-full py-3 rounded-xl font-semibold bg-brand-500 hover:bg-brand-400 disabled:opacity-40 text-slate-950"
            >
              {busy ? 'Preparing…' : 'Prepare & show QR for cold signer'}
            </button>
            <button
              type="button"
              className="w-full text-xs text-slate-500"
              onClick={() => setView('unlocked')}
            >
              Cancel
            </button>
          </div>
        )}

        {view === 'send-unsigned' && unsignedEnc && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-2">
            <MultiQrDisplay
              encoded={unsignedEnc}
              title="Show unsigned tx to cold signer"
              hint="Cold: Sign transaction → scan these frames → confirm amount → show signed QR."
              onDone={() => setView('send-scan-signed')}
              doneLabel="Cold signed — scan result →"
            />
          </div>
        )}

        {view === 'send-scan-signed' && (
          <MultiQrScanner
            title="Scan signed transaction from cold"
            expectedCt="signed-tx"
            onComplete={(payload) => void onSignedPayload(payload)}
            onClose={() => setView('send')}
          />
        )}

        {scanDest && (
          <AddressQrScanner
            onScan={(raw) => {
              const addr = parseFalconAddressFromScan(raw)
              if (addr) setDest(addr)
              else setError('QR does not contain a valid Falcon address')
              setScanDest(false)
            }}
            onClose={() => setScanDest(false)}
          />
        )}

        <div className="mt-8 rounded-xl border border-slate-800/80 bg-slate-900/40 px-3 py-3 text-[11px] text-slate-500 leading-relaxed space-y-2">
          <p className="font-semibold text-slate-400">Cold signer setup</p>
          <p>
            <strong className="text-slate-300">Path A:</strong> On a dedicated phone, open{' '}
            <a href="/cold-signer/" className="text-cyan-500 underline">
              /cold-signer/
            </a>
            , install the PWA, then enable airplane mode. The app refuses to unlock or sign while online.
          </p>
          <p>
            <strong className="text-slate-300">Path B:</strong> Copy the built cold-signer package + this vault JSON
            onto SD/USB and load offline only.
          </p>
          <p>Never re-import the vault secret into this browser after create.</p>
        </div>
      </main>
    </div>
  )
}
