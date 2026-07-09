'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'

import Header from '@/components/Header'
import NetworkBanner from '@/components/NetworkBanner'
import { useNetwork } from '@/components/NetworkProvider'
import { withNetworkQuery } from '@/lib/network-query'
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
  keysFromFalconSecret,
  validateFalconSecret,
  signPayment,
  signFusdcPayment,
  qxrpToDrops,
} from '@/lib/wallet-sign-client'
import { submitWithSequenceRetry, fetchSequenceInfo, type SubmitResult } from '@/lib/wallet-submit'
import {
  createEncryptedBackup,
  decryptBackupFile,
  downloadBackup,
  parseBackupFile,
  shareBackup,
  validateBackupPassphrase,
} from '@/lib/wallet-backup'
import {
  loadValidatorNode,
  saveValidatorNode,
  clearValidatorNode,
  dashboardUrl,
  type SavedValidatorNode,
} from '@/lib/validator-node-store'
import { isValidFalconAddress, parseFalconAddressFromScan } from '@/lib/parse-falcon-address'
import { createEvmWalletForPasskey } from '@/lib/create-evm-wallet'
import { type UsdcBridgeManifest } from '@/lib/bridge-config'
import BridgeDepositPanel from '@/components/BridgeDepositPanel'
import WalletLendSummary from '@/components/WalletLendSummary'

const AddressQrScanner = dynamic(() => import('@/components/AddressQrScanner'), { ssr: false })

// ─── Types ────────────────────────────────────────────────────────────────────

interface TxRecord {
  hash:         string
  type:         string
  amount?:      string
  amountAsset?: 'FALCON' | 'F-USDC'
  destination?: string
  account:      string
  result:       string
  date?:        number
}

interface WalletAssets {
  fusdc: {
    symbol: string
    balance: number
    currency: string
    issuer: string
    hasTrustLine?: boolean
  }
  lp: {
    symbol: string
    balance: number
    currency: string
    issuer: string
    sharePct: number
    estXrpOut: number
    estUsdcOut: number
  }
}

interface AccountData {
  balance:      number
  sequence:     number
  exists:       boolean
  transactions: TxRecord[]
  currentLedger: number
  assets?:      WalletAssets
}

type View = 'loading' | 'no-wallet' | 'restore' | 'backup' | 'dashboard' | 'send' | 'receive' | 'node'

interface PendingWalletSave {
  credentialId: string
  address:      string
  publicKey:    string
  label:        string
  encrypted:    StoredWallet['encrypted']
  hasPrf:       boolean
  falcon_secret: string
  evmAddress?: string
  evmEncrypted?: StoredWallet['evmEncrypted']
}

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

interface NodeBondStats {
  status?: string
  bonded_amount_qxrp?: number | null
  composite_score?: number | null
  reward_accum_qxrp?: number | null
  uptime_score?: number | null
  vote_accuracy_score?: number | null
  slash_multiplier?: number | null
}

interface NodeStatsPayload {
  updated_at?: string
  node?: {
    validator_account?: string | null
    validation_pubkey?: string | null
    server_state?: string
    peers?: number
    complete_ledgers?: string
    ledger_seq?: number
    ledger_hash?: string
    ledger_lag?: number | null
    load_factor?: number
    uptime_seconds?: number
    network_id?: number
    build_version?: string
    balance_qxrp?: number | null
    bond?: NodeBondStats | null
  }
  network?: {
    rpc?: string
    server_state?: string
    ledger_seq?: number
    complete_ledgers?: string
    peers?: number
    load_factor?: number
    bonded_validator_count?: number
    total_validator_entries?: number
    validators?: Array<{
      account?: string
      bond_status?: string
      bonded_amount_qxrp?: number | null
      composite_score?: number | null
      reward_accum_qxrp?: number | null
    }>
    epoch?: {
      epoch_number?: number
      emission_rate_qxrp?: number | null
      epoch_pool_balance_qxrp?: number | null
    }
  }
}

