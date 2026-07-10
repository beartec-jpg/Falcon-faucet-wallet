'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Wallet } from 'ethers'
import { createRandomEvmWallet } from '@/lib/create-evm-wallet'
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
  waitForWithdrawalRelease,
  type BridgeDepositResult,
} from '@/lib/evm-bridge-client'
import { parseEvmAddressFromScan } from '@/lib/parse-evm-address'
import { signBridgeWithdraw, signFusdcPayment, signTrustSet } from '@/lib/wallet-sign-client'

const AddressQrScanner = dynamic(() => import('@/components/AddressQrScanner'), { ssr: false })
import { submitWithSequenceRetry, fetchSequenceInfo, type SubmitResult } from '@/lib/wallet-submit'
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

/** Display balance without rounding up (avoids showing 260 when wallet has 259.99985). */
function fmtFloor(n: string | number, decimals = 2): string {
  const v = typeof n === 'string' ? parseFloat(n) : n
  if (!Number.isFinite(v)) return '—'
  const scale = 10 ** decimals
  const floored = Math.floor(v * scale) / scale
  return floored.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals })
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

type BridgeMode = 'deposit' | 'withdraw' | 'send' | 'receive'
type EvmPanel = 'bridge' | 'backup' | 'restore'

function shortEvmAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : addr
}

function shortFalconAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : addr
}

interface BridgeWithdrawResult {
  falconTxHash?: string
  amount: string
  sepoliaRecipient: string
}

