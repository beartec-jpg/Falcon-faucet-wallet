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
  depositBnbToFbnbBridge,
  depositEthToFethBridge,
  depositUsdcToBridge,
  fetchSepoliaBalances,
  sendSepoliaEth,
  sendSepoliaUsdc,
  waitForWithdrawalRelease,
  type BridgeDepositResult,
} from '@/lib/evm-bridge-client'
import { fetchBnbTestnetBalance } from '@/lib/native-chain-balances'
import { sendBtcP2pkh, fetchBtcBalance } from '@/lib/btc-client'
import { parseEvmAddressFromScan } from '@/lib/parse-evm-address'
import { signBridgeWithdraw, signFusdcPayment, signTrustSet } from '@/lib/wallet-sign-client'

const AddressQrScanner = dynamic(() => import('@/components/AddressQrScanner'), { ssr: false })
import { submitWithSequenceRetry, fetchSequenceInfo, type SubmitResult } from '@/lib/wallet-submit'
import {
  etherscanAddressUrl,
  etherscanTokenUrl,
  fbnbLockReady,
  fethLockReady,
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
  /** Open on Bridge In (deposit) or Bridge Out (withdraw). Default deposit. */
  initialMode?: 'deposit' | 'withdraw' | 'send' | 'receive'
  /** Which bridge route to open (e.g. FETH / FBNB / FBTC from Falcon tab). */
  initialRoute?: 'fusdc-sepolia' | 'feth-sepolia' | 'fbnb-bsc' | 'fbtc-btc'
}

