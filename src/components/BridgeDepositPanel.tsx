'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Wallet } from 'ethers'
import {
  authenticatePasskey,
  isPasskeySupported,
} from '@/lib/passkey'
import { decryptSeed, encryptSeed } from '@/lib/wallet-crypto'
import { saveWallet, type StoredWallet } from '@/lib/wallet-store'
import { useNetwork } from '@/components/NetworkProvider'
import { withNetworkQuery } from '@/lib/network-query'
import {
  depositUsdcToBridge,
  fetchSepoliaBalances,
  sendSepoliaEth,
  sendSepoliaUsdc,
  type BridgeDepositResult,
} from '@/lib/evm-bridge-client'
import { signBridgeWithdraw, signFusdcPayment } from '@/lib/wallet-sign-client'
import {
  etherscanAddressUrl,
  etherscanTokenUrl,
  lockContractReady,
  type UsdcBridgeManifest,
} from '@/lib/bridge-config'
import {
  createEncryptedEvmBackup,
  decryptEvmBackupFile,
  downloadEvmBackup,
  normalizeEvmPrivateKey,
  parseEvmBackupFile,
  validateEvmBackupPassphrase,
} from '@/lib/evm-wallet-backup'

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin-slow ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function fmt(n: string | number, decimals = 4): string {
  const v = typeof n === 'string' ? parseFloat(n) : n
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals })
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="text-xs px-2 py-1 rounded-md bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors shrink-0"
    >
      {copied ? 'Copied' : label ?? 'Copy'}
    </button>
  )
}

interface Props {
  wallet: StoredWallet
  bridgeCfg: UsdcBridgeManifest & { lock_contract_ready?: boolean }
  fusdcBalance?: number | null
  onWalletUpdate: (w: StoredWallet) => void
  onFalconRefresh?: () => void
}

type BridgeMode = 'deposit' | 'withdraw' | 'send'
type EvmPanel = 'bridge' | 'backup' | 'restore'

function shortEvmAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : addr
}

interface BridgeWithdrawResult {
  falconTxHash?: string
  amount: string
  sepoliaRecipient: string
}