type ReleaseStatus = 'pending' | 'released' | 'unconfirmed' | null

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
  const [showSendScanner, setShowSendScanner] = useState(false)
  const [amount, setAmount] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BridgeDepositResult | null>(null)
  const [withdrawResult, setWithdrawResult] = useState<BridgeWithdrawResult | null>(null)
  const [releaseStatus, setReleaseStatus] = useState<ReleaseStatus>(null)
  const [evmPanel, setEvmPanel] = useState<EvmPanel>('bridge')
  const [backupPass, setBackupPass] = useState('')
  const [backupPassConfirm, setBackupPassConfirm] = useState('')
  const [restorePass, setRestorePass] = useState('')
  const [restoreKey, setRestoreKey] = useState('')
  const restoreFileRef = useRef<HTMLInputElement>(null)
  const [fusdcLive, setFusdcLive] = useState<number | null>(fusdcBalance ?? null)
  const [fusdcLoading, setFusdcLoading] = useState(false)
  const [fusdcError, setFusdcError] = useState<string | null>(null)
  const [hasFusdcTrustLine, setHasFusdcTrustLine] = useState(false)
  const [trustLineResult, setTrustLineResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const bridgeReady = lockContractReady(bridgeCfg)
  const hasEvm = !!(wallet.evmAddress && wallet.evmEncrypted)
  const falconIssuer = bridgeCfg.falcon?.token_issuer?.trim() ?? ''
  const falconCurrency = bridgeCfg.falcon?.token_currency?.trim() ?? 'QUC'
  const canBridgeIn = hasFusdcTrustLine && !!falconIssuer

  const refreshFusdcBalance = useCallback(async () => {
    setFusdcLoading(true)
    setFusdcError(null)
    try {
      const res = await fetch(
        withNetworkQuery(`/api/wallet/assets?address=${encodeURIComponent(wallet.address)}`, networkKey),
      )
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error ?? `Balance lookup failed (${res.status})`)
      }
      if (data.assets?.fusdc) {
        setHasFusdcTrustLine(!!data.assets.fusdc.hasTrustLine)
        setFusdcLive(data.assets.fusdc.hasTrustLine ? data.assets.fusdc.balance : 0)
      } else {
        setHasFusdcTrustLine(false)
      }
    } catch (e: unknown) {
      setFusdcError(e instanceof Error ? e.message : 'Could not load Falcon F-USDC balance')
    } finally {
      setFusdcLoading(false)
    }
  }, [networkKey, wallet.address])

  useEffect(() => {
    if (fusdcBalance != null && fusdcBalance > 0) setFusdcLive(fusdcBalance)
  }, [fusdcBalance])

  useEffect(() => {
    refreshFusdcBalance()
  }, [refreshFusdcBalance])

  useEffect(() => {
    if (mode === 'withdraw') refreshFusdcBalance()
  }, [mode, refreshFusdcBalance])

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
    const pk = evm.privateKey.startsWith('0x') ? evm.privateKey.slice(2) : evm.privateKey
    const evmEncrypted = await encryptSeed(pk, keyBytes, hasPrf)
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
      const evm = createRandomEvmWallet()
      await attachEvmWallet(evm.privateKeyHex, evm.address, auth)
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

  /**
   * Sign + submit for the wallet, transparently re-fetching the sequence and
   * re-signing on a tefPAST_SEQ/terPRE_SEQ sequence race. Signing stays in the
   * callback so the falcon_secret never leaves the browser.
   */
  const submitFalconSequenced = (
    sign: (seq: { sequence: number; lastLedgerSequence: number }) => Promise<{ tx_blob: string }>,
  ) =>
    submitWithSequenceRetry({
      networkKey,
      fetchSequence: async () => {
        const a = await fetchSequenceInfo(wallet.address, networkKey)
        if (!a.exists) throw new Error('Failed to refresh Falcon account')
        return { sequence: a.sequence, currentLedger: a.currentLedger }
      },
      sign,
    })

  const handleReturnFusdcToIssuer = async () => {
    const issuer = bridgeCfg.falcon?.token_issuer
    const currency = bridgeCfg.falcon?.token_currency
    if (!issuer || !currency) return

    const amt = parseFloat(withdrawAmount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a valid F-USDC amount')
      return
    }
    if ((fusdcLive ?? 0) < amt) {
      setError(`Insufficient F-USDC (have ${fmt(fusdcLive ?? 0, 4)})`)
      return
    }

    if (
      !confirm(
        'Legacy cleanup: this sends F-USDC back to the issuer WITHOUT a bridge memo. ' +
          'It does NOT release any Sepolia USDC and cannot be reversed. ' +
          'Use "Bridge Out" instead if you want to receive Sepolia USDC. Continue?',
      )
    ) {
      return
    }

    setBusy(true)
    setError(null)
    setWithdrawResult(null)
    setStep(null)

    try {
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)
      const amountStr = String(Math.round(amt * 1e6) / 1e6)

      setStep('Returning F-USDC to issuer…')
      const data = await submitFalconSequenced(({ sequence, lastLedgerSequence }) =>
        signFusdcPayment(
          {
            account: wallet.address,
            destination: issuer,
            issuer,
            currency,
            amount: amountStr,
            sequence,
            lastLedgerSequence,
            networkId: network.networkId,
          },
          falcon_secret,
        ),
      )
      setWithdrawResult({
        falconTxHash: data.hash,
        amount: amountStr,
        sepoliaRecipient: '(returned to issuer — not bridge-out)',
      })
      setWithdrawAmount('')
      setTimeout(() => {
        onFalconRefresh?.()
        refreshFusdcBalance()
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
    if ((fusdcLive ?? 0) < amt) {
      setError(`Insufficient F-USDC (have ${fmt(fusdcLive ?? 0, 4)})`)
      return
    }

    setBusy(true)
    setError(null)
    setWithdrawResult(null)
    setReleaseStatus(null)
    setStep(null)

    try {
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)

      const amountStr = String(Math.round(amt * 1e6) / 1e6)
      setStep('Returning F-USDC to bridge…')
      const data = await submitFalconSequenced(({ sequence, lastLedgerSequence }) =>
        signBridgeWithdraw(
          {
            account: wallet.address,
            issuer,
            currency,
            amount: amountStr,
            sepoliaRecipient: wallet.evmAddress!,
            sequence,
            lastLedgerSequence,
            networkId: network.networkId,
          },
          falcon_secret,
        ),
      )
      setWithdrawResult({
        falconTxHash: data.hash,
        amount: amountStr,
        sepoliaRecipient: wallet.evmAddress,
      })
      setWithdrawAmount('')
      setReleaseStatus('pending')
      const recipient = wallet.evmAddress
      // Best-effort: watch Sepolia for the matching WithdrawalReleased event so
      // the user sees whether the relay actually released their USDC.
      waitForWithdrawalRelease({ cfg: bridgeCfg.sepolia, recipient })
        .then((s) => setReleaseStatus(s.released ? 'released' : 'unconfirmed'))
        .catch(() => setReleaseStatus('unconfirmed'))
      setTimeout(() => {
        onFalconRefresh?.()
        refreshFusdcBalance()
        refreshBalances()
      }, 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Bridge out failed')
    } finally {
      setBusy(false)
      setStep(null)
    }
  }

  const handleTrustLine = async () => {
    if (!falconIssuer || !network.live) return
    setBusy(true)
    setError(null)
    setTrustLineResult(null)
    try {
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)
      const data = await submitWithSequenceRetry({
        networkKey,
        fetchSequence: async () => {
          const a = await fetchSequenceInfo(wallet.address, networkKey)
          if (!a.exists) throw new Error('Failed to refresh account')
          return { sequence: a.sequence, currentLedger: a.currentLedger }
        },
        sign: ({ sequence, lastLedgerSequence }) =>
          signTrustSet(
            {
              account: wallet.address,
              currency: falconCurrency,
              issuer: falconIssuer,
              limit: '10000000',
              sequence,
              lastLedgerSequence,
              networkId: network.networkId,
            },
            falcon_secret,
          ),
      }).catch((e: unknown): SubmitResult => ({
        success: false,
        message: e instanceof Error ? e.message : 'Failed',
      }))
      const ok = !!data.success
      setTrustLineResult({
        ok,
        msg: [data.result, data.message].filter(Boolean).join(' — ') || (ok ? 'Trust line ready' : 'TrustSet failed'),
      })
      if (ok) {
        setHasFusdcTrustLine(true)
        setTimeout(() => {
          refreshFusdcBalance()
          onFalconRefresh?.()
        }, 4000)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Trust line failed')
    } finally {
      setBusy(false)
    }
  }

  const handleDeposit = async () => {
    if (!wallet.evmEncrypted || !wallet.evmAddress || !bridgeReady) return
    if (!canBridgeIn) {
      setError('Add a F-USDC trust line on this page before bridging in — otherwise minted tokens cannot be delivered.')
      return
    }
    const amt = parseFloat(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a valid USDC amount')
      return
    }
    const availUsdc = parseFloat(balances?.usdc ?? '0')
    if (Number.isFinite(availUsdc) && amt > availUsdc) {
      setError(`Amount exceeds Sepolia USDC balance (${fmt(availUsdc, 4)} available)`)
      return
    }

    setBusy(true)
    setError(null)
    setResult(null)
    setStep(null)

    try {
      setStep('Confirm passkey to unlock Sepolia wallet…')
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      setStep('Passkey OK — submitting Sepolia txs (approve + lock, may take ~1 min)…')
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
      setTimeout(() => {
        refreshFusdcBalance()
        onFalconRefresh?.()
      }, 8000)
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
  const fusdcAvail = fusdcLive ?? fusdcBalance ?? 0
  const usdcAvailRaw = balances?.usdc ?? '0'
  const usdcAvail = parseFloat(usdcAvailRaw) || 0
  const ethAvail = balances ? parseFloat(balances.eth) : 0

  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white">My Bridge Wallet</h2>
          <p className="text-xs text-slate-400 mt-1">
            Sepolia <span className="text-emerald-400">ETH</span> and{' '}
            <span className="text-emerald-400">USDC</span> for bridging. Bridge In mints{' '}
            <span className="text-amber-400">F-USDC</span> on Falcon; Bridge Out releases Sepolia USDC here.
          </p>
        </div>

        <div className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5">
          <span className="font-semibold">Testnet · custodial bridge.</span> Mint and release are
          performed by an off-chain relay operator, not by a trustless on-chain contract. If a
          transfer does not complete, funds are recovered manually by the operator — do not bridge
          amounts you cannot afford to wait on.
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
              onClick={() => { setMode('withdraw'); setError(null); refreshFusdcBalance() }}
              className={`flex-1 py-2 font-medium ${mode === 'withdraw' ? 'bg-amber-500/10 text-amber-400' : 'text-slate-500'}`}
            >
              Bridge Out
            </button>
            <button
              type="button"
              onClick={() => { setMode('send'); setError(null) }}
              className={`flex-1 py-2 font-medium ${mode === 'send' ? 'bg-brand-500/10 text-brand-400' : 'text-slate-500'}`}
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => { setMode('receive' as BridgeMode); setError(null) }}
              className={`flex-1 py-2 font-medium ${mode === 'receive' ? 'bg-slate-700/50 text-slate-200' : 'text-slate-500'}`}
            >
              Receive
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
                {busy ? <><Spinner /> Creating…</> : 'Add bridge wallet'}
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
            {mode === 'deposit' && (
              <div className="card p-5 space-y-3 bg-emerald-500/5 border-emerald-500/25">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs text-emerald-400/80 mb-0.5">Bridge In — Sepolia USDC</div>
                    <div className="font-mono text-sm text-slate-300">{shortEvmAddr(wallet.evmAddress!)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => refreshBalances()}
                    disabled={balanceLoading}
                    className="text-xs px-2.5 py-1 rounded-md bg-slate-800 text-emerald-400 hover:bg-slate-700 disabled:opacity-40"
                  >
                    {balanceLoading ? '…' : 'Refresh'}
                  </button>
                </div>
                <div>
                  <div className="text-3xl font-bold text-white">
                    {balanceLoading ? '…' : fmtFloor(usdcAvailRaw, 2)}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    Sepolia USDC you lock on-chain — validators mint matching F-USDC to your Falcon wallet
                  </div>
                </div>
                {balanceError && (
                  <p className="text-xs text-amber-400">Sepolia balance lookup failed: {balanceError}</p>
                )}
              </div>
            )}

            {mode === 'withdraw' && (
              <div className="card p-5 space-y-3 bg-amber-500/5 border-amber-500/25">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs text-amber-400/80 mb-0.5">Bridge Out — Falcon F-USDC</div>
                    <div className="font-mono text-xs text-slate-400 break-all">{wallet.address}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { refreshFusdcBalance(); onFalconRefresh?.() }}
                    disabled={fusdcLoading}
                    className="text-xs px-2.5 py-1 rounded-md bg-slate-800 text-amber-400 hover:bg-slate-700 disabled:opacity-40"
                  >
                    {fusdcLoading ? '…' : 'Refresh'}
                  </button>
                </div>
                <div>
                  <div className="text-3xl font-bold text-white">
                    {fusdcLoading ? '…' : fmt(fusdcAvail, 2)}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    Falcon ledger F-USDC you return to the bridge — Sepolia USDC is released to your Sepolia wallet
                  </div>
                </div>
                {fusdcError && (
                  <p className="text-xs text-amber-400">Falcon balance lookup failed: {fusdcError}</p>
                )}
                {fusdcAvail <= 0 && !fusdcLoading && !fusdcError && (
                  <p className="text-xs text-slate-500">
                    Withdraw F-USDC from the{' '}
                    <a href="/pool" className="text-brand-400 hover:text-brand-300">pool</a>
                    {' '}or buy on Swap first.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-4 card p-5 bg-slate-900/40 border-slate-700/80">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs text-slate-500 mb-0.5">Sepolia address</div>
                  <div className="font-mono text-sm text-slate-300">{shortEvmAddr(wallet.evmAddress!)}</div>
                </div>
                <div className="flex items-center gap-1">
                  <CopyButton text={wallet.evmAddress!} label="Copy" />
                  <button
                    type="button"
                    onClick={() => {
                      refreshBalances()
                      if (mode === 'withdraw') refreshFusdcBalance()
                    }}
                    disabled={balanceLoading || fusdcLoading}
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

              {mode !== 'deposit' && (
                <div>
                  <div className="text-xs text-slate-500 mb-1">
                    {mode === 'withdraw' ? 'Sepolia USDC (receive)' : 'Sepolia USDC'}
                  </div>
                  <div className={`font-bold text-white ${mode === 'withdraw' ? 'text-xl' : 'text-3xl'}`}>
                    {balanceLoading ? '…' : balances ? fmt(balances.usdc, 2) : '—'}
                  </div>
                  <div className="text-[10px] text-slate-600 mt-1">
                    {mode === 'withdraw'
                      ? 'Released here after you bridge F-USDC out'
                      : 'Sepolia testnet USDC'}
                  </div>
                </div>
              )}

              <>
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
                  <a
                    href={`${bridgeCfg.sepolia.explorer_url}/address/${wallet.evmAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-brand-400 hover:text-brand-300 inline-block"
                  >
                    Etherscan →
                  </a>
              </>

              {ethAvail < 0.001 && mode === 'deposit' && (
                <p className="text-xs text-amber-400">
                  Need Sepolia ETH for gas.{' '}
                  <a href="https://sepoliafaucet.com" target="_blank" rel="noopener noreferrer" className="underline text-brand-400">
                    Get test ETH
                  </a>
                </p>
              )}
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
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 text-xs text-slate-400">
                  Return F-USDC on Falcon to the bridge issuer. Validators release matching Sepolia USDC
                  to your Sepolia wallet above (usually within a few minutes).
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
                  {busy ? <><Spinner /> {step ?? 'Signing…'}</> : 'Bridge Out F-USDC with Passkey'}
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
              </>
            )}

            {mode === 'deposit' && (
              <>
                {!hasFusdcTrustLine ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
                    <div>
                      <p className="text-sm font-medium text-amber-200">Step 1 — F-USDC trust line required</p>
                      <p className="text-xs text-amber-100/80 mt-1">
                        Bridge In mints F-USDC to your Falcon wallet ({shortFalconAddr(wallet.address)}). Without a
                        trust line to issuer{' '}
                        <span className="font-mono text-amber-100/90">{falconIssuer ? `${falconIssuer.slice(0, 8)}…` : '—'}</span>,
                        the relay cannot deliver tokens — deposits stay queued.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleTrustLine}
                      disabled={busy || !falconIssuer || !network.live}
                      className="w-full py-2.5 rounded-xl bg-amber-500 text-slate-950 text-sm font-semibold hover:bg-amber-400 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {busy ? <><Spinner /> Adding trust line…</> : 'Add F-USDC trust line (passkey)'}
                    </button>
                    {trustLineResult && (
                      <p className={`text-xs ${trustLineResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                        {trustLineResult.msg}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200">
                    F-USDC trust line active — you can bridge in. Minted F-USDC balance:{' '}
                    <span className="font-mono">{fusdcLoading ? '…' : fmt(fusdcAvail, 2)}</span>
                  </div>
                )}

                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 text-xs text-slate-400 space-y-1">
                  <p>Lock Sepolia USDC below → relay mints F-USDC to your Falcon wallet.</p>
                  <p className="text-slate-500">
                    One passkey unlocks your Sepolia wallet. Approve + lock happen on Sepolia automatically
                    (no second passkey) — can take up to a minute. F-USDC mint usually follows within ~30s.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Sepolia USDC to bridge in</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setError(null) }}
                    placeholder="0.00"
                    min="0.000001"
                    step="any"
                    className="input-field"
                    disabled={busy || !bridgeReady || !canBridgeIn}
                  />
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>{balances ? `Available: ${usdcAvailRaw} Sepolia USDC` : ''}</span>
                    {usdcAvail > 0 && canBridgeIn && (
                      <button type="button" onClick={() => setAmount(usdcAvailRaw)} className="text-brand-500">
                        Max
                      </button>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleDeposit}
                  disabled={busy || !bridgeReady || !canBridgeIn || amtNum <= 0 || ethAvail < 0.0001}
                  className="btn-primary flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500"
                >
                  {busy ? <><Spinner /> {step ?? 'Signing…'}</> : 'Bridge In USDC with Passkey'}
                </button>
                {!canBridgeIn && (
                  <p className="text-[10px] text-amber-400/90">Add the F-USDC trust line above to enable Bridge In.</p>
                )}

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

            {mode === 'receive' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">Receive Sepolia ETH or USDC at this address (e.g. from a faucet).</p>
                <div className="bg-white rounded-xl p-3 mx-auto w-fit">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(wallet.evmAddress!)}&size=160x160&margin=0`}
                    alt="Sepolia address QR"
                    width={160}
                    height={160}
                    className="rounded"
                  />
                </div>
                <div className="font-mono text-xs text-slate-300 break-all text-center">{wallet.evmAddress}</div>
                <CopyButton text={wallet.evmAddress!} label="Copy 0x address" />
              </div>
            )}

            {showSendScanner && (
              <AddressQrScanner
                hint="Point at a Sepolia 0x address QR"
                manualHint="Paste the 0x address manually, or allow camera access and retry."
                onScan={(raw) => {
                  setShowSendScanner(false)
                  const addr = parseEvmAddressFromScan(raw)
                  if (!addr) {
                    setError('QR code does not contain a valid 0x address')
                    return
                  }
                  setSendTo(addr)
                  setError(null)
                }}
                onClose={() => setShowSendScanner(false)}
              />
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
                  <div className="flex items-stretch gap-2">
                    <input
                      type="text"
                      value={sendTo}
                      onChange={(e) => { setSendTo(e.target.value); setError(null) }}
                      placeholder="0x…"
                      className="input-field font-mono text-sm flex-1 min-w-0 w-0"
                      disabled={busy}
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={() => { setShowSendScanner(true); setError(null) }}
                      disabled={busy}
                      className="shrink-0 flex flex-col items-center justify-center gap-0.5 min-w-[4.25rem] px-2.5 rounded-xl border border-brand-500/50 bg-brand-500/15 text-brand-400 hover:bg-brand-500/25 hover:text-brand-300 disabled:opacity-40 transition-colors"
                      title="Scan recipient QR code"
                      aria-label="Scan recipient QR code"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                          d="M4 7V4h3M4 17v3h3M17 4h3v3M20 17v3h-3M7 7h3v3H7zm0 7h3v3H7zm7-7h3v3h-3zm0 7h3v3h-3z" />
                      </svg>
                      <span className="text-[10px] font-semibold leading-none">Scan</span>
                    </button>
                  </div>
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
                      {sendAsset === 'eth' ? fmt(ethAvail, 6) + ' ETH' : `${usdcAvailRaw} USDC`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSendAmount(sendAsset === 'eth' ? String(Math.max(0, ethAvail - 0.002)) : usdcAvailRaw)}
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
            Returned {withdrawResult.amount} F-USDC on Falcon. The coordinator relay releases matching{' '}
            <span className="text-emerald-400">Sepolia USDC</span> to{' '}
            <span className="font-mono">{withdrawResult.sepoliaRecipient.slice(0, 10)}…</span> — usually
            within a few minutes. Switch to <span className="text-emerald-400">Bridge In · USDC</span> and
            refresh to see it; use Send Out to move it elsewhere.
          </p>
          {releaseStatus === 'pending' && (
            <div className="flex items-center gap-2 text-xs text-amber-400">
              <Spinner /> Watching Sepolia for the release…
            </div>
          )}
          {releaseStatus === 'released' && (
            <div className="text-xs text-emerald-400">
              ✓ Sepolia USDC released to your address.
            </div>
          )}
          {releaseStatus === 'unconfirmed' && (
            <div className="text-xs text-amber-400">
              Release not detected yet. The relay may still be processing — check your Sepolia USDC
              balance shortly, or contact the operator if it does not arrive.
            </div>
          )}
          <button type="button" onClick={() => { setWithdrawResult(null); setReleaseStatus(null) }} className="text-xs text-brand-400">
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
            Sepolia deposit confirmed. Validators will mint F-USDC to your Falcon wallet in a few minutes —
            refresh your F-USDC balance on the Falcon wallet tab.
          </p>
          <a
            href={`${bridgeCfg.sepolia.explorer_url}/tx/${result.depositHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-brand-400 hover:text-brand-300 inline-block"
          >
            View deposit on Etherscan →
          </a>
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
        <div className="text-slate-400 font-medium">Bridge wallet</div>
        <ol className="list-decimal list-inside space-y-1">
          <li>Created together with your Falcon wallet (one passkey secures both)</li>
          <li>Back up the Sepolia key before switching devices</li>
          <li>Bridge In: lock Sepolia USDC → F-USDC on Falcon</li>
          <li>Bridge Out: return F-USDC → Sepolia USDC released here</li>
          <li>Send / Receive: move Sepolia ETH or USDC from this tab</li>
        </ol>
      </div>
    </div>
  )
}