type BridgeMode = 'bridge' | 'send' | 'receive'
type BridgeDirection = 'deposit' | 'withdraw'
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
  initialMode = 'deposit',
  initialRoute = 'fusdc-sepolia',
}: Props) {
  const { networkKey, network } = useNetwork()
  const [balances, setBalances] = useState<{ eth: string; usdc: string } | null>(null)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  // Send/Receive live on Multi-chain tab; bridge panel is In/Out only.
  const [mode, setMode] = useState<BridgeMode>('bridge')
  const [direction, setDirection] = useState<BridgeDirection>(() =>
    initialMode === 'withdraw' ? 'withdraw' : 'deposit',
  )
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
  const [fethLive, setFethLive] = useState<number | null>(null)
  const [hasFethTrustLine, setHasFethTrustLine] = useState(false)
  const [fbnbLive, setFbnbLive] = useState<number | null>(null)
  const [hasFbnbTrustLine, setHasFbnbTrustLine] = useState(false)
  const [bnbBal, setBnbBal] = useState<string | null>(null)
  const [btcBal, setBtcBal] = useState<string | null>(null)
  const [fbtcLive, setFbtcLive] = useState<number | null>(null)
  const [hasFbtcTrustLine, setHasFbtcTrustLine] = useState(false)
  const [fbtcCustody, setFbtcCustody] = useState('mxuamPnEtoMaiRnBnAUnrCZeXTYPVX4hik')
  const [fbtcIssuer, setFbtcIssuer] = useState('rnvzCKcBU7G8Kb9JXHwEKTHiK9aTrZAqWT')
  const [trustLineResult, setTrustLineResult] = useState<{ ok: boolean; msg: string } | null>(null)
  type BridgeRouteId = 'fusdc-sepolia' | 'feth-sepolia' | 'fbnb-bsc' | 'fbtc-btc'
  /** Live bridge routes — honour initialRoute from Falcon / Multi-chain buttons */
  const [bridgeRoute, setBridgeRoute] = useState<BridgeRouteId>(() => {
    if (initialRoute === 'feth-sepolia') return 'feth-sepolia'
    if (initialRoute === 'fbnb-bsc') return 'fbnb-bsc'
    if (initialRoute === 'fbtc-btc') return 'fbtc-btc'
    return 'fusdc-sepolia'
  })

  const bridgeReady = lockContractReady(bridgeCfg)
  const fethReady = fethLockReady(bridgeCfg)
  const fbnbReady = fbnbLockReady(bridgeCfg)
  const fbtcReady = !!(fbtcCustody && fbtcIssuer)
  const hasEvm = !!(wallet.evmAddress && wallet.evmEncrypted)
  const hasBtc = !!(wallet.btcAddress && wallet.btcEncrypted)
  const falconIssuer = bridgeCfg.falcon?.token_issuer?.trim() ?? ''
  const falconCurrency = bridgeCfg.falcon?.token_currency?.trim() ?? 'QUC'
  const fethIssuer = bridgeCfg.feth?.token_issuer?.trim() ?? ''
  const fethCurrency = bridgeCfg.feth?.token_currency?.trim() ?? 'ETH'
  const fbnbIssuer = bridgeCfg.fbnb?.token_issuer?.trim() ?? ''
  const fbnbCurrency = bridgeCfg.fbnb?.token_currency?.trim() ?? 'BNB'
  const isFethRoute = bridgeRoute === 'feth-sepolia'
  const isFbnbRoute = bridgeRoute === 'fbnb-bsc'
  const isFbtcRoute = bridgeRoute === 'fbtc-btc'
  const isWrapRoute = isFethRoute || isFbnbRoute
  const activeIssuer = isFbtcRoute
    ? fbtcIssuer
    : isFbnbRoute
      ? fbnbIssuer
      : isFethRoute
        ? fethIssuer
        : falconIssuer
  const activeCurrency = isFbtcRoute
    ? 'BTC'
    : isFbnbRoute
      ? fbnbCurrency
      : isFethRoute
        ? fethCurrency
        : falconCurrency
  const activeTrust = isFbtcRoute
    ? hasFbtcTrustLine
    : isFbnbRoute
      ? hasFbnbTrustLine
      : isFethRoute
        ? hasFethTrustLine
        : hasFusdcTrustLine
  const activeLockReady = isFbtcRoute
    ? fbtcReady && hasBtc
    : isFbnbRoute
      ? fbnbReady
      : isFethRoute
        ? fethReady
        : bridgeReady
  const canBridgeIn = activeTrust && !!activeIssuer && activeLockReady
  const assetLabel = isFbtcRoute
    ? 'FBTC'
    : isFbnbRoute
      ? 'FBNB'
      : isFethRoute
        ? 'FETH'
        : 'F-USDC'

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
      // FETH / FBNB live in multi-token catalog
      const tokens = (data.assets?.tokens ?? []) as Array<{
        currency?: string
        issuer?: string
        balance?: number
        hasTrustLine?: boolean
        symbol?: string
      }>
      const fethTok =
        tokens.find(
          (t) =>
            t.currency === (bridgeCfg.feth?.token_currency ?? 'ETH') &&
            t.issuer === (bridgeCfg.feth?.token_issuer ?? ''),
        ) || tokens.find((t) => t.symbol === 'FETH' || t.currency === 'ETH')
      if (fethTok) {
        setHasFethTrustLine(!!fethTok.hasTrustLine)
        setFethLive(fethTok.hasTrustLine ? (fethTok.balance ?? 0) : 0)
      } else if (bridgeCfg.feth?.token_issuer) {
        setHasFethTrustLine(false)
        setFethLive(0)
      }
      const fbnbTok =
        tokens.find(
          (t) =>
            t.currency === (bridgeCfg.fbnb?.token_currency ?? 'BNB') &&
            t.issuer === (bridgeCfg.fbnb?.token_issuer ?? ''),
        ) || tokens.find((t) => t.symbol === 'FBNB' || t.currency === 'BNB')
      if (fbnbTok) {
        setHasFbnbTrustLine(!!fbnbTok.hasTrustLine)
        setFbnbLive(fbnbTok.hasTrustLine ? (fbnbTok.balance ?? 0) : 0)
      } else if (bridgeCfg.fbnb?.token_issuer) {
        setHasFbnbTrustLine(false)
        setFbnbLive(0)
      }
      const fbtcTok =
        tokens.find((t) => t.currency === 'BTC' || t.symbol === 'FBTC') ||
        tokens.find((t) => t.issuer === fbtcIssuer)
      if (fbtcTok) {
        setHasFbtcTrustLine(!!fbtcTok.hasTrustLine)
        setFbtcLive(fbtcTok.hasTrustLine ? (fbtcTok.balance ?? 0) : 0)
      } else if (fbtcIssuer) {
        setHasFbtcTrustLine(false)
        setFbtcLive(0)
      }
      onFalconRefresh?.()
    } catch (e: unknown) {
      setFusdcError(e instanceof Error ? e.message : 'Could not load Falcon balances')
    } finally {
      setFusdcLoading(false)
    }
  }, [
    networkKey,
    wallet.address,
    bridgeCfg.feth?.token_currency,
    bridgeCfg.feth?.token_issuer,
    bridgeCfg.fbnb?.token_currency,
    bridgeCfg.fbnb?.token_issuer,
    fbtcIssuer,
  ])

  useEffect(() => {
    if (fusdcBalance != null && fusdcBalance > 0) setFusdcLive(fusdcBalance)
  }, [fusdcBalance])

  useEffect(() => {
    refreshFusdcBalance()
  }, [refreshFusdcBalance])

  useEffect(() => {
    if (mode === 'bridge' && direction === 'withdraw') refreshFusdcBalance()
  }, [mode, direction, refreshFusdcBalance])

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

  useEffect(() => {
    if (!hasEvm || !wallet.evmAddress) return
    if (bridgeRoute !== 'fbnb-bsc') return
    let cancelled = false
    void fetchBnbTestnetBalance(wallet.evmAddress).then((b) => {
      if (!cancelled) setBnbBal(b)
    })
    return () => { cancelled = true }
  }, [hasEvm, wallet.evmAddress, bridgeRoute])

  useEffect(() => {
    let cancelled = false
    void fetch('/api/bridge/btc', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || j.error) return
        if (j.custody_testnet) setFbtcCustody(String(j.custody_testnet))
        if (j.falcon?.token_issuer) setFbtcIssuer(String(j.falcon.token_issuer))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (bridgeRoute !== 'fbtc-btc' || !wallet.btcAddress) return
    let cancelled = false
    void fetchBtcBalance(wallet.btcAddress, 'testnet').then((b) => {
      if (!cancelled) setBtcBal(b?.btc ?? null)
    })
    return () => { cancelled = true }
  }, [bridgeRoute, wallet.btcAddress])

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
    if (!activeIssuer || !network.live) return
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
              currency: activeCurrency,
              issuer: activeIssuer,
              limit: isWrapRoute ? '1000000000' : '10000000',
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
      let msg =
        [data.result, data.message].filter(Boolean).join(' — ') || (ok ? 'Trust line ready' : 'TrustSet failed')
      if (!ok && /tecNO_DST/i.test(msg)) {
        msg =
          `Issuer account not found on this network (${activeIssuer.slice(0, 8)}…). ` +
          `Your Falcon wallet already exists — this is not “need XRP”. ` +
          `Site config must point at the live ${assetLabel} issuer. Hard-refresh after deploy, then try again.`
      } else if (!ok && /XRP/i.test(msg)) {
        msg = msg.replace(/XRP/g, 'FALCON')
      }
      setTrustLineResult({
        ok,
        msg,
      })
      if (ok) {
        if (isFbtcRoute) setHasFbtcTrustLine(true)
        else if (isFbnbRoute) setHasFbnbTrustLine(true)
        else if (isFethRoute) setHasFethTrustLine(true)
        else setHasFusdcTrustLine(true)
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
    if (!activeLockReady) return
    if (!isFbtcRoute && (!wallet.evmEncrypted || !wallet.evmAddress)) return
    if (!canBridgeIn) {
      setError(
        `Add a ${assetLabel} trust line on this page before bridging in — otherwise minted tokens cannot be delivered.`,
      )
      return
    }
    const amt = parseFloat(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setError(
        isFbtcRoute
          ? 'Enter a valid BTC amount'
          : isFbnbRoute
            ? 'Enter a valid BNB amount'
            : isFethRoute
              ? 'Enter a valid ETH amount'
              : 'Enter a valid USDC amount',
      )
      return
    }

    if (isFbtcRoute) {
      if (!wallet.btcEncrypted || !wallet.btcAddress) {
        setError('Bitcoin keys missing — open Multi-chain → BTC once to provision')
        return
      }
      const b = parseFloat(btcBal ?? '0')
      if (Number.isFinite(b) && amt > b) {
        setError(`Insufficient BTC (have ${btcBal ?? '0'})`)
        return
      }
      if (amt < 0.00001) {
        setError('Amount too small')
        return
      }
    } else if (isFbnbRoute) {
      const b = parseFloat(bnbBal ?? '0')
      if (Number.isFinite(b) && amt + 0.002 > b) {
        setError(`Need ${amount} BNB + ~0.002 gas (have ${fmt(b, 6)} BNB)`)
        return
      }
    } else if (isFethRoute) {
      const ethBal = parseFloat(balances?.eth ?? '0')
      if (Number.isFinite(ethBal) && amt + 0.001 > ethBal) {
        setError(`Need ${amount} ETH + ~0.001 gas (have ${fmt(ethBal, 6)} ETH)`)
        return
      }
    } else {
      const availUsdc = parseFloat(balances?.usdc ?? '0')
      if (Number.isFinite(availUsdc) && amt > availUsdc) {
        setError(`Amount exceeds Sepolia USDC balance (${fmt(availUsdc, 4)} available)`)
        return
      }
    }

    setBusy(true)
    setError(null)
    setResult(null)
    setStep(null)

    try {
      setStep(
        isFbtcRoute
          ? 'Confirm passkey — send BTC and mint FBTC…'
          : 'Confirm passkey to unlock multi-chain EVM wallet…',
      )
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)

      if (isFbtcRoute) {
        setStep('Sending BTC to bridge custody…')
        const btcPk = (await decryptSeed(wallet.btcEncrypted!, keyBytes)).replace(/^0x/i, '')
        const amountSats = Math.round(amt * 1e8)
        const sent = await sendBtcP2pkh({
          privateKeyHex: btcPk,
          toAddress: fbtcCustody,
          amountBtc: amount.trim(),
          network: 'testnet',
        })
        setStep('Registering deposit for FBTC mint…')
        const claimR = await fetch('/api/bridge/btc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            falcon_account: wallet.address,
            btc_txid: sent.txid,
            amount_sats: amountSats,
          }),
        })
        const claimJ = (await claimR.json()) as { error?: string; message?: string }
        if (!claimR.ok) {
          throw new Error(
            claimJ.error ||
              `BTC sent (${sent.txid}) but claim failed — contact ops with txid`,
          )
        }
        setResult({
          depositHash: sent.txid,
          depositId: claimJ.message || sent.txid,
        })
        setAmount('')
        if (wallet.btcAddress) {
          void fetchBtcBalance(wallet.btcAddress, 'testnet').then((b) => setBtcBal(b?.btc ?? null))
        }
        setTimeout(() => {
          refreshFusdcBalance()
          onFalconRefresh?.()
        }, 15_000)
        setStep(null)
        setBusy(false)
        return
      }

      setStep(
        isFbnbRoute
          ? 'Passkey OK — wrap BNB → WBNB + lock on BSC (may take ~1–2 min)…'
          : isFethRoute
            ? 'Passkey OK — wrap ETH → WETH + lock (may take ~1–2 min)…'
            : 'Passkey OK — submitting Sepolia txs (approve + lock, may take ~1 min)…',
      )
      const evmPrivateKey = await decryptSeed(wallet.evmEncrypted!, keyBytes)

      let res: BridgeDepositResult
      if (isFbnbRoute) {
        const bsc = bridgeCfg.bsc_testnet
        if (!bsc?.lock_contract || !bsc.wbnb_token) {
          throw new Error('FBNB lock not deployed yet — try again shortly')
        }
        res = await depositBnbToFbnbBridge({
          rpcUrl: bsc.rpc_url,
          wbnbToken: bsc.wbnb_token,
          lockContract: bsc.lock_contract,
          wbnbDecimals: bsc.wbnb_decimals ?? 18,
          evmPrivateKey,
          amountBnb: amount,
          falconAccount: wallet.address,
          onStep: setStep,
        })
      } else if (isFethRoute) {
        res = await depositEthToFethBridge({
          cfg: bridgeCfg.sepolia,
          evmPrivateKey,
          amountEth: amount,
          falconAccount: wallet.address,
          onStep: setStep,
        })
      } else {
        res = await depositUsdcToBridge({
          cfg: bridgeCfg.sepolia,
          evmPrivateKey,
          amountUsdc: amount,
          falconAccount: wallet.address,
          onStep: setStep,
        })
      }

      setResult(res)
      setAmount('')
      await refreshBalances()
      if (wallet.evmAddress) {
        void fetchBnbTestnetBalance(wallet.evmAddress).then(setBnbBal)
      }
      setTimeout(() => {
        refreshFusdcBalance()
        onFalconRefresh?.()
      }, 8000)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Bridge deposit failed'
      setError(
        /Failed to fetch|NetworkError|Load failed/i.test(msg)
          ? 'Network blocked mid-bridge. Hard-refresh and try again. If BTC already left your wallet, keep the txid for a manual claim.'
          : msg,
      )
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

  const routeTitleIn = isFbtcRoute
    ? 'Bridge In — BTC → FBTC'
    : isFbnbRoute
      ? 'Bridge In — BNB → FBNB'
      : isFethRoute
        ? 'Bridge In — ETH → FETH'
        : 'Bridge In — USDC → F-USDC'
  const routeTitleOut = isWrapRoute || isFbtcRoute
    ? `Bridge Out — ${assetLabel} (soon)`
    : 'Bridge Out — F-USDC → USDC'
  const sourceAvailLabel = isFbtcRoute
    ? `${btcBal != null ? Number(btcBal).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'} BTC`
    : isFbnbRoute
      ? `${bnbBal != null ? fmt(bnbBal, 6) : '—'} BNB`
      : isFethRoute
        ? `${balanceLoading ? '…' : balances ? fmt(balances.eth, 6) : '—'} ETH`
        : `${balanceLoading ? '…' : balances ? fmtFloor(usdcAvailRaw, 2) : '—'} USDC`
  const falconAvailLabel = isFbtcRoute
    ? `${fusdcLoading ? '…' : fmt(fbtcLive ?? 0, 8)} FBTC`
    : isFbnbRoute
      ? `${fusdcLoading ? '…' : fmt(fbnbLive ?? 0, 6)} FBNB`
      : isFethRoute
        ? `${fusdcLoading ? '…' : fmt(fethLive ?? 0, 6)} FETH`
        : `${fusdcLoading ? '…' : fmt(fusdcAvail, 2)} F-USDC`
  const bnbAvail = bnbBal != null ? parseFloat(bnbBal) : 0
  const btcAvail = btcBal != null ? parseFloat(btcBal) : 0
  const canUseBridge = hasEvm || (isFbtcRoute && hasBtc)

  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white">Bridge</h2>
          <p className="text-xs text-slate-400 mt-1">
            Lock on the source chain → mint the F-asset on Falcon. Deposit wallets live under{' '}
            <strong className="text-slate-300">Multi-chain</strong>.
          </p>
        </div>

        <div className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5">
          <span className="font-semibold">Testnet · custodial bridge.</span> Mint and release use an off-chain
          relay + multi-sig lock — not fully trustless.
        </div>

        {/* 1) Direction */}
        {(hasEvm || hasBtc) && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">1 · Direction</div>
            <div className="flex rounded-xl overflow-hidden border border-slate-700 text-sm">
              <button
                type="button"
                onClick={() => { setMode('bridge'); setDirection('deposit'); setError(null) }}
                className={`flex-1 py-2.5 font-semibold ${direction === 'deposit' ? 'bg-emerald-500/15 text-emerald-400' : 'text-slate-500'}`}
              >
                In
              </button>
              <button
                type="button"
                onClick={() => {
                  if (isWrapRoute || isFbtcRoute) {
                    setError(`${assetLabel} Bridge Out is not enabled yet — deposit mint is live`)
                    return
                  }
                  setMode('bridge')
                  setDirection('withdraw')
                  setError(null)
                  refreshFusdcBalance()
                }}
                className={`flex-1 py-2.5 font-semibold ${direction === 'withdraw' ? 'bg-amber-500/15 text-amber-400' : 'text-slate-500'}`}
              >
                Out
              </button>
            </div>
          </div>
        )}

        {/* 2) Asset route */}
        {(hasEvm || hasBtc) && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">2 · Asset</div>
            <select
              className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2.5 text-sm text-slate-100"
              value={bridgeRoute}
              onChange={(e) => {
                const v = e.target.value as BridgeRouteId
                setBridgeRoute(v)
                setError(null)
                setResult(null)
                setAmount('')
                setWithdrawAmount('')
                setTrustLineResult(null)
                if (
                  (v === 'feth-sepolia' || v === 'fbnb-bsc' || v === 'fbtc-btc') &&
                  direction === 'withdraw'
                ) {
                  setDirection('deposit')
                }
              }}
            >
              <option value="fusdc-sepolia" disabled={!hasEvm}>
                {direction === 'deposit' ? 'USDC → F-USDC' : 'F-USDC → USDC'}
              </option>
              <option value="feth-sepolia" disabled={!fethReady || !hasEvm}>
                {fethReady ? 'ETH → FETH' : 'ETH → FETH (config missing)'}
              </option>
              <option value="fbnb-bsc" disabled={!fbnbReady || !hasEvm}>
                {fbnbReady ? 'BNB → FBNB' : 'BNB → FBNB (deploying lock…)'}
              </option>
              <option value="fbtc-btc" disabled={!fbtcReady || !hasBtc}>
                {!hasBtc
                  ? 'BTC → FBTC (open Multi-chain BTC first)'
                  : fbtcReady
                    ? 'BTC → FBTC'
                    : 'BTC → FBTC (config missing)'}
              </option>
            </select>
          </div>
        )}

        {(hasEvm || hasBtc) && !activeLockReady && (
          <div className="text-xs text-amber-400 bg-amber-500/10 rounded-xl px-3 py-2.5">
            {isFbtcRoute
              ? !hasBtc
                ? 'Provision BTC keys on Multi-chain, then return here for BTC → FBTC.'
                : 'FBTC bridge config missing.'
              : isFbnbRoute
                ? 'FBNB lock is deploying on BSC testnet — fund deployer gas if prompted, then hard-refresh.'
                : isFethRoute
                  ? 'FETH lock contract not configured.'
                  : 'USDC lock contract not configured. Set SEPOLIA_LOCK_CONTRACT in deployment env.'}
          </div>
        )}

        {!hasEvm && !(isFbtcRoute && hasBtc) ? (
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
            {/* Route summary — only the selected asset */}
            {direction === 'deposit' && (
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-emerald-300">{routeTitleIn}</div>
                  <button
                    type="button"
                    onClick={() => { refreshBalances(); refreshFusdcBalance() }}
                    disabled={balanceLoading || fusdcLoading}
                    className="text-xs px-2.5 py-1 rounded-md bg-slate-800 text-emerald-400 hover:bg-slate-700 disabled:opacity-40"
                  >
                    {balanceLoading || fusdcLoading ? '…' : 'Refresh'}
                  </button>
                </div>
                <div className="text-2xl font-bold text-white font-mono">{sourceAvailLabel}</div>
                <p className="text-[11px] text-slate-500 leading-snug">
                  {isFbtcRoute
                    ? 'One action: passkey sends your multi-chain BTC to bridge custody and mints FBTC. No WBTC in the wallet.'
                    : isFbnbRoute
                      ? 'Available BNB on Multi-chain (wrap + lock on BSC testnet → mint FBNB). Keep ~0.002 BNB for gas.'
                      : isFethRoute
                        ? 'Available ETH on Multi-chain (wrap + lock → mint FETH). Keep ~0.001 ETH for gas.'
                        : 'Available USDC on Multi-chain (lock → mint F-USDC). Needs a little ETH for gas.'}
                </p>
                {isFbtcRoute && btcAvail <= 0 && (
                  <p className="text-xs text-amber-400">
                    No testnet BTC — Multi-chain → BTC → Receive, fund from a BTC testnet faucet.
                  </p>
                )}
                {isFbnbRoute && bnbAvail < 0.002 && (
                  <p className="text-xs text-amber-400">
                    Low BSC testnet BNB — fund Multi-chain BNB (Receive) from a testnet faucet.
                  </p>
                )}
                {!isFbnbRoute && !isFbtcRoute && ethAvail < 0.001 && (
                  <p className="text-xs text-amber-400">
                    Low gas ETH — fund on Multi-chain or a{' '}
                    <a href="https://sepoliafaucet.com" target="_blank" rel="noopener noreferrer" className="underline text-brand-400">
                      Sepolia faucet
                    </a>
                    .
                  </p>
                )}
                {balanceError && (
                  <p className="text-xs text-amber-400">Balance lookup failed: {balanceError}</p>
                )}
              </div>
            )}

            {direction === 'withdraw' && (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-amber-300">{routeTitleOut}</div>
                  <button
                    type="button"
                    onClick={() => { refreshFusdcBalance(); onFalconRefresh?.() }}
                    disabled={fusdcLoading}
                    className="text-xs px-2.5 py-1 rounded-md bg-slate-800 text-amber-400 hover:bg-slate-700 disabled:opacity-40"
                  >
                    {fusdcLoading ? '…' : 'Refresh'}
                  </button>
                </div>
                <div className="text-2xl font-bold text-white font-mono">{falconAvailLabel}</div>
                <p className="text-[11px] text-slate-500 leading-snug">
                  Falcon balance returned to the bridge; USDC is released to your Multi-chain ETH wallet.
                </p>
                {fusdcError && (
                  <p className="text-xs text-amber-400">Falcon balance lookup failed: {fusdcError}</p>
                )}
              </div>
            )}

            {direction === 'withdraw' && (
              <>
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 text-xs text-slate-400">
                  Return F-USDC on Falcon to the bridge issuer. Validators release matching Sepolia USDC
                  to your Sepolia wallet above (usually within a few minutes).
                </div>
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">3 · Amount</div>
                  <label className="text-xs text-slate-400">F-USDC to burn (Falcon Wallet) → USDC to ETH wallet</label>
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
                  Release target (multi-chain ETH wallet):{' '}
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
                  {busy ? <><Spinner /> {step ?? 'Signing…'}</> : 'Bridge'}
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

            {mode === 'bridge' && direction === 'deposit' && (
              <>
                {!activeTrust ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
                    <div>
                      <p className="text-sm font-medium text-amber-200">
                        Step 1 — {assetLabel} trust line required
                      </p>
                      <p className="text-xs text-amber-100/80 mt-1">
                        Bridge In mints {assetLabel} to your Falcon wallet (
                        {shortFalconAddr(wallet.address)}). Without a trust line to issuer{' '}
                        <span className="font-mono text-amber-100/90">
                          {activeIssuer ? `${activeIssuer.slice(0, 8)}…` : '—'}
                        </span>
                        , the relay cannot deliver tokens — deposits stay queued.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleTrustLine}
                      disabled={busy || !activeIssuer || !network.live}
                      className="w-full py-2.5 rounded-xl bg-amber-500 text-slate-950 text-sm font-semibold hover:bg-amber-400 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {busy ? (
                        <><Spinner /> Adding trust line…</>
                      ) : (
                        `Add ${assetLabel} trust line (passkey)`
                      )}
                    </button>
                    {trustLineResult && (
                      <p className={`text-xs ${trustLineResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                        {trustLineResult.msg}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200">
                    {assetLabel} trust line active — you can bridge in. Balance:{' '}
                    <span className="font-mono">
                      {fusdcLoading
                        ? '…'
                        : isFbtcRoute
                          ? fmt(fbtcLive ?? 0, 8)
                          : isFbnbRoute
                            ? fmt(fbnbLive ?? 0, 6)
                            : isFethRoute
                              ? fmt(fethLive ?? 0, 6)
                              : fmt(fusdcAvail, 2)}
                    </span>
                  </div>
                )}

                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 text-xs text-slate-400 space-y-1">
                  {isFbtcRoute ? (
                    <>
                      <p>BTC → FBTC: send from Multi-chain BTC to custody, then mint on Falcon.</p>
                      <p className="text-slate-500">
                        Looks like one bridge. Under the hood: native testnet BTC only — no WBTC asset.
                      </p>
                    </>
                  ) : isFbnbRoute ? (
                    <>
                      <p>Wrap BSC testnet BNB → WBNB, lock → relay mints FBNB 1:1.</p>
                      <p className="text-slate-500">Wrap + approve + lock ~1–2 min; mint usually ~30s after.</p>
                    </>
                  ) : isFethRoute ? (
                    <>
                      <p>Wrap Sepolia ETH → WETH, lock → relay mints FETH 1:1.</p>
                      <p className="text-slate-500">Wrap + approve + lock ~1–2 min; mint usually ~30s after.</p>
                    </>
                  ) : (
                    <>
                      <p>Lock Sepolia USDC → relay mints F-USDC 1:1.</p>
                      <p className="text-slate-500">Approve + lock on Sepolia; mint usually ~30s after.</p>
                    </>
                  )}
                </div>
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">3 · Amount</div>
                  <label className="text-xs text-slate-400">
                    {isFbtcRoute
                      ? 'BTC to bridge (Multi-chain BTC wallet)'
                      : isFbnbRoute
                        ? 'BNB to wrap + lock (Multi-chain BNB wallet)'
                        : isFethRoute
                          ? 'ETH to wrap + lock (Multi-chain ETH wallet)'
                          : 'USDC to lock (Multi-chain ETH wallet)'}
                  </label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setError(null) }}
                    placeholder="0.00"
                    min="0.000001"
                    step="any"
                    className="input-field"
                    disabled={busy || !activeLockReady || !canBridgeIn}
                  />
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>
                      {isFbtcRoute
                        ? `Available: ${btcBal != null ? btcBal : '—'} BTC (leave fee room)`
                        : isFbnbRoute
                          ? `Available: ${bnbBal != null ? fmt(bnbBal, 6) : '—'} BNB (keep ~0.002 gas)`
                          : balances
                            ? isFethRoute
                              ? `Available: ${fmt(ethAvail, 6)} ETH (keep ~0.001 for gas)`
                              : `Available: ${usdcAvailRaw} USDC · gas ${fmt(ethAvail, 5)} ETH`
                            : ''}
                    </span>
                    {canBridgeIn && (
                      isFbtcRoute
                        ? btcAvail > 0.00005 && (
                            <button
                              type="button"
                              onClick={() =>
                                setAmount(Math.max(0, btcAvail - 0.00002).toFixed(8))
                              }
                              className="text-brand-500"
                            >
                              Max
                            </button>
                          )
                        : isFbnbRoute
                          ? bnbAvail > 0.003 && (
                              <button
                                type="button"
                                onClick={() => setAmount(String(Math.max(0, bnbAvail - 0.0025)))}
                                className="text-brand-500"
                              >
                                Max
                              </button>
                            )
                          : isFethRoute
                            ? ethAvail > 0.002 && (
                                <button
                                  type="button"
                                  onClick={() => setAmount(String(Math.max(0, ethAvail - 0.0015)))}
                                  className="text-brand-500"
                                >
                                  Max
                                </button>
                              )
                            : usdcAvail > 0 && (
                                <button type="button" onClick={() => setAmount(usdcAvailRaw)} className="text-brand-500">
                                  Max
                                </button>
                              )
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleDeposit}
                  disabled={
                    busy ||
                    !activeLockReady ||
                    !canBridgeIn ||
                    amtNum <= 0 ||
                    (isFbtcRoute
                      ? btcAvail < 0.00005
                      : isFbnbRoute
                        ? bnbAvail < 0.0025
                        : ethAvail < (isFethRoute ? 0.0015 : 0.0001))
                  }
                  className="btn-primary flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500"
                >
                  {busy ? <><Spinner /> {step ?? 'Signing…'}</> : isFbtcRoute ? 'Bridge BTC → FBTC' : 'Bridge'}
                </button>
                {!canBridgeIn && (
                  <p className="text-[10px] text-amber-400/90">
                    Add the {assetLabel} trust line above to enable Bridge In.
                  </p>
                )}

                {activeLockReady && !isFbtcRoute && (
                  <div className="text-[10px] text-slate-500">
                    Lock contract:{' '}
                    <a
                      href={etherscanAddressUrl(
                        isFbnbRoute
                          ? (bridgeCfg.bsc_testnet?.explorer_url || 'https://testnet.bscscan.com')
                          : bridgeCfg.sepolia.explorer_url,
                        isFbnbRoute
                          ? (bridgeCfg.bsc_testnet?.lock_contract || '')
                          : isFethRoute
                            ? (bridgeCfg.sepolia.weth_lock_contract || '')
                            : bridgeCfg.sepolia.lock_contract,
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-400 hover:text-brand-300 font-mono"
                    >
                      {(isFbnbRoute
                        ? bridgeCfg.bsc_testnet?.lock_contract
                        : isFethRoute
                          ? bridgeCfg.sepolia.weth_lock_contract
                          : bridgeCfg.sepolia.lock_contract
                      )?.slice(0, 10)}
                      …
                    </a>
                  </div>
                )}
                {isFbtcRoute && fbtcReady && (
                  <div className="text-[10px] text-slate-500 font-mono break-all">
                    Custody (auto): {fbtcCustody}
                  </div>
                )}
              </>
            )}

          </div>
        )}
      </div>

      {withdrawResult && (
        <div className="card p-4 space-y-2 border border-amber-500/20">
          <div className="text-sm font-medium text-amber-400">Bridge-out submitted on Falcon</div>
          {withdrawResult.falconTxHash && (
            <div className="text-xs text-slate-400 break-all">Falcon tx: {withdrawResult.falconTxHash}</div>
          )}
          <p className="text-xs text-slate-500">
            Returned {withdrawResult.amount} F-USDC. Matching USDC is released to your Multi-chain ETH wallet
            (usually within a few minutes).
          </p>
          {releaseStatus === 'pending' && (
            <div className="flex items-center gap-2 text-xs text-amber-400">
              <Spinner /> Watching for release…
            </div>
          )}
          {releaseStatus === 'released' && (
            <div className="text-xs text-emerald-400">✓ USDC released to your Multi-chain ETH wallet.</div>
          )}
          {releaseStatus === 'unconfirmed' && (
            <div className="text-xs text-amber-400">
              Release not detected yet — check Multi-chain ETH USDC shortly.
            </div>
          )}
          <button type="button" onClick={() => { setWithdrawResult(null); setReleaseStatus(null) }} className="text-xs text-brand-400">
            Dismiss
          </button>
        </div>
      )}

      {result && (
        <div className="card p-4 space-y-2 border border-emerald-500/20">
          <div className="text-sm font-medium text-emerald-400">
            {isFbtcRoute ? 'BTC sent — FBTC mint pending' : `${assetLabel} deposit submitted`}
          </div>
          {result.approveHash && (
            <div className="text-xs text-slate-400 break-all">Approve: {result.approveHash}</div>
          )}
          <div className="text-xs text-slate-400 break-all">
            {isFbtcRoute ? 'BTC tx' : 'Deposit'}: {result.depositHash}
          </div>
          {result.depositId && !isFbtcRoute && (
            <div className="text-xs text-slate-400 break-all">Deposit ID: {result.depositId}</div>
          )}
          <p className="text-xs text-slate-500">
            {isFbtcRoute
              ? 'Custody payment registered. Relay mints FBTC after the BTC tx is seen (often under a minute on testnet). Refresh Falcon tab for FBTC.'
              : `Lock confirmed. Relay mints ${assetLabel} to your Falcon wallet in ~30s — refresh the Falcon tab.`}
          </p>
          <a
            href={
              isFbtcRoute
                ? `https://mempool.space/testnet/tx/${result.depositHash}`
                : `${
                    isFbnbRoute
                      ? (bridgeCfg.bsc_testnet?.explorer_url || 'https://testnet.bscscan.com')
                      : bridgeCfg.sepolia.explorer_url
                  }/tx/${result.depositHash}`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-brand-400 hover:text-brand-300 inline-block"
          >
            View on explorer →
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

      <div className="card p-4 text-xs text-slate-500 space-y-1.5">
        <div className="text-slate-400 font-medium">How it works</div>
        <ul className="list-disc list-inside space-y-1">
          <li>Pick <strong className="text-slate-400">In</strong> or <strong className="text-slate-400">Out</strong>, then the asset</li>
          <li>
            <strong className="text-slate-400">USDC → F-USDC</strong>,{' '}
            <strong className="text-slate-400">ETH → FETH</strong>,{' '}
            <strong className="text-slate-400">BNB → FBNB</strong>,{' '}
            <strong className="text-slate-400">BTC → FBTC</strong> (no WBTC in UI)
          </li>
          <li>Fund / send / receive on the <strong className="text-slate-400">Multi-chain</strong> tab</li>
        </ul>
      </div>
    </div>
  )
}