export default function BridgeDepositPanel({
  wallet,
  bridgeCfg,
  fusdcBalance,
  onWalletUpdate,
  onFalconRefresh,
}: Props) {
  const { networkKey, network } = useNetwork()
  const [balances, setBalances] = useState<{ eth: string; usdc: string } | null>(null)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [mode, setMode] = useState<BridgeMode>('deposit')
  const [sendAsset, setSendAsset] = useState<'eth' | 'usdc'>('usdc')
  const [sendTo, setSendTo] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sendHash, setSendHash] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BridgeDepositResult | null>(null)
  const [withdrawResult, setWithdrawResult] = useState<BridgeWithdrawResult | null>(null)
  const [evmPanel, setEvmPanel] = useState<EvmPanel>('bridge')
  const [backupPass, setBackupPass] = useState('')
  const [backupPassConfirm, setBackupPassConfirm] = useState('')
  const [restorePass, setRestorePass] = useState('')
  const [restoreKey, setRestoreKey] = useState('')
  const restoreFileRef = useRef<HTMLInputElement>(null)

  const bridgeReady = lockContractReady(bridgeCfg)
  const hasEvm = !!(wallet.evmAddress && wallet.evmEncrypted)

  const refreshBalances = useCallback(async () => {
    if (!wallet.evmAddress) return
    setBalanceLoading(true)
    setBalanceError(null)
    try {
      const b = await fetchSepoliaBalances(bridgeCfg.sepolia, wallet.evmAddress)
      setBalances(b)
    } catch (e: unknown) {
      setBalances(null)
      setBalanceError(
        e instanceof Error ? e.message : 'Could not load Sepolia balances (RPC error)',
      )
    } finally {
      setBalanceLoading(false)
    }
  }, [bridgeCfg.sepolia, wallet.evmAddress])

  useEffect(() => {
    if (hasEvm) refreshBalances()
  }, [hasEvm, refreshBalances])

  const attachEvmWallet = async (
    privateKey: string,
    expectedAddress?: string,
    auth?: { keyBytes: Uint8Array; hasPrf: boolean },
  ) => {
    const { keyBytes, hasPrf } = auth ?? await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
    const evm = new Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`)
    if (expectedAddress && evm.address.toLowerCase() !== expectedAddress.toLowerCase()) {
      throw new Error('Private key does not match the address in the backup file')
    }
    const evmEncrypted = await encryptSeed(evm.privateKey, keyBytes, hasPrf)
    const updated: StoredWallet = {
      ...wallet,
      evmAddress: evm.address,
      evmEncrypted,
    }
    await saveWallet(updated)
    onWalletUpdate(updated)
    setEvmPanel('bridge')
    setRestoreKey('')
    setRestorePass('')
    await refreshBalances()
  }

  const setupSepoliaWallet = async () => {
    if (!isPasskeySupported()) {
      setError('Passkeys are required to secure your Sepolia wallet')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const auth = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const evm = Wallet.createRandom()
      await attachEvmWallet(evm.privateKey, undefined, auth)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create Sepolia wallet')
    } finally {
      setBusy(false)
    }
  }

  const handleEvmBackup = async () => {
    if (!wallet.evmEncrypted || !wallet.evmAddress) return
    const passErr = validateEvmBackupPassphrase(backupPass)
    if (passErr) {
      setError(passErr)
      return
    }
    if (backupPass !== backupPassConfirm) {
      setError('Backup passwords do not match')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const evmPrivateKey = await decryptSeed(wallet.evmEncrypted, keyBytes)
      const file = await createEncryptedEvmBackup(
        {
          evm_private_key: evmPrivateKey.replace(/^0x/i, ''),
          evm_address: wallet.evmAddress,
          falcon_address: wallet.address,
          label: 'Sepolia bridge wallet',
          createdAt: Date.now(),
        },
        backupPass,
      )
      downloadEvmBackup(file)
      setBackupPass('')
      setBackupPassConfirm('')
      setEvmPanel('bridge')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Backup failed')
    } finally {
      setBusy(false)
    }
  }

  const handleRestoreBackupFile = async (file: File) => {
    if (!restorePass) {
      setError('Enter the backup password for this file')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const raw = JSON.parse(await file.text()) as unknown
      const parsed = parseEvmBackupFile(raw)
      let payload
      if (parsed.encrypted) {
        payload = await decryptEvmBackupFile(parsed, restorePass)
      } else {
        payload = parsed
      }
      const key = normalizeEvmPrivateKey(payload.evm_private_key)
      if (!key) throw new Error('Backup file contains an invalid private key')
      await attachEvmWallet(key, payload.evm_address)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Restore failed')
    } finally {
      setBusy(false)
      if (restoreFileRef.current) restoreFileRef.current.value = ''
    }
  }

  const handleRestorePrivateKey = async () => {
    const key = normalizeEvmPrivateKey(restoreKey)
    if (!key) {
      setError('Paste a valid 64-character hex private key (with or without 0x)')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await attachEvmWallet(key)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Restore failed')
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveEvmWallet = async () => {
    if (
      !confirm(
        'Remove this Sepolia wallet from this device? Save a backup first — you will need it to restore the same address.',
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const updated: StoredWallet = {
        ...wallet,
        evmAddress: undefined,
        evmEncrypted: undefined,
      }
      await saveWallet(updated)
      onWalletUpdate(updated)
      setBalances(null)
      setEvmPanel('bridge')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  const handleSend = async () => {
    if (!wallet.evmEncrypted || !wallet.evmAddress) return
    const to = sendTo.trim()
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
      setError('Enter a valid 0x… recipient address')
      return
    }
    const amt = parseFloat(sendAmount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a valid amount')
      return
    }

    setBusy(true)
    setError(null)
    setSendHash(null)
    setStep(null)

    try {
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const evmPrivateKey = await decryptSeed(wallet.evmEncrypted, keyBytes)

      let hash: string
      if (sendAsset === 'eth') {
        setStep('Sending ETH…')
        hash = await sendSepoliaEth({
          cfg: bridgeCfg.sepolia,
          evmPrivateKey,
          to,
          amountEth: sendAmount,
        })
      } else {
        setStep('Sending USDC…')
        hash = await sendSepoliaUsdc({
          cfg: bridgeCfg.sepolia,
          evmPrivateKey,
          to,
          amountUsdc: sendAmount,
        })
      }

      setSendHash(hash)
      setSendAmount('')
      setSendTo('')
      await refreshBalances()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setBusy(false)
      setStep(null)
    }
  }

  const submitFalconTx = async (tx_blob: string) => {
    const res = await fetch('/api/wallet/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx_blob, network: networkKey }),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    return data
  }

  const handleReturnFusdcToIssuer = async () => {
    const issuer = bridgeCfg.falcon?.token_issuer
    const currency = bridgeCfg.falcon?.token_currency
    if (!issuer || !currency) return

    const amt = parseFloat(withdrawAmount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a valid F-USDC amount')
      return
    }
    if ((fusdcBalance ?? 0) < amt) {
      setError(`Insufficient F-USDC (have ${fmt(fusdcBalance ?? 0, 4)})`)
      return
    }

    setBusy(true)
    setError(null)
    setWithdrawResult(null)
    setStep(null)

    try {
      const accRes = await fetch(
        withNetworkQuery(`/api/wallet/account?address=${encodeURIComponent(wallet.address)}`, networkKey),
      )
      const accData = await accRes.json()
      if (!accRes.ok || !accData.exists) throw new Error('Failed to refresh Falcon account')

      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)
      const amountStr = String(Math.round(amt * 1e6) / 1e6)

      setStep('Returning F-USDC to issuer…')
      const { tx_blob } = await signFusdcPayment(
        {
          account: wallet.address,
          destination: issuer,
          issuer,
          currency,
          amount: amountStr,
          sequence: accData.sequence,
          lastLedgerSequence: accData.currentLedger + 20,
          networkId: network.networkId,
        },
        falcon_secret,
      )

      const data = await submitFalconTx(tx_blob)
      setWithdrawResult({
        falconTxHash: data.hash,
        amount: amountStr,
        sepoliaRecipient: '(returned to issuer — not bridge-out)',
      })
      setWithdrawAmount('')
      setTimeout(() => {
        onFalconRefresh?.()
        refreshBalances()
      }, 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Return failed')
    } finally {
      setBusy(false)
      setStep(null)
    }
  }

  const handleBridgeOut = async () => {
    const issuer = bridgeCfg.falcon?.token_issuer
    const currency = bridgeCfg.falcon?.token_currency
    if (!issuer || !currency || !wallet.evmAddress) return

    const amt = parseFloat(withdrawAmount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a valid F-USDC amount')
      return
    }
    if ((fusdcBalance ?? 0) < amt) {
      setError(`Insufficient F-USDC (have ${fmt(fusdcBalance ?? 0, 4)})`)
      return
    }

    setBusy(true)
    setError(null)
    setWithdrawResult(null)
    setStep(null)

    try {
      const accRes = await fetch(
        withNetworkQuery(`/api/wallet/account?address=${encodeURIComponent(wallet.address)}`, networkKey),
      )
      const accData = await accRes.json()
      if (!accRes.ok || !accData.exists) throw new Error('Failed to refresh Falcon account')

      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)

      const amountStr = String(Math.round(amt * 1e6) / 1e6)
      setStep('Returning F-USDC to bridge…')
      const { tx_blob } = await signBridgeWithdraw(
        {
          account: wallet.address,
          issuer,
          currency,
          amount: amountStr,
          sepoliaRecipient: wallet.evmAddress,
          sequence: accData.sequence,
          lastLedgerSequence: accData.currentLedger + 20,
          networkId: network.networkId,
        },
        falcon_secret,
      )

      const data = await submitFalconTx(tx_blob)
      setWithdrawResult({
        falconTxHash: data.hash,
        amount: amountStr,
        sepoliaRecipient: wallet.evmAddress,
      })
      setWithdrawAmount('')
      setTimeout(() => {
        onFalconRefresh?.()
        refreshBalances()
      }, 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Bridge out failed')
    } finally {
      setBusy(false)
      setStep(null)
    }
  }

  const handleDeposit = async () => {
    if (!wallet.evmEncrypted || !wallet.evmAddress || !bridgeReady) return
    const amt = parseFloat(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a valid USDC amount')
      return
    }

    setBusy(true)
    setError(null)
    setResult(null)
    setStep(null)

    try {
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const evmPrivateKey = await decryptSeed(wallet.evmEncrypted, keyBytes)

      const res = await depositUsdcToBridge({
        cfg: bridgeCfg.sepolia,
        evmPrivateKey,
        amountUsdc: amount,
        falconAccount: wallet.address,
        onStep: setStep,
      })

      setResult(res)
      setAmount('')
      await refreshBalances()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Bridge deposit failed')
    } finally {
      setBusy(false)
      setStep(null)
    }
  }

  const amtNum = parseFloat(amount) || 0
  const withdrawAmtNum = parseFloat(withdrawAmount) || 0
  const sendAmtNum = parseFloat(sendAmount) || 0
  const fusdcAvail = fusdcBalance ?? 0
  const usdcAvail = balances ? parseFloat(balances.usdc) : 0
  const ethAvail = balances ? parseFloat(balances.eth) : 0

  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white">Sepolia Bridge Wallet</h2>
          <p className="text-xs text-slate-400 mt-1">
            Bridge USDC in from Sepolia, bridge F-USDC back out to your Sepolia wallet, or send Sepolia assets anywhere.
          </p>
        </div>

        {hasEvm && (
          <div className="flex rounded-xl overflow-hidden border border-slate-700 text-sm">
            <button
              type="button"
              onClick={() => { setMode('deposit'); setError(null) }}
              className={`flex-1 py-2 font-medium ${mode === 'deposit' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-500'}`}
            >
              Bridge In
            </button>
            <button
              type="button"
              onClick={() => { setMode('withdraw'); setError(null) }}
              className={`flex-1 py-2 font-medium ${mode === 'withdraw' ? 'bg-amber-500/10 text-amber-400' : 'text-slate-500'}`}
            >
              Bridge Out
            </button>
            <button
              type="button"
              onClick={() => { setMode('send'); setError(null) }}
              className={`flex-1 py-2 font-medium ${mode === 'send' ? 'bg-brand-500/10 text-brand-400' : 'text-slate-500'}`}
            >
              Send Out
            </button>
          </div>
        )}

        {!bridgeReady && (
          <div className="text-xs text-amber-400 bg-amber-500/10 rounded-xl px-3 py-2.5">
            Lock contract not configured. Set SEPOLIA_LOCK_CONTRACT in deployment env.
          </div>
        )}

        {!hasEvm ? (
          evmPanel === 'restore' ? (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => { setEvmPanel('bridge'); setError(null) }}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                ← Back
              </button>
              <p className="text-xs text-slate-400">
                Restore a Sepolia wallet from an encrypted backup file or paste the private key hex.
                Not a mnemonic phrase — backups store the raw EVM key encrypted with your backup password.
              </p>
              <input
                ref={restoreFileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleRestoreBackupFile(f)
                }}
              />
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Backup file password</label>
                <input
                  type="password"
                  value={restorePass}
                  onChange={(e) => setRestorePass(e.target.value)}
                  className="input-field"
                  placeholder="Password from when you downloaded backup"
                  disabled={busy}
                />
              </div>
              <button
                type="button"
                onClick={() => restoreFileRef.current?.click()}
                disabled={busy || !restorePass}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {busy ? <><Spinner /> Restoring…</> : 'Upload sepolia-backup-….json'}
              </button>
              <div className="text-xs text-slate-500 text-center">or paste private key</div>
              <textarea
                value={restoreKey}
                onChange={(e) => setRestoreKey(e.target.value)}
                className="input-field font-mono text-xs min-h-[72px]"
                placeholder="64-char hex private key (0x optional)"
                disabled={busy}
                spellCheck={false}
              />
              <button
                type="button"
                onClick={handleRestorePrivateKey}
                disabled={busy || !restoreKey.trim()}
                className="w-full py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-800/60 disabled:opacity-50"
              >
                Restore from private key
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                Create a Sepolia wallet secured by your Falcon passkey (random private key — not a mnemonic).
                You need Sepolia ETH for gas and USDC to bridge in.
              </p>
              <button
                type="button"
                onClick={setupSepoliaWallet}
                disabled={busy || !isPasskeySupported()}
                className="btn-primary flex items-center justify-center gap-2"
              >
                {busy ? <><Spinner /> Creating…</> : 'Create Sepolia Wallet'}
              </button>
              <button
                type="button"
                onClick={() => { setEvmPanel('restore'); setError(null) }}
                className="text-xs text-brand-400 hover:text-brand-300 w-full text-center"
              >
                Restore from backup or private key →
              </button>
            </div>
          )
        ) : evmPanel === 'backup' ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => { setEvmPanel('bridge'); setError(null) }}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              ← Back
            </button>
            <p className="text-xs text-slate-400">
              Download an encrypted backup of your Sepolia private key. Store the file and password safely —
              you need both to restore on another device.
            </p>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">Backup password</label>
              <input
                type="password"
                value={backupPass}
                onChange={(e) => setBackupPass(e.target.value)}
                className="input-field"
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">Confirm password</label>
              <input
                type="password"
                value={backupPassConfirm}
                onChange={(e) => setBackupPassConfirm(e.target.value)}
                className="input-field"
                disabled={busy}
              />
            </div>
            <button
              type="button"
              onClick={handleEvmBackup}
              disabled={busy || !backupPass || !backupPassConfirm}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {busy ? <><Spinner /> Preparing…</> : 'Download encrypted backup'}
            </button>
          </div>
        ) : evmPanel === 'restore' ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => { setEvmPanel('bridge'); setError(null) }}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              ← Back
            </button>
            <p className="text-xs text-amber-400 bg-amber-500/10 rounded-xl px-3 py-2">
              Restoring replaces the Sepolia wallet on this device. Back up the current wallet first if it holds funds.
            </p>
            <input
              ref={restoreFileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleRestoreBackupFile(f)
              }}
            />
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">Backup file password</label>
              <input
                type="password"
                value={restorePass}
                onChange={(e) => setRestorePass(e.target.value)}
                className="input-field"
                disabled={busy}
              />
            </div>
            <button
              type="button"
              onClick={() => restoreFileRef.current?.click()}
              disabled={busy || !restorePass}
              className="btn-primary w-full"
            >
              Upload backup file
            </button>
            <textarea
              value={restoreKey}
              onChange={(e) => setRestoreKey(e.target.value)}
              className="input-field font-mono text-xs min-h-[72px]"
              placeholder="Or paste private key hex"
              disabled={busy}
              spellCheck={false}
            />
            <button
              type="button"
              onClick={handleRestorePrivateKey}
              disabled={busy || !restoreKey.trim()}
              className="w-full py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm"
            >
              Restore from private key
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="card p-5 space-y-4 bg-slate-900/40 border-slate-700/80">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs text-slate-500 mb-0.5">Sepolia Wallet</div>
                  <div className="font-mono text-sm text-slate-300">{shortEvmAddr(wallet.evmAddress!)}</div>
                </div>
                <div className="flex items-center gap-1">
                  <CopyButton text={wallet.evmAddress!} label="Copy" />
                  <button
                    type="button"
                    onClick={() => refreshBalances()}
                    disabled={balanceLoading}
                    className="p-1.5 text-slate-500 hover:text-slate-300 disabled:opacity-40"
                    title="Refresh balances"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-500 mb-1">USDC</div>
                <div className="text-3xl font-bold text-white">
                  {balanceLoading ? '…' : balances ? fmt(balances.usdc, 2) : '—'}
                </div>
                <div className="text-[10px] text-slate-600 mt-1">Sepolia testnet USDC for bridge</div>
              </div>

              <div className="bg-slate-800/60 rounded-xl px-3 py-2.5">
                <div className="text-xs text-slate-500">Sepolia ETH</div>
                <div className="font-mono text-slate-100 mt-0.5 text-lg">
                  {balanceLoading ? '…' : balances ? fmt(balances.eth, 6) : '—'}
                </div>
                <div className="text-[10px] text-slate-600 mt-0.5">Gas for deposits and sends</div>
              </div>

              {balanceError && (
                <p className="text-xs text-amber-400">
                  Balance lookup failed: {balanceError}
                </p>
              )}
              {ethAvail < 0.001 && (
                <p className="text-xs text-amber-400">
                  Need Sepolia ETH for gas.{' '}
                  <a href="https://sepoliafaucet.com" target="_blank" rel="noopener noreferrer" className="underline text-brand-400">
                    Get test ETH
                  </a>
                </p>
              )}
              <a
                href={`${bridgeCfg.sepolia.explorer_url}/address/${wallet.evmAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-brand-400 hover:text-brand-300 inline-block"
              >
                Etherscan →
              </a>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => { setEvmPanel('backup'); setError(null) }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Backup
              </button>
              <button
                type="button"
                onClick={() => { setEvmPanel('restore'); setError(null) }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Restore
              </button>
              <button
                type="button"
                onClick={handleRemoveEvmWallet}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 border border-red-500/20"
              >
                Remove
              </button>
            </div>

            {mode === 'withdraw' && (
              <>
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 text-xs text-slate-400 space-y-1">
                  <p>
                    Return F-USDC on Falcon to the bridge issuer. Validators release matching Sepolia USDC
                    to your passkey Sepolia wallet below (usually within a few minutes).
                  </p>
                  <p className="text-slate-500">
                    Falcon F-USDC available:{' '}
                    <span className="font-mono text-slate-200">{fmt(fusdcAvail, 4)}</span>
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">F-USDC to bridge out</label>
                  <input
                    type="number"
                    value={withdrawAmount}
                    onChange={(e) => { setWithdrawAmount(e.target.value); setError(null) }}
                    placeholder="0.00"
                    min="0.000001"
                    step="any"
                    className="input-field"
                    disabled={busy || !bridgeReady}
                  />
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>{fusdcAvail > 0 ? `Available: ${fmt(fusdcAvail, 4)} F-USDC` : 'No F-USDC balance'}</span>
                    {fusdcAvail > 0 && (
                      <button type="button" onClick={() => setWithdrawAmount(String(fusdcAvail))} className="text-brand-500">
                        Max
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-slate-500">
                  Sepolia release target:{' '}
                  <span className="font-mono text-slate-400">{wallet.evmAddress}</span>
                </p>
                <button
                  type="button"
                  onClick={handleBridgeOut}
                  disabled={
                    busy ||
                    !bridgeReady ||
                    !bridgeCfg.falcon?.token_issuer ||
                    withdrawAmtNum <= 0 ||
                    withdrawAmtNum > fusdcAvail
                  }
                  className="btn-primary flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500"
                >
                  {busy ? <><Spinner /> {step ?? 'Signing…'}</> : 'Bridge Out with Passkey'}
                </button>
                <button
                  type="button"
                  onClick={handleReturnFusdcToIssuer}
                  disabled={
                    busy ||
                    !bridgeCfg.falcon?.token_issuer ||
                    withdrawAmtNum <= 0 ||
                    withdrawAmtNum > fusdcAvail
                  }
                  className="w-full py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-800/60 disabled:opacity-50"
                >
                  {busy ? step ?? 'Working…' : 'Return F-USDC to issuer (legacy cleanup)'}
                </button>
                <p className="text-[10px] text-slate-500">
                  Use legacy cleanup before releasing old Sepolia USDC in the Crypto app. Bridge Out only works
                  for F-USDC backed by the new lock contract after a fresh bridge-in.
                </p>
                {fusdcAvail <= 0 && (
                  <p className="text-xs text-slate-500">
                    Need F-USDC first? Withdraw from the{' '}
                    <a href="/pool" className="text-brand-400 hover:text-brand-300">pool</a>
                    {' '}or swap FALCON on the Swap tab.
                  </p>
                )}
              </>
            )}

            {mode === 'deposit' && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">USDC amount to bridge</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setError(null) }}
                    placeholder="0.00"
                    min="0.000001"
                    step="any"
                    className="input-field"
                    disabled={busy || !bridgeReady}
                  />
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>{balances ? `Available: ${fmt(usdcAvail, 4)} USDC` : ''}</span>
                    {usdcAvail > 0 && (
                      <button type="button" onClick={() => setAmount(String(usdcAvail))} className="text-brand-500">
                        Max
                      </button>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleDeposit}
                  disabled={busy || !bridgeReady || amtNum <= 0 || ethAvail < 0.0001}
                  className="btn-primary flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500"
                >
                  {busy ? <><Spinner /> {step ?? 'Signing…'}</> : 'Deposit with Passkey'}
                </button>

                {bridgeReady && (
                  <div className="text-[10px] text-slate-500">
                    Lock contract:{' '}
                    <a
                      href={etherscanAddressUrl(bridgeCfg.sepolia.explorer_url, bridgeCfg.sepolia.lock_contract)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-400 hover:text-brand-300 font-mono"
                    >
                      {bridgeCfg.sepolia.lock_contract.slice(0, 10)}…
                    </a>
                  </div>
                )}
              </>
            )}

            {mode === 'send' && (
              <div className="space-y-3">
                <div className="flex rounded-xl overflow-hidden border border-slate-700 text-sm">
                  <button
                    type="button"
                    onClick={() => setSendAsset('usdc')}
                    className={`flex-1 py-2 ${sendAsset === 'usdc' ? 'bg-brand-500/10 text-brand-400' : 'text-slate-500'}`}
                  >
                    USDC
                  </button>
                  <button
                    type="button"
                    onClick={() => setSendAsset('eth')}
                    className={`flex-1 py-2 ${sendAsset === 'eth' ? 'bg-brand-500/10 text-brand-400' : 'text-slate-500'}`}
                  >
                    ETH
                  </button>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Recipient (0x…)</label>
                  <input
                    type="text"
                    value={sendTo}
                    onChange={(e) => { setSendTo(e.target.value); setError(null) }}
                    placeholder="0x…"
                    className="input-field font-mono text-sm"
                    disabled={busy}
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Amount ({sendAsset.toUpperCase()})</label>
                  <input
                    type="number"
                    value={sendAmount}
                    onChange={(e) => { setSendAmount(e.target.value); setError(null) }}
                    placeholder="0.00"
                    min="0"
                    step="any"
                    className="input-field"
                    disabled={busy}
                  />
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>
                      Available:{' '}
                      {sendAsset === 'eth' ? fmt(ethAvail, 6) + ' ETH' : fmt(usdcAvail, 4) + ' USDC'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSendAmount(String(sendAsset === 'eth' ? Math.max(0, ethAvail - 0.002) : usdcAvail))}
                      className="text-brand-500"
                    >
                      Max
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={busy || sendAmtNum <= 0 || ethAvail < 0.0001}
                  className="btn-primary flex items-center justify-center gap-2"
                >
                  {busy ? <><Spinner /> {step ?? 'Signing…'}</> : 'Send with Passkey'}
                </button>
                <p className="text-[10px] text-slate-500">
                  Send Sepolia assets to any address — e.g. after bridge-out releases USDC here, or to move leftover faucet funds.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {sendHash && (
        <div className="card p-4 space-y-2 border border-brand-500/20">
          <div className="text-sm font-medium text-brand-400">Sent on Sepolia</div>
          <div className="text-xs text-slate-400 break-all">Tx: {sendHash}</div>
          <button type="button" onClick={() => setSendHash(null)} className="text-xs text-brand-400">Dismiss</button>
        </div>
      )}

      {withdrawResult && (
        <div className="card p-4 space-y-2 border border-amber-500/20">
          <div className="text-sm font-medium text-amber-400">Bridge-out submitted on Falcon</div>
          {withdrawResult.falconTxHash && (
            <div className="text-xs text-slate-400 break-all">Falcon tx: {withdrawResult.falconTxHash}</div>
          )}
          <p className="text-xs text-slate-500">
            Returned {withdrawResult.amount} F-USDC. Sepolia USDC will be sent to{' '}
            <span className="font-mono">{withdrawResult.sepoliaRecipient.slice(0, 10)}…</span> once the
            relay processes it — refresh Sepolia balance above, then use Send Out for MetaMask or elsewhere.
          </p>
          <button type="button" onClick={() => setWithdrawResult(null)} className="text-xs text-brand-400">
            Dismiss
          </button>
        </div>
      )}

      {result && (
        <div className="card p-4 space-y-2 border border-emerald-500/20">
          <div className="text-sm font-medium text-emerald-400">Deposit submitted on Sepolia</div>
          {result.approveHash && (
            <div className="text-xs text-slate-400 break-all">Approve: {result.approveHash}</div>
          )}
          <div className="text-xs text-slate-400 break-all">Deposit: {result.depositHash}</div>
          {result.depositId && (
            <div className="text-xs text-slate-400 break-all">Deposit ID: {result.depositId}</div>
          )}
          <p className="text-xs text-slate-500">
            Validators will attest this deposit and mint Falcon USDC to your address. This may take a few minutes on testnet.
          </p>
          <button type="button" onClick={() => setResult(null)} className="text-xs text-brand-400">
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="card p-4 border border-red-500/20 text-sm text-red-400">
          {error}
          <button type="button" onClick={() => setError(null)} className="block text-xs text-slate-500 mt-2">
            Dismiss
          </button>
        </div>
      )}

      <div className="card p-4 text-xs text-slate-500 space-y-2">
        <div className="text-slate-400 font-medium">How it works</div>
        <ol className="list-decimal list-inside space-y-1">
          <li>Create or restore Sepolia wallet (passkey-encrypted private key on this device)</li>
          <li>Back up the Sepolia wallet before removing or switching devices</li>
          <li>Bridge In: lock Sepolia USDC → mint F-USDC to your Falcon wallet</li>
          <li>Bridge Out: return F-USDC → Sepolia USDC released here</li>
          <li>Send Out: move Sepolia ETH/USDC to any 0x address</li>
        </ol>
      </div>
    </div>
  )
}