function fmtStat(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function MetricTile({
  label, value, sub, tone = '',
}: {
  label: string
  value: string
  sub?: string
  tone?: 'good' | 'warn' | 'bad' | ''
}) {
  const toneClass = tone === 'good'
    ? 'text-emerald-400'
    : tone === 'warn'
      ? 'text-amber-400'
      : tone === 'bad'
        ? 'text-red-400'
        : 'text-white'
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
      <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-lg font-bold ${toneClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-600 font-mono mt-0.5 truncate" title={sub}>{sub}</div>}
    </div>
  )
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
  const { networkKey, network } = useNetwork()
  const [view,    setView]    = useState<View>('loading')
  const [wallet,  setWallet]  = useState<StoredWallet | null>(null)
  const [account, setAccount] = useState<AccountData | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [busy,    setBusy]    = useState(false)
  const [copied,  setCopied]  = useState(false)
  const [nodeName, setNodeName] = useState('my-falcon-node')
  const [savedNode, setSavedNode] = useState<SavedValidatorNode | null>(null)
  const [nodeHostInput, setNodeHostInput] = useState('')
  const [nodeStats, setNodeStats] = useState<NodeStatsPayload | null>(null)
  const [nodeStatsError, setNodeStatsError] = useState<string | null>(null)
  const [nodeStatsLoading, setNodeStatsLoading] = useState(false)
  const [showNodeSetup, setShowNodeSetup] = useState(false)
  const [bridgeCfg, setBridgeCfg] = useState<(UsdcBridgeManifest & { lock_contract_ready?: boolean }) | null>(null)
  const [walletSection, setWalletSection] = useState<'falcon' | 'bridge'>('falcon')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('bridge') === '1' || params.get('section') === 'bridge') {
      setWalletSection('bridge')
    }
  }, [])

  // Create-wallet form
  const [createLabel, setCreateLabel] = useState('')

  // Send form
  const [sendAsset,  setSendAsset]  = useState<'falcon' | 'fusdc'>('falcon')
  const [sendTo,     setSendTo]     = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sendResult, setSendResult] = useState<{
    success: boolean; hash?: string; message: string
  } | null>(null)
  const [showSendScanner, setShowSendScanner] = useState(false)

  // Restore form
  const [restoreSeed,  setRestoreSeed]  = useState('')
  const [restoreLabel, setRestoreLabel] = useState('')

  // Backup gate (shown once after create, before IndexedDB write)
  const [pendingSave,        setPendingSave]        = useState<PendingWalletSave | null>(null)
  const [backupPassphrase,   setBackupPassphrase]   = useState('')
  const [backupPassConfirm,  setBackupPassConfirm]  = useState('')
  const [backupDownloaded,   setBackupDownloaded]   = useState(false)
  const [backupAcknowledged, setBackupAcknowledged] = useState(false)
  // F-01: explicit, non-dismissable acknowledgment required before saving a
  // wallet that fell back to weaker (non-PRF) at-rest encryption.
  const [weakEncryptionAck,  setWeakEncryptionAck]  = useState(false)
  const [showRawSecret,      setShowRawSecret]      = useState(false)
  const [secretCopied,       setSecretCopied]       = useState(false)

  // Restore from file
  const [restorePassphrase,  setRestorePassphrase]  = useState('')
  const [showManualRestore,  setShowManualRestore]  = useState(false)
  const restoreFileRef = useRef<HTMLInputElement>(null)

  // Re-export backup from dashboard
  const [exportPassphrase,   setExportPassphrase]   = useState('')
  const [exportPassConfirm,  setExportPassConfirm]  = useState('')
  const [showExportBackup,   setShowExportBackup]   = useState(false)

  // ── Fetch account balance ─────────────────────────────────────────────────

  const refreshBalance = useCallback(async (address: string) => {
    try {
      const [accR, assetsR] = await Promise.all([
        fetch(withNetworkQuery(`/api/wallet/account?address=${encodeURIComponent(address)}`, networkKey)),
        fetch(withNetworkQuery(`/api/wallet/assets?address=${encodeURIComponent(address)}`, networkKey)),
      ])
      if (!accR.ok) return
      const data: AccountData = await accR.json()
      if (assetsR.ok) {
        const assetsData = await assetsR.json()
        if (assetsData.assets) data.assets = assetsData.assets
      }
      setAccount(data)
    } catch { /* non-fatal */ }
  }, [networkKey])

  useEffect(() => {
    if (wallet?.address) {
      refreshBalance(wallet.address)
    }
  }, [networkKey, wallet?.address, refreshBalance])

  useEffect(() => {
    if (!wallet || view === 'loading' || view === 'no-wallet') return
    fetch('/api/bridge/config')
      .then((r) => r.json())
      .then((j) => { if (!j.error) setBridgeCfg(j) })
      .catch(() => {})
  }, [wallet, view])

  // ── On mount: load wallet from IndexedDB ──────────────────────────────────

  const refreshNodeStats = useCallback(async (host: string) => {
    setNodeStatsLoading(true)
    setNodeStatsError(null)
    try {
      const r = await fetch(`/api/node-dashboard?host=${encodeURIComponent(host)}`)
      const data = await r.json()
      if (!r.ok) {
        throw new Error(data.error || data.hint || 'Dashboard unreachable')
      }
      setNodeStats(data as NodeStatsPayload)
    } catch (e: unknown) {
      setNodeStats(null)
      setNodeStatsError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setNodeStatsLoading(false)
    }
  }, [])

  const handleLinkValidatorNode = () => {
    const host = nodeHostInput.trim()
    if (!host) {
      setError('Enter your server public IP or hostname')
      return
    }
    const saved = saveValidatorNode(host, nodeName)
    setSavedNode(saved)
    setShowNodeSetup(false)
    setError(null)
    void refreshNodeStats(saved.host)
  }

  const handleUnlinkValidatorNode = () => {
    clearValidatorNode()
    setSavedNode(null)
    setNodeStats(null)
    setNodeStatsError(null)
    setShowNodeSetup(true)
    setNodeHostInput('')
  }

  useEffect(() => {
    const linked = loadValidatorNode()
    if (linked) {
      setSavedNode(linked)
      setNodeName(linked.nodeName)
      setNodeHostInput(linked.host)
    }
  }, [])

  useEffect(() => {
    if (view === 'node' && savedNode && !showNodeSetup) {
      refreshNodeStats(savedNode.host)
      const id = setInterval(() => refreshNodeStats(savedNode.host), 15000)
      return () => clearInterval(id)
    }
  }, [view, savedNode, showNodeSetup, refreshNodeStats])

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
    setBackupPassphrase('')
    setBackupPassConfirm('')
    setBackupDownloaded(false)
    setBackupAcknowledged(false)
    setWeakEncryptionAck(false)
    setShowRawSecret(false)
    setSecretCopied(false)
    try {
      const label = createLabel.trim() || 'My Falcon Wallet'

      const { falcon_secret, address, publicKey } = await generateWallet()
      const { credentialId, keyBytes, hasPrf } = await registerPasskey(label)
      const encrypted = await encryptSeed(falcon_secret, keyBytes, hasPrf)
      const evm = await createEvmWalletForPasskey(keyBytes, hasPrf)

      // Hold in memory until user confirms backup — not written to IndexedDB yet
      setPendingSave({
        credentialId,
        address,
        publicKey,
        label,
        encrypted,
        hasPrf,
        falcon_secret,
        evmAddress: evm.address,
        evmEncrypted: evm.evmEncrypted,
      })
      setView('backup')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Wallet creation failed')
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmBackup = async () => {
    if (!pendingSave || !backupDownloaded || !backupAcknowledged) return
    // F-01: a non-PRF (weaker-encryption) wallet may only be saved after the
    // user explicitly acknowledges the reduced protection.
    if (!pendingSave.hasPrf && !weakEncryptionAck) return
    setBusy(true)
    setError(null)
    try {
      const { falcon_secret: _secret, ...rest } = pendingSave
      const stored: StoredWallet = {
        ...rest,
        createdAt: Date.now(),
        evmAddress: pendingSave.evmAddress,
        evmEncrypted: pendingSave.evmEncrypted,
      }
      await saveWallet(stored)
      setWallet(stored)
      setPendingSave(null)
      setBackupPassphrase('')
      setBackupPassConfirm('')
      setBackupDownloaded(false)
      setBackupAcknowledged(false)
      setWeakEncryptionAck(false)
      setView('dashboard')
      refreshBalance(stored.address)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save wallet')
    } finally {
      setBusy(false)
    }
  }

  const handleCancelBackup = () => {
    setPendingSave(null)
    setBackupPassphrase('')
    setBackupPassConfirm('')
    setBackupDownloaded(false)
    setBackupAcknowledged(false)
    setWeakEncryptionAck(false)
    setShowRawSecret(false)
    setSecretCopied(false)
    setView('no-wallet')
    setError('Wallet not saved. Create again when ready — your passkey was registered but this wallet was discarded.')
  }

  const downloadPendingBackup = async () => {
    if (!pendingSave) return
    const passErr = validateBackupPassphrase(backupPassphrase)
    if (passErr) { setError(passErr); return }
    if (backupPassphrase !== backupPassConfirm) {
      setError('Backup passwords do not match')
      return
    }
    setError(null)
    try {
      const file = await createEncryptedBackup({
        falcon_secret: pendingSave.falcon_secret,
        address: pendingSave.address,
        publicKey: pendingSave.publicKey,
        label: pendingSave.label,
        createdAt: Date.now(),
      }, backupPassphrase)
      downloadBackup(file)
      setBackupDownloaded(true)
      // On mobile, offer native save-to-files if available
      void shareBackup(file).catch(() => {})
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create backup file')
    }
  }

  const copyFalconSecret = async () => {
    if (!pendingSave) return
    const secret = pendingSave.falcon_secret
    await navigator.clipboard.writeText(secret)
    setSecretCopied(true)
    setTimeout(() => setSecretCopied(false), 2200)
    // Auto-clear the clipboard after a short window so the secret does not
    // linger where other apps / clipboard managers could read it.
    setTimeout(() => {
      navigator.clipboard.readText()
        .then(current => {
          if (current === secret) return navigator.clipboard.writeText('')
        })
        .catch(() => { /* clipboard read may be blocked — best effort only */ })
    }, 30_000)
  }

  const finishRestore = async (falconSecret: string, label: string) => {
    if (!isPasskeySupported()) {
      setError('Passkeys need a secure context (HTTPS or localhost).')
      return
    }
    if (!validateFalconSecret(falconSecret)) {
      setError('Invalid Falcon secret in backup')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const { address, publicKey } = await keysFromFalconSecret(falconSecret)
      const walletLabel = label.trim() || 'Restored Wallet'
      const { credentialId, keyBytes, hasPrf } = await registerPasskey(walletLabel)
      const encrypted = await encryptSeed(falconSecret, keyBytes, hasPrf)
      const evm = await createEvmWalletForPasskey(keyBytes, hasPrf)

      const stored: StoredWallet = {
        credentialId,
        address,
        publicKey,
        label: walletLabel,
        encrypted,
        hasPrf,
        createdAt: Date.now(),
        evmAddress: evm.address,
        evmEncrypted: evm.evmEncrypted,
      }
      await saveWallet(stored)

      setWallet(stored)
      setRestoreSeed('')
      setRestorePassphrase('')
      setView('dashboard')
      refreshBalance(address)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Restore failed')
    } finally {
      setBusy(false)
    }
  }

  const handleRestore = async () => {
    const falconSecret = restoreSeed.trim()
    if (!falconSecret) { setError('Upload a backup file or paste your Falcon secret'); return }
    await finishRestore(falconSecret, restoreLabel)
  }

  const handleRestoreFile = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const parsed = parseBackupFile(JSON.parse(await file.text()))
      // Only passphrase-encrypted backups are accepted (see wallet-backup.ts, F-04).
      if (!restorePassphrase) {
        setError('Enter the backup password for this file')
        return
      }
      const payload = await decryptBackupFile(parsed, restorePassphrase)
      await finishRestore(payload.falcon_secret, payload.label || restoreLabel)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not read backup file')
    } finally {
      setBusy(false)
      if (restoreFileRef.current) restoreFileRef.current.value = ''
    }
  }

  const handleExportBackup = async () => {
    if (!wallet) return
    const passErr = validateBackupPassphrase(exportPassphrase)
    if (passErr) { setError(passErr); return }
    if (exportPassphrase !== exportPassConfirm) {
      setError('Backup passwords do not match')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)
      const file = await createEncryptedBackup({
        falcon_secret,
        address: wallet.address,
        publicKey: wallet.publicKey,
        label: wallet.label,
        createdAt: wallet.createdAt,
      }, exportPassphrase)
      downloadBackup(file)
      setShowExportBackup(false)
      setExportPassphrase('')
      setExportPassConfirm('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  // ── Send transaction ──────────────────────────────────────────────────────

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!wallet || !account) return
    if (!network.live) {
      setError(`${network.name} is not live yet.`)
      return
    }

    const to = sendTo.trim()
    const amt = parseFloat(sendAmount)
    const fusdc = account.assets?.fusdc
    const fusdcBal = fusdc?.balance ?? 0

    if (!isValidFalconAddress(to)) {
      setError('Invalid destination address'); return
    }
    if (to === wallet.address) {
      setError('Destination must be a different Falcon address'); return
    }
    if (isNaN(amt) || amt <= 0) {
      setError('Invalid amount'); return
    }
    if (sendAsset === 'falcon') {
      if (amt > account.balance) {
        setError('Insufficient FALCON balance'); return
      }
    } else {
      if (!fusdc?.issuer || fusdc.hasTrustLine === false) {
        setError('Add a F-USDC trust line on Swap before sending'); return
      }
      if (amt > fusdcBal) {
        setError('Insufficient F-USDC balance'); return
      }
    }

    setBusy(true)
    setError(null)
    setSendResult(null)

    try {
      // 1. Authenticate — triggers biometric/PIN prompt
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)

      // 2. Decrypt falcon_secret locally. Signing happens in-browser via WASM —
      //    the secret is never sent to any server.
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)

      // 3. Fetch fresh sequence + ledger index just before signing, and re-sign +
      //    resubmit automatically if the ledger reports a sequence race (tefPAST_SEQ).
      const fetchSequence = async () => {
        try {
          const a = await fetchSequenceInfo(wallet.address, networkKey)
          return { sequence: a.sequence, currentLedger: a.currentLedger }
        } catch {
          // Fall back to the cached account snapshot if the node is briefly unreachable.
          return { sequence: account.sequence, currentLedger: account.currentLedger }
        }
      }

      const data = await submitWithSequenceRetry({
        networkKey,
        fetchSequence,
        sign: ({ sequence, lastLedgerSequence }) =>
          sendAsset === 'falcon'
            ? signPayment(
                {
                  account:            wallet.address,
                  destination:        to,
                  amountDrops:        qxrpToDrops(amt),
                  sequence,
                  lastLedgerSequence,
                  networkId:          network.networkId,
                },
                falcon_secret,
              )
            : signFusdcPayment(
                {
                  account:            wallet.address,
                  destination:        to,
                  issuer:             fusdc!.issuer,
                  currency:           fusdc!.currency,
                  amount:             String(amt),
                  sequence,
                  lastLedgerSequence,
                  networkId:          network.networkId,
                },
                falcon_secret,
              ),
      }).catch((e: unknown): SubmitResult => ({
        success: false,
        message: e instanceof Error ? e.message : 'Failed',
      }))

      setSendResult({
        success: !!data.success,
        hash:    data.hash,
        message: data.message ?? data.result ?? (data.success ? 'Submitted!' : 'Failed'),
      })

      if (data.success) {
        setSendTo('')
        setSendAmount('')
        // Refresh balance immediately then again after confirmation
        refreshBalance(wallet.address)
        setTimeout(() => refreshBalance(wallet.address), 4000)
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

  // Backup gate: a wallet may only be saved once the encrypted backup is
  // downloaded and acknowledged; non-PRF (weaker-encryption) wallets also
  // require the explicit weak-encryption acknowledgment (F-01).
  const canConfirmBackup =
    !busy &&
    backupDownloaded &&
    backupAcknowledged &&
    (!!pendingSave?.hasPrf || weakEncryptionAck)

  return (
    <div className="min-h-screen flex flex-col">

      <Header current="wallet" />
      <NetworkBanner />

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
                  Falcon <span className="text-brand-500">Wallet</span>
                </h1>
                <p className="text-slate-400 text-sm">
                  One passkey creates both your Falcon ledger wallet and Sepolia bridge wallet on this device.
                </p>
              </div>

              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 leading-snug">
                <span className="font-semibold">Stay in this browser tab.</span>{' '}
                Wallet data is stored locally in this browser only. Installing the PWA or opening a different URL will look like a fresh wallet — restore with your saved Falcon secret if that happens.
              </div>

              <div className="card p-6 space-y-4">
                <div className="flex items-start gap-3 text-sm text-slate-400 bg-slate-800/50 rounded-xl px-4 py-3">
                  <svg className="w-5 h-5 text-brand-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                  <span>
                    Your passkey (Face ID, fingerprint, or PIN) encrypts the wallet on this device.
                    Signing runs in-browser — your Falcon secret is never sent to a server.
                    You must back up the secret shown after creation; the app cannot recover it.
                  </span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Wallet name <span className="text-slate-600">(optional)</span></label>
                  <input
                    type="text"
                    value={createLabel}
                    onChange={e => setCreateLabel(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !busy && handleCreate()}
                    placeholder="My Falcon Wallet"
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
                    Restore from backup file →
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── Backup gate (required before first save) ── */}
          {view === 'backup' && pendingSave && (
            <>
              <div className="text-center space-y-2 pb-1">
                <h2 className="text-xl font-bold text-white">Save your wallet backup</h2>
                <p className="text-slate-400 text-sm">
                  Falcon + Sepolia bridge wallets are ready. Download an encrypted Falcon backup — back up the bridge key from the Wallet tab later.
                </p>
              </div>

              <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                Save the backup file to iCloud Drive, Google Drive, or your password manager. You will need this file and your backup password to restore.
              </div>

              {!pendingSave.hasPrf && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 space-y-3">
                  <p>
                    <strong>Weaker device encryption:</strong> this device/browser does not support the passkey PRF extension, so the wallet on this device is encrypted with lower-strength key material. Keep your encrypted backup file safe and do not store significant value on this wallet.
                  </p>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={weakEncryptionAck}
                      onChange={e => setWeakEncryptionAck(e.target.checked)}
                      className="mt-1 rounded border-amber-500/60"
                    />
                    <span>I understand this device uses weaker encryption and I will not store significant value on this wallet.</span>
                  </label>
                </div>
              )}

              <div className="card p-5 space-y-4">
                <div className="space-y-1">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide">Address</div>
                  <div className="font-mono text-xs text-emerald-300 break-all">{pendingSave.address}</div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Backup password <span className="text-slate-600">(min 12 chars, mix of cases/numbers/symbols — not your passkey)</span></label>
                  <input
                    type="password"
                    value={backupPassphrase}
                    onChange={e => setBackupPassphrase(e.target.value)}
                    placeholder="Choose a backup password"
                    className="input-field"
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Confirm backup password</label>
                  <input
                    type="password"
                    value={backupPassConfirm}
                    onChange={e => setBackupPassConfirm(e.target.value)}
                    placeholder="Repeat backup password"
                    className="input-field"
                    autoComplete="new-password"
                  />
                </div>

                <button
                  type="button"
                  onClick={downloadPendingBackup}
                  disabled={!backupPassphrase || !backupPassConfirm}
                  className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition disabled:opacity-50"
                >
                  {backupDownloaded ? 'Download again ✓' : 'Download encrypted backup file'}
                </button>
                {backupDownloaded && (
                  <p className="text-xs text-emerald-400 text-center">Backup file downloaded — store it somewhere safe</p>
                )}

                <button
                  type="button"
                  onClick={() => setShowRawSecret(v => !v)}
                  className="text-xs text-slate-600 hover:text-slate-400 transition-colors w-full text-center"
                >
                  {showRawSecret ? 'Hide raw hex' : 'Advanced: show raw hex'}
                </button>
                {showRawSecret && (
                  <div className="space-y-1.5">
                    <textarea
                      readOnly
                      value={pendingSave.falcon_secret}
                      rows={3}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-[10px] text-emerald-300 font-mono leading-snug resize-none"
                    />
                    <button
                      type="button"
                      onClick={copyFalconSecret}
                      className="w-full py-2 text-xs rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200"
                    >
                      {secretCopied ? 'Copied ✓' : 'Copy raw hex'}
                    </button>
                  </div>
                )}

                <label className="flex items-start gap-2.5 text-sm text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={backupAcknowledged}
                    onChange={e => setBackupAcknowledged(e.target.checked)}
                    className="mt-1 rounded border-slate-600"
                  />
                  <span>I saved the backup file and remember my backup password</span>
                </label>

                <button
                  onClick={handleConfirmBackup}
                  disabled={!canConfirmBackup}
                  className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {busy ? <><Spinner /> Saving wallet…</> : 'Continue to wallet'}
                </button>

                <button
                  type="button"
                  onClick={handleCancelBackup}
                  disabled={busy}
                  className="w-full text-xs text-slate-600 hover:text-red-400 transition-colors py-1"
                >
                  Cancel (wallet will not be saved)
                </button>
              </div>
            </>
          )}

          {/* ── Restore from Falcon secret ── */}
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

              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 leading-snug">
                Upload your <span className="font-mono">falcon-backup-….json</span> file from iCloud Drive, Google Drive, or downloads.
              </div>

              <div className="card p-6 space-y-4">
                <input
                  ref={restoreFileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) handleRestoreFile(file)
                  }}
                />

                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Backup password</label>
                  <input
                    type="password"
                    value={restorePassphrase}
                    onChange={e => setRestorePassphrase(e.target.value)}
                    placeholder="Password you set when downloading backup"
                    className="input-field"
                    autoComplete="current-password"
                    disabled={busy}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => restoreFileRef.current?.click()}
                  disabled={busy || !restorePassphrase}
                  className="btn-primary flex items-center justify-center gap-2 w-full"
                >
                  {busy ? <><Spinner /> Restoring…</> : 'Upload backup file'}
                </button>

                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Wallet name <span className="text-slate-600">(optional override)</span></label>
                  <input
                    type="text"
                    value={restoreLabel}
                    onChange={e => setRestoreLabel(e.target.value)}
                    placeholder="Uses name from backup file if empty"
                    className="input-field"
                    disabled={busy}
                    maxLength={40}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setShowManualRestore(v => !v)}
                  className="text-xs text-slate-600 hover:text-slate-400 transition-colors w-full text-center"
                >
                  {showManualRestore ? 'Hide manual hex entry' : 'Advanced: paste raw hex instead'}
                </button>

                {showManualRestore && (
                  <>
                    <textarea
                      value={restoreSeed}
                      onChange={e => setRestoreSeed(e.target.value)}
                      placeholder="fb… (4,000+ characters)"
                      rows={3}
                      className="input-field font-mono text-xs resize-none"
                      disabled={busy}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      onClick={handleRestore}
                      disabled={busy || !restoreSeed.trim()}
                      className="w-full py-2 text-sm rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800"
                    >
                      Restore from pasted hex
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          {/* ── Dashboard / Send / Receive ── */}
          {(view === 'dashboard' || view === 'send' || view === 'receive' || view === 'node') && wallet && (
            <>
              {view === 'dashboard' && (
                <div className="flex rounded-xl overflow-hidden border border-slate-700 text-sm">
                  <button
                    type="button"
                    onClick={() => setWalletSection('falcon')}
                    className={`flex-1 py-2.5 font-medium ${walletSection === 'falcon' ? 'bg-brand-500/10 text-brand-400' : 'text-slate-500'}`}
                  >
                    My Falcon Wallet
                  </button>
                  <button
                    type="button"
                    onClick={() => setWalletSection('bridge')}
                    className={`flex-1 py-2.5 font-medium ${walletSection === 'bridge' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-500'}`}
                  >
                    My Bridge Wallet
                  </button>
                </div>
              )}

              {view === 'dashboard' && walletSection === 'falcon' && (
              <div className="card p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-slate-500 mb-0.5">{wallet.label} · Falcon</div>
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

                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-slate-500 mb-1">FALCON</div>
                    {account === null ? (
                      <div className="text-2xl font-bold text-slate-600">—</div>
                    ) : !account.exists ? (
                      <div>
                        <div className="text-2xl font-bold text-slate-600">0</div>
                        <div className="text-xs text-slate-600 mt-1">Account not yet activated — fund it first</div>
                      </div>
                    ) : (
                      <div className="text-3xl font-bold text-white">
                        {account.balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                      </div>
                    )}
                  </div>

                  {account?.exists && (
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="bg-slate-800/60 rounded-xl px-3 py-2.5">
                        <div className="text-xs text-slate-500">F-USDC</div>
                        <div className="font-mono text-slate-100 mt-0.5">
                          {(account.assets?.fusdc?.balance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </div>
                        <div className="text-[10px] text-slate-600 mt-0.5">
                          {account.assets?.fusdc?.hasTrustLine === false
                            ? <Link href="/swap" className="text-brand-400">Add trust line →</Link>
                            : 'Bridged F-USDC'}
                        </div>
                      </div>
                      <div className="bg-slate-800/60 rounded-xl px-3 py-2.5">
                        <div className="text-xs text-slate-500">LP tokens</div>
                        <div className="font-mono text-slate-100 mt-0.5">
                          {(account.assets?.lp?.balance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </div>
                        {(account.assets?.lp?.balance ?? 0) > 0 ? (
                          <div className="text-[10px] text-slate-600 mt-0.5">
                            ~{account.assets!.lp.estXrpOut.toFixed(2)} FALCON + {account.assets!.lp.estUsdcOut.toFixed(2)} F-USDC
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-600 mt-0.5">
                            <Link href="/pool" className="text-brand-400 hover:text-brand-300">Add on Pool →</Link>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {account?.exists && <WalletLendSummary address={wallet.address} />}

                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => { setView('send'); setSendAsset('falcon'); setError(null); setSendResult(null) }}
                    disabled={!account?.exists || !network.live}
                    className="flex-1 min-w-[120px] py-2.5 rounded-xl text-sm font-semibold bg-brand-500 hover:bg-brand-400 disabled:opacity-40 text-slate-950"
                  >
                    Send
                  </button>
                  <button
                    onClick={() => setView('receive')}
                    className="flex-1 min-w-[120px] py-2.5 rounded-xl text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200"
                  >
                    Receive
                  </button>
                  <button
                    type="button"
                    onClick={() => setWalletSection('bridge')}
                    className="flex-1 min-w-[120px] py-2.5 rounded-xl text-sm font-semibold bg-emerald-950/50 hover:bg-emerald-900/40 text-emerald-300 border border-emerald-500/25"
                  >
                    Bridge →
                  </button>
                  <button
                    onClick={() => {
                      setShowNodeSetup(!savedNode)
                      setView('node')
                    }}
                    className={`py-2.5 px-3 rounded-xl text-sm font-semibold ${
                      savedNode
                        ? 'bg-cyan-950/60 text-cyan-300 border border-cyan-500/30'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                    title="Validator node"
                  >
                    Node
                  </button>
                  <button
                    onClick={() => refreshBalance(wallet.address)}
                    className="p-2.5 rounded-xl bg-slate-800 text-slate-400"
                    title="Refresh"
                  >
                    ↻
                  </button>
                </div>
              </div>
              )}

              {view === 'dashboard' && walletSection === 'bridge' && bridgeCfg && (
                <BridgeDepositPanel
                  wallet={wallet}
                  bridgeCfg={bridgeCfg}
                  fusdcBalance={account?.assets?.fusdc?.balance ?? null}
                  onWalletUpdate={setWallet}
                  onFalconRefresh={() => refreshBalance(wallet.address)}
                />
              )}

              {view === 'dashboard' && walletSection === 'bridge' && !bridgeCfg && (
                <div className="card p-4 text-sm text-slate-500">Loading bridge config…</div>
              )}

              {/* ── Receive panel ── */}
              {view === 'receive' && (
                <div className="card p-5 space-y-4">
                  <h3 className="font-semibold text-white text-sm">Receive FALCON</h3>
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

              {showSendScanner && (
                <AddressQrScanner
                  onScan={(raw) => {
                    const addr = parseFalconAddressFromScan(raw)
                    setShowSendScanner(false)
                    if (!addr) {
                      setError('QR code does not contain a valid Falcon r-address')
                      return
                    }
                    setSendTo(addr)
                    setError(null)
                  }}
                  onClose={() => setShowSendScanner(false)}
                />
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
                    <h3 className="font-semibold text-white text-sm">Send on Falcon</h3>
                  </div>

                  <div className="flex rounded-xl overflow-hidden border border-slate-700 text-sm">
                    <button
                      type="button"
                      onClick={() => { setSendAsset('falcon'); setSendAmount(''); setError(null) }}
                      className={`flex-1 py-2 ${sendAsset === 'falcon' ? 'bg-brand-500/10 text-brand-400' : 'text-slate-500'}`}
                    >
                      FALCON
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSendAsset('fusdc'); setSendAmount(''); setError(null) }}
                      className={`flex-1 py-2 ${sendAsset === 'fusdc' ? 'bg-amber-500/10 text-amber-400' : 'text-slate-500'}`}
                    >
                      F-USDC
                    </button>
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
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={sendTo}
                            onChange={e => { setSendTo(e.target.value); setError(null) }}
                            placeholder="rXXX…"
                            className="input-field flex-1 min-w-0"
                            disabled={busy}
                            autoComplete="off"
                            spellCheck={false}
                          />
                          <button
                            type="button"
                            onClick={() => { setShowSendScanner(true); setError(null) }}
                            disabled={busy}
                            className="shrink-0 px-3 rounded-xl border border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-40 transition-colors"
                            title="Scan QR code"
                            aria-label="Scan QR code"
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                                d="M4 7V4h3M4 17v3h3M17 4h3v3M20 17v3h-3M7 7h3v3H7zm0 7h3v3H7zm7-7h3v3h-3zm0 7h3v3h-3z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs text-slate-400">
                          Amount ({sendAsset === 'falcon' ? 'FALCON' : 'F-USDC'})
                        </label>
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
                        {account?.exists && sendAsset === 'falcon' && (
                          <div className="flex justify-between text-xs text-slate-600">
                            <span>Available: {account.balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} FALCON</span>
                            <button
                              type="button"
                              onClick={() => setSendAmount(String(Math.max(0, account.balance - 0.000012)))}
                              className="text-brand-500 hover:text-brand-400 transition-colors"
                            >
                              Max
                            </button>
                          </div>
                        )}
                        {account?.exists && sendAsset === 'fusdc' && (
                          <div className="flex justify-between text-xs text-slate-600">
                            <span>
                              Available: {(account.assets?.fusdc?.balance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} F-USDC
                            </span>
                            {(account.assets?.fusdc?.balance ?? 0) > 0 && (
                              <button
                                type="button"
                                onClick={() => setSendAmount(String(account.assets!.fusdc.balance))}
                                className="text-brand-500 hover:text-brand-400 transition-colors"
                              >
                                Max
                              </button>
                            )}
                          </div>
                        )}
                        {sendAsset === 'fusdc' && account?.assets?.fusdc?.hasTrustLine === false && (
                          <p className="text-xs text-amber-400">
                            Recipient and sender both need a F-USDC trust line. Add yours on{' '}
                            <Link href="/swap" className="text-brand-400 underline">Swap</Link>.
                          </p>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        Peer-to-peer transfer on Falcon Ledger — not a bridge. Recipient needs a F-USDC trust line to receive F-USDC.
                      </p>
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

              {/* ── Node panel: setup one-liner OR linked dashboard ── */}
              {view === 'node' && (
                <div className="card p-5 space-y-4">
                  {savedNode && !showNodeSetup ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                            <h3 className="font-semibold text-white text-sm">Validator Dashboard</h3>
                          </div>
                          <p className="text-xs text-slate-500 mt-1">
                            {savedNode.nodeName} · <span className="font-mono text-slate-400">{savedNode.host}</span>
                          </p>
                        </div>
                        <div className="flex gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => savedNode && refreshNodeStats(savedNode.host)}
                            disabled={nodeStatsLoading}
                            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 disabled:opacity-50"
                            title="Refresh now"
                          >
                            {nodeStatsLoading ? <Spinner className="w-4 h-4" /> : (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            )}
                          </button>
                          <button
                            onClick={() => setShowNodeSetup(true)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-400"
                          >
                            Setup
                          </button>
                        </div>
                      </div>

                      <a
                        href={dashboardUrl(savedNode.host)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-center py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold transition"
                      >
                        Open full dashboard → {dashboardUrl(savedNode.host)}
                      </a>

                      {nodeStatsError && (
                        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                          {nodeStatsError}
                          <p className="text-[10px] text-red-400/80 mt-1">Ensure bootstrap finished and TCP 8080 is open on your server.</p>
                        </div>
                      )}

                      {nodeStats?.node && (
                        <>
                          <div className="space-y-2">
                            <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">Your node</div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              <MetricTile
                                label="Server state"
                                value={nodeStats.node.server_state || '—'}
                                tone={nodeStats.node.server_state === 'proposing' ? 'good' : 'warn'}
                                sub={(nodeStats.node.validation_pubkey || '').slice(0, 20) + '…'}
                              />
                              <MetricTile
                                label="Ledger"
                                value={`#${fmtStat(nodeStats.node.ledger_seq)}`}
                                tone="good"
                                sub={(nodeStats.node.ledger_hash || '').slice(0, 16) + '…'}
                              />
                              <MetricTile
                                label="Sync lag"
                                value={nodeStats.node.ledger_lag != null ? `${nodeStats.node.ledger_lag} ledgers` : '—'}
                                tone={nodeStats.node.ledger_lag != null && nodeStats.node.ledger_lag <= 5 ? 'good' : 'warn'}
                                sub={nodeStats.node.complete_ledgers}
                              />
                              <MetricTile
                                label="Peers"
                                value={fmtStat(nodeStats.node.peers)}
                                tone={(nodeStats.node.peers ?? 0) >= 3 ? 'good' : 'warn'}
                              />
                              <MetricTile
                                label="Bond"
                                value={nodeStats.node.bond?.status || '—'}
                                tone={nodeStats.node.bond?.status === 'bonded' ? 'good' : 'warn'}
                                sub={`${fmtStat(nodeStats.node.bond?.bonded_amount_qxrp, 2)} FALCON`}
                              />
                              <MetricTile
                                label="Composite score"
                                value={fmtStat(nodeStats.node.bond?.composite_score)}
                                tone={(nodeStats.node.bond?.composite_score ?? 0) >= 5000 ? 'good' : 'warn'}
                                sub="basis points / 10000"
                              />
                              <MetricTile
                                label="Rewards pending"
                                value={`${fmtStat(nodeStats.node.bond?.reward_accum_qxrp, 4)}`}
                                sub="FALCON accumulator"
                              />
                              <MetricTile
                                label="Validator balance"
                                value={`${fmtStat(nodeStats.node.balance_qxrp, 2)}`}
                                sub="FALCON on-chain"
                              />
                              <MetricTile
                                label="Uptime"
                                value={`${fmtStat(Math.floor((nodeStats.node.uptime_seconds ?? 0) / 3600))}h`}
                                sub={`load ×${nodeStats.node.load_factor ?? 1}`}
                              />
                            </div>
                            {nodeStats.node.validator_account && (
                              <div className="bg-slate-900/50 rounded-lg px-3 py-2">
                                <div className="text-[10px] text-slate-500">Validator r-address</div>
                                <div className="font-mono text-[11px] text-emerald-300 break-all">{nodeStats.node.validator_account}</div>
                              </div>
                            )}
                            {nodeStats.node.bond && (
                              <div className="grid grid-cols-3 gap-2 text-[10px]">
                                <div className="bg-slate-900/40 rounded-lg px-2 py-1.5 text-slate-500">
                                  Uptime score <span className="text-slate-300 font-mono">{fmtStat(nodeStats.node.bond.uptime_score)}</span>
                                </div>
                                <div className="bg-slate-900/40 rounded-lg px-2 py-1.5 text-slate-500">
                                  Vote accuracy <span className="text-slate-300 font-mono">{fmtStat(nodeStats.node.bond.vote_accuracy_score)}</span>
                                </div>
                                <div className="bg-slate-900/40 rounded-lg px-2 py-1.5 text-slate-500">
                                  Slash mult. <span className="text-slate-300 font-mono">{fmtStat(nodeStats.node.bond.slash_multiplier, 4)}</span>
                                </div>
                              </div>
                            )}
                            <Link
                              href="/rewards"
                              className="inline-flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors"
                            >
                              Claim rewards &amp; swap to stablecoins →
                            </Link>
                          </div>

                          {nodeStats.network && (
                            <div className="space-y-2 pt-1 border-t border-slate-800">
                              <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">Network</div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                <MetricTile label="Network ledger" value={`#${fmtStat(nodeStats.network.ledger_seq)}`} tone="good" sub={nodeStats.network.complete_ledgers} />
                                <MetricTile label="Network state" value={nodeStats.network.server_state || '—'} />
                                <MetricTile label="Bonded validators" value={fmtStat(nodeStats.network.bonded_validator_count)} tone="good" sub={`${fmtStat(nodeStats.network.total_validator_entries)} on ledger`} />
                                <MetricTile
                                  label="Epoch"
                                  value={nodeStats.network.epoch?.epoch_number != null ? String(nodeStats.network.epoch.epoch_number) : '—'}
                                  sub={nodeStats.network.epoch?.epoch_pool_balance_qxrp != null
                                   ? `pool ${fmtStat(nodeStats.network.epoch.epoch_pool_balance_qxrp, 2)} FALCON`
                                    : undefined}
                                />
                              </div>
                            </div>
                          )}

                          {(nodeStats.network?.validators?.length ?? 0) > 0 && (
                            <div className="space-y-2 pt-1 border-t border-slate-800">
                              <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">All bonded validators</div>
                              <div className="rounded-xl border border-slate-800 overflow-hidden">
                                <table className="w-full text-[11px]">
                                  <thead>
                                    <tr className="bg-slate-900/80 text-slate-500 text-left">
                                      <th className="px-2 py-1.5 font-medium">Account</th>
                                      <th className="px-2 py-1.5 font-medium">Status</th>
                                      <th className="px-2 py-1.5 font-medium text-right">Bond</th>
                                      <th className="px-2 py-1.5 font-medium text-right">Score</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-800/80">
                                    {nodeStats.network!.validators!.map((v) => {
                                      const mine = v.account === nodeStats.node?.validator_account
                                      return (
                                        <tr key={v.account} className={mine ? 'bg-cyan-950/30' : ''}>
                                          <td className="px-2 py-1.5 font-mono text-slate-400">
                                            {mine && <span className="text-cyan-400 mr-1">●</span>}
                                            {shortAddr(v.account || '')}
                                          </td>
                                          <td className="px-2 py-1.5 text-slate-300">{v.bond_status}</td>
                                          <td className="px-2 py-1.5 text-right text-slate-300">{fmtStat(v.bonded_amount_qxrp, 0)}</td>
                                          <td className="px-2 py-1.5 text-right text-slate-300">{fmtStat(v.composite_score)}</td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {nodeStats.updated_at && (
                            <p className="text-[10px] text-slate-600 text-center">Auto-refreshes every 15s · Last update {nodeStats.updated_at}</p>
                          )}
                        </>
                      )}

                      {!nodeStats && !nodeStatsError && nodeStatsLoading && (
                        <div className="flex items-center justify-center gap-2 py-8 text-slate-500 text-sm">
                          <Spinner /> Loading metrics…
                        </div>
                      )}

                      <button
                        onClick={handleUnlinkValidatorNode}
                        className="text-[10px] text-slate-600 hover:text-red-400 transition-colors w-full text-center"
                      >
                        Unlink this node (show setup again)
                      </button>
                    </>
                  ) : (
                    <>
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M5 12H3m2 0a2 2 0 100-4 2 2 0 000 4zm0 0a2 2 0 100 4 2 2 0 000-4zm8-4H9m4 0a2 2 0 100-4 2 2 0 000 4zm0 0a2 2 0 100 4 2 2 0 000-4zm8-4h-2m2 0a2 2 0 100-4 2 2 0 000 4zm0 0a2 2 0 100 4 2 2 0 000-4" />
                    </svg>
                    <h3 className="font-semibold text-white text-sm">Run a Validator Node</h3>
                  </div>
                  {savedNode && showNodeSetup && (
                    <button
                      onClick={() => { setShowNodeSetup(false); setError(null) }}
                      className="text-xs text-cyan-500 hover:text-cyan-400"
                    >
                      ← Back to dashboard view
                    </button>
                  )}

                  {/* Link node — prominent at top so it is not missed */}
                  <div className="space-y-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-3">
                    <div className="text-sm font-semibold text-cyan-200">Already ran the one-liner?</div>
                    <p className="text-xs text-cyan-100/80 leading-snug">
                      Paste your server&apos;s public IP below. This tab switches to a live validator dashboard (node + network metrics, auto-refresh 15s).
                    </p>
                    <div>
                      <label className="block text-[10px] text-cyan-200/70 mb-1">Server public IP or hostname</label>
                      <input
                        value={nodeHostInput}
                        onChange={(e) => setNodeHostInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleLinkValidatorNode()}
                        className="w-full bg-slate-900 border border-cyan-500/30 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-cyan-400"
                        placeholder="192.241.247.158"
                      />
                    </div>
                    <button
                      onClick={handleLinkValidatorNode}
                      className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm transition"
                    >
                      Link node &amp; open dashboard
                    </button>
                  </div>

                  {/* THE EXACT WARNING USER REQUESTED */}
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-200">
                    <div className="flex gap-2.5">
                      <div className="text-base mt-px">⚠️</div>
                      <div className="text-sm leading-snug">
                        <span className="font-semibold">You need 1,000 FALCON to bond</span> (≥1,100 FALCON on the validator address).<br />
                        Claim <span className="underline font-semibold">2,000 FALCON</span> from the faucet first — enough to fund bonding immediately.
                      </div>
                    </div>
                  </div>

                  {/* Port requirement note */}
                  <div className="flex gap-2 bg-amber-950/50 border border-amber-700/50 rounded-xl px-3 py-2.5">
                    <span className="text-amber-400 text-base leading-none mt-0.5">⚠</span>
                    <p className="text-xs text-amber-200 leading-snug">
                      <span className="font-semibold">Ports 51235 and 8080 (TCP) must be reachable.</span>{' '}
                      51235 for peering; 8080 for the validator dashboard. Works on a VPS <span className="text-amber-400">(automatic)</span> or home PC with router port-forwarding.
                    </p>
                  </div>

                  <p className="text-xs text-slate-400">
                    Run the single-line command on any fresh Ubuntu 22.04/24.04 (SSH or console). Uses Docker + public image. Derives validator keys from the secret (or auto fresh), patches config, prints validation_public_key + a separate <span className="text-amber-300">r-address you must fund (≥1,100 FALCON)</span> for bonding. Your payout address (this wallet) is saved for rewards. Container runs under docker compose.
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
                        onChange={(e) => setNodeName(e.target.value || 'my-falcon-node')}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-mono text-white focus:outline-none focus:border-cyan-500/60"
                        placeholder="my-falcon-node"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="text-[10px] text-slate-500">One-liner (single line — paste-safe for web consoles like Hetzner):</div>
                      <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-[11px] text-emerald-300 font-mono whitespace-pre-wrap break-all leading-snug">
{`curl -fsSL https://raw.githubusercontent.com/beartec-jpg/qXRP/develop/bin/install/bootstrap-qxrp-validator.sh | bash -s -- --payout ${wallet.address} --node-name ${nodeName || 'my-falcon-node'}`}
                      </pre>

                      <button
                        onClick={async () => {
                          const cmd = `curl -fsSL https://raw.githubusercontent.com/beartec-jpg/qXRP/develop/bin/install/bootstrap-qxrp-validator.sh | bash -s -- --payout ${wallet.address} --node-name ${nodeName || 'my-falcon-node'}`
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
                        'Sets up falcon user + docker (if missing) on fresh Ubuntu',
                        'Writes docker-compose.yml + xrpld.cfg + base validators.txt (UNL)',
                        'Starts falcon-validator + falcon-dashboard containers (validator on :51235, dashboard on :8080)',
                        'Runs validation_create (using --secret or fresh falcon-val-...) inside container; patches seed + pubkey into config',
                        'Runs wallet_propose; prints the r-address + master_seed you must fund with ≥1,100 FALCON (separate from payout)',
                        'Saves --payout / --node-name + validator files under /var/lib/falcon-validator/',
                        'Auto-bonds when funded; prints your public IP for the dashboard at the end',
                      ].map((step, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-cyan-600 font-mono flex-shrink-0 text-[10px]">{String(i + 1).padStart(2, '0')}</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* Handy commands */}
                  <div className="space-y-1.5 pt-1 border-t border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">Handy commands (run on your server)</div>
                    <div className="space-y-1">
                      {[
                        { label: 'Dashboard',      cmd: 'curl -s http://127.0.0.1:8080/health && echo " — open http://<server-ip>:8080 in browser"' },
                        { label: 'Bond log',       cmd: 'tail -f /var/lib/falcon-validator/bond.log' },
                        { label: 'Live logs',      cmd: 'docker logs -f falcon-validator' },
                        { label: 'Status',         cmd: 'docker ps | grep falcon' },
                        { label: 'Restart',        cmd: 'cd /var/lib/falcon-validator && docker compose restart' },
                        { label: 'Node info',      cmd: "curl -s -X POST http://127.0.0.1:5005 -H 'Content-Type: application/json' -d '{\"method\":\"server_info\",\"params\":[{}]}' | python3 -m json.tool" },
                        { label: 'Check balance',  cmd: 'curl -s -X POST http://46.224.0.140:6005 -H \'Content-Type: application/json\' -d \'{"method":"account_info","params":[{"account":"<validator-r-address>","ledger_index":"validated"}]}\'' },
                      ].map(({ label, cmd }) => (
                        <div key={label} className="flex items-start gap-2">
                          <span className="text-slate-600 text-[10px] flex-shrink-0 w-20 pt-0.5">{label}</span>
                          <code className="text-[10px] font-mono text-cyan-700 break-all">{cmd}</code>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Link
                    href="/validator"
                    className="block text-center py-2.5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 text-sm font-medium hover:bg-cyan-500/20 transition"
                  >
                    Full validator guide + command reference →
                  </Link>

                  <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-800">
                    Rewards land in the validator account. Payout address ({wallet.address.slice(0, 10)}…) is saved for withdrawals.
                    Also see{' '}
                    <a href="/validator" className="underline text-slate-400 hover:text-slate-300">/validator</a>
                    {' '}or{' '}
                    <a href="https://github.com/beartec-jpg/qXRP/blob/develop/docs/validator-onboarding.md" target="_blank" rel="noopener noreferrer" className="underline text-slate-400 hover:text-slate-300">
                      GitHub docs
                    </a>.
                  </div>

                  <button
                    onClick={() => setView('dashboard')}
                    className="text-xs text-slate-600 hover:text-slate-400 transition-colors w-full text-center py-1"
                  >
                    ← Back to wallet
                  </button>
                    </>
                  )}
                </div>
              )}

              {/* ── Validator shortcut on main wallet view ── */}
              {view === 'dashboard' && (
                <button
                  type="button"
                  onClick={() => {
                    if (savedNode) {
                      setShowNodeSetup(false)
                    } else {
                      setShowNodeSetup(true)
                    }
                    setView('node')
                  }}
                  className="card px-4 py-3 flex items-center justify-between text-sm hover:border-cyan-500/40 transition-all w-full text-left"
                >
                  <div className="flex items-center gap-2 text-slate-400">
                    <svg className="w-4 h-4 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    <div>
                      <div className="text-slate-300 font-medium">
                        {savedNode ? 'Validator dashboard' : 'Run a validator node'}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {savedNode
                          ? `${savedNode.host} · tap for live metrics`
                          : 'One-liner setup · paste IP when done'}
                      </div>
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
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
                    const ok  = tx.result === 'tesSUCCESS'
                    const asset = tx.amountAsset ?? 'FALCON'
                    const amt = tx.amount ?? '—'
                    const amountLabel = tx.type === 'Payment' && tx.amount
                      ? `${incoming ? '+' : '-'}${amt} ${asset}`
                      : tx.type
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
                            {!ok ? 'failed' : amountLabel}
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
                <div className="card p-4 space-y-3">
                  <div className="text-xs text-slate-500">
                    Wallet data lives in this browser only. Download a fresh encrypted backup anytime.
                  </div>
                  {!showExportBackup ? (
                    <button
                      type="button"
                      onClick={() => { setShowExportBackup(true); setError(null) }}
                      className="w-full py-2 text-sm rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition"
                    >
                      Download backup file
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <input
                        type="password"
                        value={exportPassphrase}
                        onChange={e => setExportPassphrase(e.target.value)}
                        placeholder="New backup password"
                        className="input-field"
                        autoComplete="new-password"
                      />
                      <input
                        type="password"
                        value={exportPassConfirm}
                        onChange={e => setExportPassConfirm(e.target.value)}
                        placeholder="Confirm backup password"
                        className="input-field"
                        autoComplete="new-password"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => { setShowExportBackup(false); setExportPassphrase(''); setExportPassConfirm('') }}
                          className="flex-1 py-2 text-xs rounded-lg text-slate-500 hover:text-slate-300"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleExportBackup}
                          disabled={busy || !exportPassphrase || !exportPassConfirm}
                          className="flex-1 py-2 text-xs rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
                        >
                          {busy ? 'Exporting…' : 'Download'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {view === 'dashboard' && (
                <button
                  onClick={async () => {
                    if (!confirm('Remove this wallet from this device? Make sure you have your backup file first.')) return
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
            {network.badge === 'testnet' ? 'Testnet tokens · No real value' : `${network.name} · Network ID ${network.networkId}`}
            {' · '}
            <a
              href="https://github.com/beartec-jpg/qXRP"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-500 underline underline-offset-2 transition-colors"
            >
              Falcon Ledger on GitHub
            </a>
          </p>
        </div>
      </main>
    </div>
  )
}
