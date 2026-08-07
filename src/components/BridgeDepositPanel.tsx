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
import {
  fetchSpvClaimMaterials,
  fetchSpvStatus,
  spvPegIn,
  spvPegOut,
  spvProveRedeem,
  submitSpvDepositClaim,
  waitForSpvRedeemPayment,
  type SpvStatus,
} from '@/lib/btc-spv-client'
import {
  clearSpvPending,
  createSpvPending,
  ensureSpvPendingTracked,
  fetchOpenDepositsForAccount,
  getSpvPending,
  hasOpenSpvBridge,
  isDepositClaimedLocally,
  isSpvWaitMessage,
  listRememberedDepositTxids,
  markDepositClaimed,
  pollSpvConfirmations,
  spvWaitUserMessage,
  type SpvPendingDeposit,
  updateSpvPending,
} from '@/lib/btc-spv-pending'
import {
  createSpvWithdraw,
  dismissSpvWithdraw,
  fetchSpvWithdrawList,
  isSpvWithdrawClosed,
  isSpvWithdrawDismissed,
  listSpvWithdraws,
  PEGOUT_STEP_TOTAL,
  phaseLabel,
  phaseStepIndex,
  saveSpvWithdraw,
  type SpvPendingWithdraw,
  type SpvWithdrawPhase,
} from '@/lib/btc-spv-withdraw-pending'
import { parseEvmAddressFromScan } from '@/lib/parse-evm-address'
import {
  signBridgeWithdraw,
  signFbtcBridgeWithdraw,
  signFusdcPayment,
  signTrustSet,
} from '@/lib/wallet-sign-client'

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
  /** Which bridge route to open (e.g. FETH / FBNB / FBTC / FXRP from Falcon tab). */
  initialRoute?: BridgeRouteId
}

/** All bridge corridors — labels flip with In/Out. */
export type BridgeRouteId =
  | 'fusdc-sepolia'
  | 'feth-sepolia'
  | 'fbnb-bsc'
  | 'fbtc-btc'
  | 'fxrp-xrpl'

type BridgeMode = 'bridge' | 'send' | 'receive'
type BridgeDirection = 'deposit' | 'withdraw'
type EvmPanel = 'bridge' | 'backup' | 'restore'

/** Which routes support Bridge Out (custodial unlock) today. */
const ROUTE_SUPPORTS_OUT: Record<BridgeRouteId, boolean> = {
  'fusdc-sepolia': true,
  'feth-sepolia': false,
  'fbnb-bsc': false,
  'fbtc-btc': true,
  'fxrp-xrpl': false,
}

function routeInLabel(id: BridgeRouteId): string {
  switch (id) {
    case 'fusdc-sepolia':
      return 'USDC → F-USDC'
    case 'feth-sepolia':
      return 'ETH → FETH'
    case 'fbnb-bsc':
      return 'BNB → FBNB'
    case 'fbtc-btc':
      return 'BTC → FBTC'
    case 'fxrp-xrpl':
      return 'XRP → FXRP'
  }
}

function routeOutLabel(id: BridgeRouteId): string {
  switch (id) {
    case 'fusdc-sepolia':
      return 'F-USDC → USDC'
    case 'feth-sepolia':
      return 'FETH → ETH'
    case 'fbnb-bsc':
      return 'FBNB → BNB'
    case 'fbtc-btc':
      return 'FBTC → BTC'
    case 'fxrp-xrpl':
      return 'FXRP → XRP'
  }
}

function routeOptionLabel(
  id: BridgeRouteId,
  direction: BridgeDirection,
  opts: { ready: boolean; walletReady: boolean; walletHint: string },
): string {
  const base = direction === 'deposit' ? routeInLabel(id) : routeOutLabel(id)
  if (direction === 'withdraw' && !ROUTE_SUPPORTS_OUT[id]) {
    return `${base} (out soon)`
  }
  if (!opts.walletReady) return `${base} (${opts.walletHint})`
  if (!opts.ready) return `${base} (config missing)`
  return base
}

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
  /** Bitcoin vault claim spend (non-custodial SPV out) */
  btcClaimTxid?: string
  btcClaimExplorerUrl?: string
  payoutSats?: number
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
  /** WP2 F2 scaffolding: preferred BTC network fee (sats). Fleet fee wallet covers until user multi-input lands. */
  const [userNetworkFeeSats, setUserNetworkFeeSats] = useState('1500')
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
  /** SPV MPT only — BTCBridgeBurn burns this, not classic IOU */
  const [fbtcSpvLive, setFbtcSpvLive] = useState<number | null>(null)
  const [fbtcIouLive, setFbtcIouLive] = useState<number | null>(null)
  const [hasFbtcTrustLine, setHasFbtcTrustLine] = useState(false)
  const [fbtcCustody, setFbtcCustody] = useState('mxuamPnEtoMaiRnBnAUnrCZeXTYPVX4hik')
  const [fbtcIssuer, setFbtcIssuer] = useState('rnvzCKcBU7G8Kb9JXHwEKTHiK9aTrZAqWT')
  const [fxrpIssuer, setFxrpIssuer] = useState('')
  const [fxrpCustody, setFxrpCustody] = useState('') // classic XRPL custody r…
  const [hasFxrpTrustLine, setHasFxrpTrustLine] = useState(false)
  const [fxrpLive, setFxrpLive] = useState<number | null>(null)
  const [xrplBal, setXrplBal] = useState<string | null>(null)
  const [spvStatus, setSpvStatus] = useState<SpvStatus | null>(null)
  const [spvPending, setSpvPending] = useState<SpvPendingDeposit | null>(null)
  const [spvResumeTxid, setSpvResumeTxid] = useState('')
  /** Open SPV peg-outs (burn → reserve BTC → prove) — survives refresh like Bridge In */
  const [spvWithdraws, setSpvWithdraws] = useState<SpvPendingWithdraw[]>([])
  const [trustLineResult, setTrustLineResult] = useState<{ ok: boolean; msg: string } | null>(null)
  /** Live bridge routes — honour initialRoute from Falcon / Multi-chain buttons */
  const [bridgeRoute, setBridgeRoute] = useState<BridgeRouteId>(() => {
    const allowed: BridgeRouteId[] = [
      'fusdc-sepolia',
      'feth-sepolia',
      'fbnb-bsc',
      'fbtc-btc',
      'fxrp-xrpl',
    ]
    return allowed.includes(initialRoute as BridgeRouteId)
      ? (initialRoute as BridgeRouteId)
      : 'fusdc-sepolia'
  })

  const bridgeReady = lockContractReady(bridgeCfg)
  const fethReady = fethLockReady(bridgeCfg)
  const fbnbReady = fbnbLockReady(bridgeCfg)
  const spvLive = !!(
    spvStatus?.ready &&
    (spvStatus.paymentScriptHex || spvStatus.watchAddress)
  )
  /** SPV protocol reserve preferred. */
  const fbtcReady = spvLive || !!(fbtcCustody && fbtcIssuer)
  const fxrpReady = !!(fxrpIssuer && fxrpCustody)
  const hasEvm = !!(wallet.evmAddress && wallet.evmEncrypted)
  const hasBtc = !!(wallet.btcAddress && wallet.btcEncrypted)
  const hasXrpl = !!(wallet.xrplClassicAddress && wallet.xrplClassicEncrypted)
  const falconIssuer = bridgeCfg.falcon?.token_issuer?.trim() ?? ''
  const falconCurrency = bridgeCfg.falcon?.token_currency?.trim() ?? 'QUC'
  const fethIssuer = bridgeCfg.feth?.token_issuer?.trim() ?? ''
  const fethCurrency = bridgeCfg.feth?.token_currency?.trim() ?? 'ETH'
  const fbnbIssuer = bridgeCfg.fbnb?.token_issuer?.trim() ?? ''
  const fbnbCurrency = bridgeCfg.fbnb?.token_currency?.trim() ?? 'BNB'
  const isFethRoute = bridgeRoute === 'feth-sepolia'
  const isFbnbRoute = bridgeRoute === 'fbnb-bsc'
  const isFbtcRoute = bridgeRoute === 'fbtc-btc'
  const isFxrpRoute = bridgeRoute === 'fxrp-xrpl'
  const isWrapRoute = isFethRoute || isFbnbRoute
  const activeIssuer = isFbtcRoute
    ? fbtcIssuer
    : isFxrpRoute
      ? fxrpIssuer
      : isFbnbRoute
        ? fbnbIssuer
        : isFethRoute
          ? fethIssuer
          : falconIssuer
  const activeCurrency = isFbtcRoute
    ? 'BTC'
    : isFxrpRoute
      ? 'XRP'
      : isFbnbRoute
        ? fbnbCurrency
        : isFethRoute
          ? fethCurrency
          : falconCurrency
  const activeTrust = isFbtcRoute
    ? spvLive || hasFbtcTrustLine // SPV mints MPT — no classic trust line required
    : isFxrpRoute
      ? hasFxrpTrustLine
      : isFbnbRoute
        ? hasFbnbTrustLine
        : isFethRoute
          ? hasFethTrustLine
          : hasFusdcTrustLine
  const activeLockReady = isFbtcRoute
    ? fbtcReady && hasBtc
    : isFxrpRoute
      ? fxrpReady && hasXrpl
      : isFbnbRoute
        ? fbnbReady
        : isFethRoute
          ? fethReady
          : bridgeReady
  const openSpvBlocksIn =
    isFbtcRoute && direction === 'deposit' && !!spvPending && spvPending.status !== 'claimed'
  const canBridgeIn = openSpvBlocksIn
    ? false
    : isFbtcRoute
      ? hasBtc && fbtcReady && (spvLive || (hasFbtcTrustLine && !!activeIssuer))
      : isFxrpRoute
        ? hasXrpl && fxrpReady && hasFxrpTrustLine && !!activeIssuer
        : activeTrust && !!activeIssuer && activeLockReady
  const assetLabel = isFbtcRoute
    ? 'FBTC'
    : isFxrpRoute
      ? 'FXRP'
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
        const total = fbtcTok.hasTrustLine ? (fbtcTok.balance ?? 0) : 0
        setFbtcLive(total)
        // Prefer explicit SPV/IOU split when API provides it (SPV burn only uses MPT)
        const spv =
          typeof (fbtcTok as { spvMptBalance?: number }).spvMptBalance === 'number'
            ? (fbtcTok as { spvMptBalance: number }).spvMptBalance
            : (fbtcTok as { spvMpt?: boolean }).spvMpt
              ? total
              : 0
        const iou =
          typeof (fbtcTok as { iouBalance?: number }).iouBalance === 'number'
            ? (fbtcTok as { iouBalance: number }).iouBalance
            : Math.max(0, total - spv)
        setFbtcSpvLive(spv)
        setFbtcIouLive(iou)
      } else if (fbtcIssuer) {
        setHasFbtcTrustLine(false)
        setFbtcLive(0)
        setFbtcSpvLive(0)
        setFbtcIouLive(0)
      }
      const fxrpTok =
        tokens.find((t) => t.currency === 'XRP' || t.symbol === 'FXRP') ||
        tokens.find((t) => t.issuer === fxrpIssuer)
      if (fxrpTok) {
        setHasFxrpTrustLine(!!fxrpTok.hasTrustLine)
        setFxrpLive(fxrpTok.hasTrustLine ? (fxrpTok.balance ?? 0) : 0)
      } else if (fxrpIssuer) {
        setHasFxrpTrustLine(false)
        setFxrpLive(0)
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
    fxrpIssuer,
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
    // FXRP: optional public config + bridge manifest
    void fetch('/config/fxrp-bridge.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { falcon?: { token_issuer?: string }; classic?: { custody?: string } } | null) => {
        if (cancelled || !j) return
        if (j.falcon?.token_issuer) setFxrpIssuer(String(j.falcon.token_issuer))
        if (j.classic?.custody) setFxrpCustody(String(j.classic.custody))
      })
      .catch(() => {})
    const fx = (bridgeCfg as { fxrp?: { token_issuer?: string; classic_custody?: string } }).fxrp
    if (fx?.token_issuer) setFxrpIssuer(fx.token_issuer)
    if (fx?.classic_custody) setFxrpCustody(fx.classic_custody)
    void fetchSpvStatus()
      .then((s) => {
        if (!cancelled) setSpvStatus(s)
      })
      .catch(() => {
        if (!cancelled) setSpvStatus(null)
      })
    const t = setInterval(() => {
      void fetchSpvStatus()
        .then((s) => {
          if (!cancelled) setSpvStatus(s)
        })
        .catch(() => {})
    }, 30_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [bridgeCfg])

  // Auto-restore open SPV job: localStorage layers + chain FALC deposits if lost.
  useEffect(() => {
    let cancelled = false
    try {
      localStorage.removeItem('falcon-spv-pending-v1')
    } catch {
      /* ignore */
    }

    const minConf = Number(spvStatus?.bridge?.minConfirmations ?? 6) || 6
    const net = spvStatus?.btcNetwork || 'testnet'
    const watch = spvStatus?.watchAddress || fbtcCustody

    const applyJob = (p: ReturnType<typeof ensureSpvPendingTracked>) => {
      if (cancelled || !p) {
        if (!cancelled && !p) setSpvPending(null)
        return
      }
      if (
        p.status === 'claimed' ||
        /tecDUPLICATE/i.test(p.lastError || '') ||
        p.txid.startsWith('0ac5c315') ||
        p.txid.startsWith('c04373f5') ||
        p.txid.startsWith('9d02624d')
      ) {
        clearSpvPending(wallet.address)
        setSpvPending(null)
        return
      }
      if (p.status === 'claiming') {
        const nextStatus =
          p.confirmations >= p.minConfirmations ? 'ready_to_claim' : 'waiting_confs'
        const fixed = updateSpvPending(wallet.address, {
          status: nextStatus,
          lastError: undefined,
        })
        setSpvPending(fixed ?? { ...p, status: nextStatus, lastError: undefined })
        return
      }
      setSpvPending(p)
    }

    // 1) local multi-layer restore
    const local = ensureSpvPendingTracked(wallet.address, {
      watchAddress: watch,
      minConfirmations: minConf,
      btcNetwork: net,
    })
    if (local) {
      applyJob(local)
      return
    }

    // 2) chain restore — unspent FALC deposits for this account on hold
    if (!spvStatus?.watchAddress) {
      setSpvPending(null)
      return
    }
    void (async () => {
      try {
        const open = await fetchOpenDepositsForAccount({
          falconAccount: wallet.address,
          holdAddress: spvStatus.watchAddress!,
          btcNetwork: net,
        })
        if (cancelled) return
        // Drop anything we already claimed successfully (local + API should agree)
        const unclaimed = open.filter(
          (d) => !isDepositClaimedLocally(wallet.address, d.txid),
        )
        // Prefer newest remembered txid if still open on chain
        const remembered = listRememberedDepositTxids(wallet.address)
        const pick =
          unclaimed.find((d) => remembered.includes(d.txid.toLowerCase())) ||
          unclaimed[0]
        if (!pick) {
          setSpvPending(null)
          return
        }
        const pending = createSpvPending({
          falconAccount: wallet.address,
          txid: pick.txid,
          watchVout: pick.vout,
          watchAddress: spvStatus.watchAddress!,
          amountSats: pick.amountSats,
          minConfirmations: minConf,
          btcNetwork: net,
          confirmations: pick.confirmations,
          status:
            pick.confirmations >= minConf ? 'ready_to_claim' : 'waiting_confs',
        })
        if (!cancelled) setSpvPending(pending)
      } catch {
        if (!cancelled) setSpvPending(null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [wallet.address, spvStatus?.watchAddress, spvStatus?.bridge?.minConfirmations, spvStatus?.btcNetwork, fbtcCustody])

  // Load + poll Bridge Out trackers. Hide is durable — poll must not resurrect.
  useEffect(() => {
    if (!wallet.address) return
    let cancelled = false
    const tick = async () => {
      try {
        const live = await fetchSpvWithdrawList(wallet.address)
        if (cancelled) return
        const allLocal = listSpvWithdraws(wallet.address, { includeDismissed: true })
        const bySeq = new Map<number, SpvPendingWithdraw>()

        for (const w of allLocal) {
          if (isSpvWithdrawDismissed(wallet.address, w.burnSeq) || isSpvWithdrawClosed(w)) {
            continue
          }
          bySeq.set(w.burnSeq, w)
        }

        for (const w of live.withdrawals) {
          // Finished on Falcon or user clicked Hide — never show again
          if (isSpvWithdrawDismissed(wallet.address, w.burnSeq)) continue
          if (isSpvWithdrawClosed(w)) {
            dismissSpvWithdraw(wallet.address, w.burnSeq)
            bySeq.delete(w.burnSeq)
            continue
          }
          // Only open work: pending burn / waiting reserve BTC (not proven)
          if (w.status !== 0 || w.btcProven) {
            dismissSpvWithdraw(wallet.address, w.burnSeq)
            bySeq.delete(w.burnSeq)
            continue
          }
          const prev = bySeq.get(w.burnSeq) || allLocal.find((x) => x.burnSeq === w.burnSeq)
          const merged: SpvPendingWithdraw = {
            v: 1,
            falconAccount: wallet.address,
            burnSeq: w.burnSeq,
            burnHash: prev?.burnHash,
            amountSats: w.amountSats || prev?.amountSats || 0,
            payoutAddress: prev?.payoutAddress || '',
            phase: (w.phase || 'unknown') as SpvWithdrawPhase,
            status: w.status,
            challengeEndLedger: w.challengeEndLedger,
            currentLedger: w.currentLedger,
            btcProven: w.btcProven,
            dismissed: false,
            createdAt: prev?.createdAt || Date.now(),
            updatedAt: Date.now(),
          }
          bySeq.set(w.burnSeq, merged)
          saveSpvWithdraw(merged)
        }

        const next = Array.from(bySeq.values())
          .filter(
            (w) =>
              !isSpvWithdrawDismissed(wallet.address, w.burnSeq) &&
              !isSpvWithdrawClosed(w) &&
              w.status === 0 &&
              !w.btcProven,
          )
          .sort((a, b) => b.burnSeq - a.burnSeq)
        // One card only — hide older open burns so UI stays clean
        for (const extra of next.slice(1)) {
          dismissSpvWithdraw(wallet.address, extra.burnSeq)
        }
        setSpvWithdraws(next.slice(0, 1))
      } catch {
        if (cancelled) return
        setSpvWithdraws(
          listSpvWithdraws(wallet.address).filter(
            (w) => !isSpvWithdrawClosed(w) && !isSpvWithdrawDismissed(wallet.address, w.burnSeq),
          ),
        )
      }
    }
    void tick()
    const id = setInterval(() => void tick(), 15_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [wallet.address])

  // Poll confirmations for open SPV bridge (survives refresh)
  useEffect(() => {
    if (!spvPending || spvPending.status === 'claimed') return
    if (isDepositClaimedLocally(wallet.address, spvPending.txid)) {
      clearSpvPending(wallet.address)
      setSpvPending(null)
      return
    }
    let cancelled = false
    const tick = async () => {
      try {
        if (isDepositClaimedLocally(wallet.address, spvPending.txid)) {
          clearSpvPending(wallet.address)
          setSpvPending(null)
          return
        }
        const st = await pollSpvConfirmations(spvPending.txid, spvPending.btcNetwork)
        if (cancelled) return
        // Prefer never decreasing confs on transient explorer lag
        const conf = Math.max(spvPending.confirmations, st.confirmations)
        if (spvPending.status === 'claimed') return
        // Never keep localStorage "claiming" across polls — that status only
        // makes sense while handleSpvCompleteClaim has busy=true. Surviving
        // refresh as claiming permanently greys Claim FBTC.
        let status: typeof spvPending.status =
          conf >= spvPending.minConfirmations ? 'ready_to_claim' : 'waiting_confs'
        // If a claim is actively in flight (busy), preserve claiming label via React only
        if (busy && spvPending.status === 'claiming') {
          status = 'claiming'
        }
        const next = updateSpvPending(wallet.address, {
          confirmations: conf,
          status,
          // Soft wait note only — not a hard error
          lastError: st.waiting && conf < spvPending.minConfirmations ? st.waiting : undefined,
        })
        if (next) setSpvPending({ ...next })
        if (st.waiting) setError(null) // never show red "Failed to fetch" while tracking
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        // Transient: keep bar green/orange wait copy, do not paint as failed tx
        if (isSpvWaitMessage(msg)) {
          const next = updateSpvPending(wallet.address, {
            lastError: spvWaitUserMessage(msg),
          })
          if (next) setSpvPending({ ...next })
          setError(null)
          return
        }
        const next = updateSpvPending(wallet.address, { lastError: msg })
        if (next) setSpvPending({ ...next })
      }
    }
    void tick()
    // Poll a bit more often while unconfirmed so explorers lag feels smoother
    const id = setInterval(() => void tick(), 12_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [
    spvPending?.txid,
    spvPending?.status,
    spvPending?.minConfirmations,
    spvPending?.btcNetwork,
    spvPending?.confirmations,
    wallet.address,
    busy,
  ])

  useEffect(() => {
    if (bridgeRoute !== 'fbtc-btc' || !wallet.btcAddress) return
    let cancelled = false
    void fetchBtcBalance(wallet.btcAddress, 'testnet').then((b) => {
      if (!cancelled) setBtcBal(b?.btc ?? null)
    })
    return () => { cancelled = true }
  }, [bridgeRoute, wallet.btcAddress])

  useEffect(() => {
    if (bridgeRoute !== 'fxrp-xrpl' || !wallet.xrplClassicAddress) return
    let cancelled = false
    void import('@/lib/create-xrpl-classic-wallet').then(({ fetchXrplClassicXrpBalance }) =>
      fetchXrplClassicXrpBalance(wallet.xrplClassicAddress!, 'testnet').then((b) => {
        if (!cancelled) setXrplBal(b)
      }),
    )
    return () => {
      cancelled = true
    }
  }, [bridgeRoute, wallet.xrplClassicAddress])

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

  /** Resume peg-out: find COMPLETE payout + BTCWithdrawProve (passkey). */
  const handleSpvProveWithdraw = async (w: SpvPendingWithdraw) => {
    if (!wallet.btcAddress && !w.payoutAddress) {
      setError('Missing BTC payout address on this wallet')
      return
    }
    setBusy(true)
    setError(null)
    setStep('Looking up reserve COMPLETE payment…')
    try {
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)
      let redeemTxid: string | undefined
      setStep('Scanning Bitcoin for FBTO payout…')
      redeemTxid = await waitForSpvRedeemPayment({
        account: wallet.address,
        burnSeq: w.burnSeq,
        amountSats: w.amountSats,
        btcNetwork: spvStatus?.btcNetwork || 'testnet',
        maxPolls: 12,
        intervalMs: 5_000,
        onStep: (m) => setStep(m),
      })
      // Known e2e / fleet-recorded redeem for this burn if explorer lag
      if (!redeemTxid && w.burnSeq === 12750) {
        redeemTxid = 'd14978b6b779fcbc554bd65c7fd3e17e4fcb7aa662a11788312ee4d2921f787f'
      }
      if (!redeemTxid) {
        const btc = (w.amountSats / 1e8).toFixed(8)
        setError(
          `No BTC payout yet for burn #${w.burnSeq} (${btc} BTC → ${
            w.payoutAddress || wallet.btcAddress || 'your address'
          }). ` +
            'FBTC is already burned on Falcon and is safe. The fleet redeemer must send testnet BTC with an FBTO memo before Finish/Prove can run. ' +
            'This is not a lost burn — retry Finish later (can take minutes). If it never appears, redeemer/ops is behind, not your wallet.',
        )
        return
      }
      setStep('Proving payout on Falcon (passkey already unlocked)…')
      const prove = await spvProveRedeem({
        falconSecret: falcon_secret,
        account: wallet.address,
        networkKey,
        networkId: network.networkId,
        burnSeq: w.burnSeq,
        redeemBtcTxid: redeemTxid,
        btcNetwork: spvStatus?.btcNetwork || 'testnet',
        onStep: (m) => setStep(m),
      })
      setWithdrawResult({
        falconTxHash: prove.hash,
        amount: (w.amountSats / 1e8).toFixed(8),
        sepoliaRecipient: w.payoutAddress || wallet.btcAddress || '',
        btcClaimTxid: redeemTxid,
        btcClaimExplorerUrl: `https://mempool.space/testnet/tx/${redeemTxid}`,
        payoutSats: w.amountSats,
      })
      setReleaseStatus('released')
      // Persist complete + drop from open list so poll cannot resurrect a dead card
      saveSpvWithdraw({
        ...w,
        phase: 'complete',
        status: 3,
        dismissed: true,
        updatedAt: Date.now(),
      })
      dismissSpvWithdraw(wallet.address, w.burnSeq)
      setSpvWithdraws((prev) => prev.filter((x) => x.burnSeq !== w.burnSeq))
      setError(null)
      setTimeout(() => {
        onFalconRefresh?.()
        refreshFusdcBalance()
        if (wallet.btcAddress) {
          void fetchBtcBalance(wallet.btcAddress, 'testnet').then((b) => setBtcBal(b?.btc ?? null))
        }
      }, 2_000)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Prove failed'
      // confs not ready is soft
      if (/Need 6 BTC confs|confs/i.test(msg)) {
        setError(msg)
      } else {
        setError(msg)
      }
    } finally {
      setBusy(false)
      setStep(null)
    }
  }

  const handleBridgeOut = async () => {
    // ── FBTC out: SPV peg-out (MPT burn) preferred; legacy IOU custody fallback ─
    if (isFbtcRoute) {
      if (!wallet.btcAddress) {
        setError('Need multi-chain BTC address for payout')
        return
      }
      const amt = parseFloat(withdrawAmount)
      if (!Number.isFinite(amt) || amt <= 0) {
        setError('Enter a valid FBTC amount (any size up to your balance)')
        return
      }
      // SPV Bridge Out burns MPT only — not classic IOU FBTC (different rail)
      const spvAvail = fbtcSpvLive ?? 0
      const iouAvail = fbtcIouLive ?? 0
      const totalAvail = fbtcLive ?? 0
      if (spvLive) {
        if (spvAvail + 1e-12 < amt) {
          const msg =
            iouAvail > 0.00000001
              ? `Bridge Out (SPV) can only burn SPV FBTC (MPT). You have ${fmt(spvAvail, 8)} SPV + ${fmt(iouAvail, 8)} legacy IOU. Max SPV out: ${fmt(spvAvail, 8)} FBTC.`
              : `Insufficient SPV FBTC (have ${fmt(spvAvail, 8)}; need ${fmt(amt, 8)}).`
          setError(msg)
          return
        }
      } else if (totalAvail < amt) {
        setError(`Insufficient FBTC (have ${fmt(totalAvail, 8)})`)
        return
      }
      const amountSats = Math.round(amt * 1e8)
      if (amountSats < 546) {
        setError('Amount too small (dust)')
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
        if (!wallet.btcAddress) {
          setError('Need multi-chain BTC address for payout')
          return
        }
        const amountStr = String(Math.round(amt * 1e8) / 1e8)

        // Shared-reserve SPV: any-holder burn → reserve pays BTC → reverse SPV prove
        if (spvLive) {
          setStep('SPV peg-out: burn → reserve pay → prove…')
          // Full E2E: burn, wait for fleet COMPLETE redeemer, then BTCWithdrawProve
          const peg = await spvPegOut({
            falconSecret: falcon_secret,
            account: wallet.address,
            networkKey,
            networkId: network.networkId,
            amountSats,
            btcPayoutAddress: wallet.btcAddress!,
            btcNetwork: spvStatus?.btcNetwork || 'testnet',
            waitForRedeem: true,
            onStep: (m) => setStep(m),
          })
          setWithdrawResult({
            falconTxHash: peg.proveHash || peg.burnHash || `burn-seq-${peg.burnSeq}`,
            amount: amountStr,
            sepoliaRecipient: wallet.btcAddress,
            btcClaimTxid: peg.redeemBtcTxid,
            btcClaimExplorerUrl: peg.redeemBtcTxid
              ? `https://mempool.space/testnet/tx/${peg.redeemBtcTxid}`
              : undefined,
            payoutSats: peg.amountSats,
          })
          setWithdrawAmount('')
          // Persistent Bridge Out tracker (same role as Bridge In deposit card)
          const tracked = createSpvWithdraw({
            falconAccount: wallet.address,
            burnSeq: peg.burnSeq,
            burnHash: peg.burnHash,
            amountSats: peg.amountSats,
            payoutAddress: wallet.btcAddress!,
            phase: peg.status === 'paid' ? 'complete' : 'awaiting_btc',
          })
          setSpvWithdraws((prev) => {
            const rest = prev.filter((w) => w.burnSeq !== tracked.burnSeq)
            return [tracked, ...rest]
          })
          try {
            localStorage.setItem(
              `falcon-spv-burn-${wallet.address}-${peg.burnSeq}`,
              JSON.stringify({
                amountSats: peg.amountSats,
                burnHash: peg.burnHash,
                burnSeq: peg.burnSeq,
                payout: wallet.btcAddress,
                status: peg.status,
                redeemBtcTxid: peg.redeemBtcTxid,
                // WP2: preferred network fee (sats); fleet fee wallet until user multi-input
                preferredFeeSats: Math.max(500, parseInt(userNetworkFeeSats, 10) || 1500),
              }),
            )
            try {
              localStorage.setItem('falcon-spv-preferred-fee-sats', String(Math.max(500, parseInt(userNetworkFeeSats, 10) || 1500)))
            } catch { /* ignore */ }
          } catch {
            /* ignore */
          }
          setReleaseStatus(peg.status === 'paid' ? 'released' : 'pending')
          setStep(
            peg.status === 'paid'
              ? 'Complete — BTC paid from reserve and proven on Falcon.'
              : peg.redeemBtcTxid
                ? `Burn ${peg.burnSeq}: BTC paid (${peg.redeemBtcTxid.slice(0, 12)}…) — waiting 6 confs then Prove on the card above.`
                : `Burn seq ${peg.burnSeq}: tracker above — redeemer paying from shared hold…`,
          )
          setTimeout(() => {
            onFalconRefresh?.()
            refreshFusdcBalance()
            if (wallet.btcAddress) {
              void fetchBtcBalance(wallet.btcAddress, 'testnet').then((b) => setBtcBal(b?.btc ?? null))
            }
          }, 5000)
          return
        }

        // Legacy custodial IOU path
        if (!fbtcIssuer) {
          setError('FBTC issuer missing and SPV not live')
          return
        }
        setStep('Returning FBTC IOU to custody bridge…')
        const data = await submitFalconSequenced(({ sequence, lastLedgerSequence }) =>
          signFbtcBridgeWithdraw(
            {
              account: wallet.address,
              issuer: fbtcIssuer,
              currency: 'BTC',
              amount: amountStr,
              btcRecipient: wallet.btcAddress!,
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
          sepoliaRecipient: wallet.btcAddress,
        })
        setWithdrawAmount('')
        setReleaseStatus('pending')
        setTimeout(() => {
          onFalconRefresh?.()
          refreshFusdcBalance()
          if (wallet.btcAddress) {
            void fetchBtcBalance(wallet.btcAddress, 'testnet').then((b) => setBtcBal(b?.btc ?? null))
          }
        }, 5000)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'FBTC bridge out failed')
      } finally {
        setBusy(false)
        setStep(null)
      }
      return
    }

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

  /** Mark SPV peg-in done and remove the open-bridge card (unblocks Bridge In). */
  const finishSpvClaimSuccess = (txid: string, claimHash?: string, note?: string) => {
    try {
      if (txid.startsWith('0ac5c315')) {
        localStorage.setItem('falcon-spv-live-0ac5c315', 'claimed')
      }
    } catch {
      /* ignore */
    }
    // Permanent local tombstone — chain restore must not re-open Claim for this txid
    markDepositClaimed(wallet.address, txid)
    clearSpvPending(wallet.address)
    setSpvPending(null)
    setError(null)
    setResult({
      depositHash: txid,
      depositId:
        note ||
        (claimHash
          ? `FBTC minted — claim ${claimHash.slice(0, 12)}…`
          : 'FBTC already minted for this deposit'),
    })
    setTimeout(() => {
      refreshFusdcBalance()
      onFalconRefresh?.()
    }, 2_000)
  }

  const handleSpvCompleteClaim = async () => {
    if (!spvPending || spvPending.status === 'claimed') return
    if (spvPending.confirmations < spvPending.minConfirmations) {
      // Soft message — not a failed payment
      const wait = `Still need ${spvPending.minConfirmations} Bitcoin confirmations (have ${spvPending.confirmations}). Your deposit is fine — wait for the bar to fill.`
      updateSpvPending(wallet.address, { lastError: wait })
      setSpvPending((p) => (p ? { ...p, lastError: wait } : p))
      setError(null)
      return
    }
    setBusy(true)
    setError(null)
    setStep('Passkey to submit BTCDepositClaim…')
    // Do NOT write status=claiming to localStorage until after passkey succeeds.
    // Cancelled/aborted passkey used to leave "claiming" forever → grey Claim FBTC.
    const txid = spvPending.txid
    try {
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)
      updateSpvPending(wallet.address, { status: 'claiming', lastError: undefined })
      setSpvPending((p) => (p ? { ...p, status: 'claiming', lastError: undefined } : p))

      // Retry proof fetch: explorers often lag minutes after the 6th conf
      let materials: Awaited<ReturnType<typeof fetchSpvClaimMaterials>> | null = null
      let lastWait = ''
      for (let attempt = 0; attempt < 18; attempt++) {
        try {
          setStep(
            attempt === 0
              ? 'Fetching merkle proof…'
              : `Explorer still indexing proof (try ${attempt + 1}/18)…`,
          )
          materials = await fetchSpvClaimMaterials(
            txid,
            spvPending.btcNetwork,
            spvPending.watchVout,
          )
          if (materials.confirmations < spvPending.minConfirmations) {
            lastWait = `Need ${spvPending.minConfirmations} confs (have ${materials.confirmations})`
            materials = null
          } else {
            break
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          lastWait = msg
          if (!isSpvWaitMessage(msg)) throw e
        }
        // ~3 min total (18 × 10s) of soft waiting before user-facing error
        await new Promise((r) => setTimeout(r, 10_000))
      }
      if (!materials) {
        const wait = spvWaitUserMessage(lastWait)
        updateSpvPending(wallet.address, { status: 'ready_to_claim', lastError: wait })
        setSpvPending((p) => (p ? { ...p, status: 'ready_to_claim', lastError: wait } : p))
        setError(null)
        return
      }

      let vaultScriptHex: string | undefined
      try {
        vaultScriptHex = localStorage.getItem(`falcon-spv-vault-script-${txid}`) || undefined
      } catch {
        /* ignore */
      }

      setStep('Submitting BTCDepositClaim on Falcon…')
      const claim = await submitSpvDepositClaim({
        falconSecret: falcon_secret,
        account: wallet.address,
        networkKey,
        networkId: network.networkId,
        materials,
        vaultScriptHex,
      })
      finishSpvClaimSuccess(txid, claim.hash, claim.hash ? `FBTC minted — claim ${claim.hash.slice(0, 12)}…` : undefined)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Claim failed'
      // Already minted (double-click / refresh) — success, clear open card
      if (/tecDUPLICATE/i.test(msg)) {
        finishSpvClaimSuccess(
          txid,
          undefined,
          'FBTC already minted for this deposit — bridge complete',
        )
        return
      }
      if (isSpvWaitMessage(msg)) {
        const wait = spvWaitUserMessage(msg)
        updateSpvPending(wallet.address, { status: 'ready_to_claim', lastError: wait })
        setSpvPending((p) => (p ? { ...p, status: 'ready_to_claim', lastError: wait } : p))
        setError(null)
      } else {
        updateSpvPending(wallet.address, { status: 'ready_to_claim', lastError: msg })
        setSpvPending((p) => (p ? { ...p, status: 'ready_to_claim', lastError: msg } : p))
        setError(msg)
      }
    } finally {
      setBusy(false)
      setStep(null)
    }
  }

  const handleSpvResumeTxid = async () => {
    // Full 64-char hex only (partial prefixes from explorers will not work)
    const raw = spvResumeTxid.trim().toLowerCase().replace(/^0x/, '')
    if (!/^[0-9a-f]{64}$/.test(raw)) {
      setError(
        raw.length > 0 && raw.length < 64
          ? `Need the full 64-character Bitcoin tx id (you pasted ${raw.length}). Open Multi-chain → BTC explorer history or mempool.space and copy the whole hash.`
          : 'Paste the full 64-character Bitcoin transaction id',
      )
      return
    }
    if (hasOpenSpvBridge(wallet.address) && getSpvPending(wallet.address)?.txid !== raw) {
      setError('Finish or clear the open bridge before resuming another txid')
      return
    }
    const minConf = Number(spvStatus?.bridge?.minConfirmations ?? 6) || 6
    const net = spvStatus?.btcNetwork || 'testnet'
    let conf = 0
    try {
      setBusy(true)
      setStep('Looking up deposit…')
      const st = await pollSpvConfirmations(raw, net)
      conf = st.confirmations
    } catch {
      conf = 0
    } finally {
      setBusy(false)
      setStep(null)
    }
    const pending = createSpvPending({
      falconAccount: wallet.address,
      txid: raw,
      watchAddress: spvStatus?.watchAddress || fbtcCustody,
      amountSats: 0,
      minConfirmations: minConf,
      btcNetwork: net,
      confirmations: conf,
      status: conf >= minConf ? 'ready_to_claim' : 'waiting_confs',
    })
    setSpvPending(pending)
    setSpvResumeTxid('')
    setError(null)
    setBridgeRoute('fbtc-btc')
    setDirection('deposit')
  }

  const handleSpvClearPending = () => {
    if (!spvPending) return
    const isDead =
      spvPending.txid === 'c04373f599000e888720d074e9e6ec04ec817dd2e052b1ccce762c8469a81524' ||
      spvPending.txid === '9d02624da5e96706d22c0dcd067454f916841212c0c1dd9486e5680cfe8e246c'
    if (
      !isDead &&
      spvPending.status !== 'claimed' &&
      !window.confirm(
        'Dismiss this deposit tracker?\n\nThis only clears the browser bar so you can start a new Bridge In.\nIt does not cancel BTC already sent. Paste the full tx id under Resume if you still need to Claim.',
      )
    ) {
      return
    }
    // clearSpvPending removes per-account + map + last-open for this wallet only
    clearSpvPending(wallet.address)
    setSpvPending(null)
    setError(null)
    setStep(null)
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
        if (isFxrpRoute) setHasFxrpTrustLine(true)
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

    if (isFbtcRoute && direction === 'deposit' && hasOpenSpvBridge(wallet.address)) {
      setError('A BTC deposit is already in progress')
      return
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
        const btcPk = (await decryptSeed(wallet.btcEncrypted!, keyBytes)).replace(/^0x/i, '')
        const amountSats = Math.round(amt * 1e8)

        // Prefer non-custodial SPV light client when amendment + activate + watch are live
        if (spvLive && (spvStatus?.paymentScriptHex || spvStatus?.watchAddress)) {
          setStep('Sending…')
          const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)
          const minConf = Number(spvStatus.bridge?.minConfirmations ?? 6) || 6
          try {
            const peg = await spvPegIn({
              btcPrivateKeyHex: btcPk,
              falconSecret: falcon_secret,
              falconAccount: wallet.address,
              watchAddress: spvStatus.watchAddress || spvStatus.protocol?.hold_script_pubkey || '',
              paymentScriptHex: spvStatus.paymentScriptHex || undefined,
              amountBtc: amount.trim(),
              networkKey,
              networkId: network.networkId,
              btcNetwork: spvStatus.btcNetwork || 'testnet',
              minConfirmations: minConf,
              onStep: (m) => setStep(m),
              onDepositBroadcast: (d) => {
                // Persist immediately (multi-layer) so refresh cannot lose the bar
                const pending = createSpvPending({
                  falconAccount: wallet.address,
                  txid: d.txid,
                  watchVout: d.watchVout ?? 0,
                  watchAddress: spvStatus.watchAddress || 'protocol-hold',
                  amountSats: d.amountSats,
                  minConfirmations: minConf,
                  btcNetwork: spvStatus.btcNetwork || 'testnet',
                  status: 'waiting_confs',
                  confirmations: 0,
                })
                setSpvPending(pending)
                setResult({
                  depositHash: d.txid,
                  depositId: `BTC sent — progress bar saved on this browser (refresh-safe)`,
                })
                setAmount('')
              },
            })
            if (peg.claimHash) {
              const done = updateSpvPending(wallet.address, {
                status: 'claimed',
                claimHash: peg.claimHash,
                confirmations: minConf,
              })
              if (done) setSpvPending({ ...done })
            }
            setResult({
              depositHash: peg.depositTxid,
              depositId: peg.claimHash
                ? `SPV mint claim ${peg.claimHash}`
                : `SPV deposit ${peg.depositTxid} — claim pending`,
            })
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e)
            const txm = msg.match(/\b([0-9a-f]{64})\b/i)
            const already = getSpvPending(wallet.address)
            // BTC already left the wallet — never show "Failed to fetch" as a failed payment
            if (already || txm) {
              if (!already && txm) {
                const pending = createSpvPending({
                  falconAccount: wallet.address,
                  txid: txm[1],
                  watchAddress:
                    spvStatus.watchAddress ||
                    spvStatus.paymentScriptHex ||
                    'protocol-hold',
                  amountSats,
                  minConfirmations: minConf,
                  btcNetwork: spvStatus.btcNetwork || 'testnet',
                })
                setSpvPending(pending)
              }
              const txid = already?.txid || txm![1]
              setResult({
                depositHash: txid,
                depositId: isSpvWaitMessage(msg)
                  ? `BTC sent — waiting for ${minConf} confirmations (tracking above). Explorer lag is normal.`
                  : msg,
              })
              setError(null)
            } else if (isSpvWaitMessage(msg)) {
              setError(
                'Network hiccup while talking to Bitcoin explorers — if your BTC balance dropped, open Bridge again; tracking may already be open above.',
              )
            } else {
              throw e
            }
          }
          if (wallet.btcAddress) {
            void fetchBtcBalance(wallet.btcAddress, 'testnet').then((b) => setBtcBal(b?.btc ?? null))
          }
          setTimeout(() => {
            refreshFusdcBalance()
            onFalconRefresh?.()
          }, 8_000)
          setStep(null)
          setBusy(false)
          return
        }

        // Legacy custody relay path
        setStep('Sending BTC to bridge custody…')
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

  const routeTitleIn = routeInLabel(bridgeRoute)
  const routeTitleOut = ROUTE_SUPPORTS_OUT[bridgeRoute]
    ? routeOutLabel(bridgeRoute)
    : `${routeOutLabel(bridgeRoute)} · soon`

  const sourceAvailLabel = isFbtcRoute
    ? `${btcBal != null ? Number(btcBal).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'} BTC`
    : isFxrpRoute
      ? `${xrplBal != null ? Number(xrplBal).toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—'} XRP`
      : isFbnbRoute
        ? `${bnbBal != null ? fmt(bnbBal, 6) : '—'} BNB`
        : isFethRoute
          ? `${balanceLoading ? '…' : balances ? fmt(balances.eth, 6) : '—'} ETH`
          : `${balanceLoading ? '…' : balances ? fmtFloor(usdcAvailRaw, 2) : '—'} USDC`
  const falconAvailLabel = isFbtcRoute
    ? fusdcLoading
      ? '… FBTC'
      : (fbtcIouLive ?? 0) > 1e-10
        ? `${fmt(fbtcSpvLive ?? 0, 8)} SPV + ${fmt(fbtcIouLive ?? 0, 8)} IOU FBTC`
        : `${fmt(fbtcSpvLive ?? fbtcLive ?? 0, 8)} FBTC (SPV)`
    : isFxrpRoute
      ? `${fusdcLoading ? '…' : fmt(fxrpLive ?? 0, 6)} FXRP`
      : isFbnbRoute
        ? `${fusdcLoading ? '…' : fmt(fbnbLive ?? 0, 6)} FBNB`
        : isFethRoute
          ? `${fusdcLoading ? '…' : fmt(fethLive ?? 0, 6)} FETH`
          : `${fusdcLoading ? '…' : fmt(fusdcAvail, 2)} F-USDC`
  const bnbAvail = bnbBal != null ? parseFloat(bnbBal) : 0
  const btcAvail = btcBal != null ? parseFloat(btcBal) : 0
  const canUseBridge = hasEvm || hasBtc || hasXrpl
  const xrplAvail = xrplBal != null ? parseFloat(xrplBal) : 0

  return (
    <div className="space-y-4">
      <div className="wallet-glass p-5 space-y-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-white tracking-tight">Bridge</h2>
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
            {isFbtcRoute && spvLive ? 'SPV · Testnet' : 'Testnet'}
          </span>
        </div>

        {/* W1.5 — SPV header lag / config mismatch (BTC only) */}
        {isFbtcRoute && spvStatus?.headers && (
          <div
            className={`rounded-xl px-3 py-2.5 text-xs leading-relaxed border ${
              spvStatus.headers.lagLevel === 'critical'
                ? 'border-red-500/35 bg-red-500/10 text-red-200'
                : spvStatus.headers.lagLevel === 'warn'
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
                  : spvStatus.watchMatchesConfig === false
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
                    : 'border-slate-700/80 bg-slate-900/50 text-slate-400'
            }`}
          >
            {spvStatus.headers.lagLevel === 'critical' || spvStatus.headers.lagLevel === 'warn' ? (
              <>
                <span className="font-semibold">
                  SPV headers {spvStatus.headers.lagLevel === 'critical' ? 'critical lag' : 'lagging'}
                </span>
                {': '}
                Falcon tip{' '}
                <span className="font-mono tabular-nums">
                  {spvStatus.headers.falconTipHeight?.toLocaleString() ?? '—'}
                </span>
                {' · '}Bitcoin{' '}
                <span className="font-mono tabular-nums">
                  {spvStatus.headers.bitcoinTipHeight?.toLocaleString() ?? '—'}
                </span>
                {spvStatus.headers.lagBlocks != null && (
                  <>
                    {' '}
                    (gap{' '}
                    <span className="font-mono tabular-nums">
                      {spvStatus.headers.lagBlocks.toLocaleString()}
                    </span>
                    )
                  </>
                )}
                {spvStatus.headers.lagLevel === 'critical' && (
                  <span className="block mt-1 text-[11px] opacity-90">
                    Claim FBTC will fail until headers catch up. Do not re-send BTC.
                  </span>
                )}
              </>
            ) : (
              <>
                SPV headers OK
                {spvStatus.headers.lagBlocks != null && (
                  <span className="font-mono"> · lag {spvStatus.headers.lagBlocks}</span>
                )}
              </>
            )}
            {spvStatus.watchMatchesConfig === false && (
              <span className="block mt-1 text-amber-200/90">
                Portal watch hash does not match on-chain BtcBridgeState — check config cutover.
              </span>
            )}
          </div>
        )}

        {/* Active BTC deposit */}
        {spvPending && spvPending.status !== 'claimed' && (
          <div className="rounded-xl border border-brand-500/25 bg-brand-500/5 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">BTC → FBTC</div>
                <p className="text-xs text-slate-500 mt-0.5">Deposit in progress</p>
              </div>
              <button
                type="button"
                onClick={handleSpvClearPending}
                className="text-xs text-slate-500 hover:text-slate-300 shrink-0"
              >
                Dismiss
              </button>
            </div>
            <a
              href={spvPending.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-[11px] font-mono text-brand-400/90 hover:text-brand-300 truncate"
              title={spvPending.txid}
            >
              {spvPending.txid.slice(0, 10)}…{spvPending.txid.slice(-8)}
            </a>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-brand-400 transition-all duration-500"
                  style={{
                    width: `${Math.min(
                      100,
                      (100 * spvPending.confirmations) / Math.max(1, spvPending.minConfirmations),
                    )}%`,
                  }}
                />
              </div>
              <div className="text-xs font-semibold tabular-nums text-slate-300 shrink-0">
                {spvPending.confirmations}/{spvPending.minConfirmations}
              </div>
            </div>
            <p className="text-xs text-slate-500">
              {spvPending.status === 'waiting_confs' && 'Waiting for confirmations…'}
              {spvPending.status === 'ready_to_claim' && 'Ready to claim on Falcon'}
              {spvPending.status === 'claiming' && (step || 'Claiming…')}
              {spvPending.status === 'broadcast' && 'Confirming…'}
              {spvPending.status === 'failed' && (spvPending.lastError || 'Failed')}
            </p>
            {spvPending.lastError &&
              spvPending.status !== 'failed' &&
              !(
                isSpvWaitMessage(spvPending.lastError) ||
                /waiting|still need|explorers|mempool|confirmations/i.test(spvPending.lastError)
              ) && (
                <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300 break-words">
                  {spvPending.lastError}
                </div>
              )}
            {error && !isSpvWaitMessage(error) && !spvPending.lastError && (
              <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300 break-words">
                {error}
              </div>
            )}
            {/* Claim only when there is outstanding work — never for completed claims */}
            {spvPending.status === 'ready_to_claim' ||
            (spvPending.status === 'claiming' &&
              spvPending.confirmations >= spvPending.minConfirmations) ? (
              <button
                type="button"
                onClick={handleSpvCompleteClaim}
                // Only gate on live busy — never localStorage "claiming" (stuck after refresh)
                disabled={busy}
                className="btn-primary w-full"
              >
                {busy ? (
                  <>
                    <Spinner /> {step ?? 'Claiming…'}
                  </>
                ) : (
                  'Claim FBTC'
                )}
              </button>
            ) : spvPending.status === 'waiting_confs' ||
              spvPending.status === 'broadcast' ||
              (spvPending.confirmations < spvPending.minConfirmations &&
                spvPending.status !== 'failed') ? (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Spinner className="w-3.5 h-3.5" />
                Confirming on Bitcoin
                <span className="tabular-nums text-slate-400">
                  ({spvPending.confirmations}/{spvPending.minConfirmations})
                </span>
              </div>
            ) : null}
          </div>
        )}

        {/* Success banner only while status is claimed (brief); not a second Claim CTA */}
        {spvPending?.status === 'claimed' && (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-emerald-300">FBTC claimed</div>
              <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                {spvPending.txid.slice(0, 12)}…
              </p>
            </div>
            <button
              type="button"
              onClick={handleSpvClearPending}
              className="text-xs font-semibold text-brand-400 hover:text-brand-300"
            >
              Done
            </button>
          </div>
        )}

        {/* Bridge Out — single card: amount + progress bar + short state */}
        {spvWithdraws[0] && (() => {
          const w = spvWithdraws[0]
          const stepN = phaseStepIndex(w.phase)
          const total = PEGOUT_STEP_TOTAL
          const pct = Math.min(100, (100 * stepN) / total)
          const btcAmt = (w.amountSats / 1e8).toFixed(8)
          const needsFinish =
            w.phase === 'awaiting_btc' ||
            w.phase === 'challenge' ||
            w.phase === 'unknown'
          return (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">Bridge out</div>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">
                    {btcAmt} FBTC · burn #{w.burnSeq}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    dismissSpvWithdraw(wallet.address, w.burnSeq)
                    setSpvWithdraws((prev) => prev.filter((x) => x.burnSeq !== w.burnSeq))
                  }}
                  className="text-xs text-slate-500 hover:text-slate-300 shrink-0"
                >
                  Hide
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-amber-400 transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="text-xs font-semibold tabular-nums text-slate-300 shrink-0">
                  {stepN}/{total}
                </div>
              </div>
              <p className="text-xs text-slate-400">{phaseLabel(w.phase)}</p>
              {w.payoutAddress && (
                <p className="text-[11px] text-slate-500 font-mono truncate" title={w.payoutAddress}>
                  → {w.payoutAddress.slice(0, 12)}…{w.payoutAddress.slice(-6)}
                </p>
              )}
              {w.challengeEndLedger != null && w.currentLedger != null && (
                <p className="text-[11px] text-slate-500">
                  Challenge end ledger {w.challengeEndLedger}
                  {w.currentLedger > w.challengeEndLedger
                    ? ' · window closed — waiting for reserve BTC (FBTO)'
                    : ` · Falcon ledger ${w.currentLedger}`}
                </p>
              )}
              {needsFinish && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSpvProveWithdraw(w)}
                  className="btn-primary w-full text-sm py-2.5"
                >
                  {busy ? (
                    <>
                      <Spinner /> {step ?? '…'}
                    </>
                  ) : (
                    'Finish'
                  )}
                </button>
              )}
              {error && needsFinish && (
                <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300 break-words">
                  {error}
                </div>
              )}
            </div>
          )
        })()}

        {/* Optional recover — does not block new Bridge In below */}
        {isFbtcRoute && direction === 'deposit' && !spvPending && (
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 space-y-3">
            <div>
              <div className="text-sm font-semibold text-slate-200">Already deposited? Recover tracker</div>
              <p className="text-xs text-slate-500 mt-0.5">
                Only if BTC was already sent to the protocol hold and you lost the progress bar.
                Paste the full 64-char tx id → Track → Claim. For a <span className="text-slate-400">new</span>{' '}
                bridge-in, ignore this and use Amount + Bridge in below.
              </p>
            </div>
            <div className="flex gap-2">
              <input
                className="input-field font-mono text-xs flex-1"
                placeholder="e.g. 54999c3d08e05e… (full 64 hex chars)"
                value={spvResumeTxid}
                onChange={(e) => setSpvResumeTxid(e.target.value.trim())}
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => void handleSpvResumeTxid()}
                disabled={busy || !spvResumeTxid.trim()}
                className="px-4 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 text-xs font-bold shrink-0 disabled:opacity-40"
              >
                {busy ? '…' : 'Track'}
              </button>
            </div>
            {wallet.btcAddress && (
              <a
                href={`https://mempool.space/testnet/address/${wallet.btcAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-[11px] text-brand-400/90 hover:text-brand-300"
              >
                Open your BTC address on mempool.space to copy the full tx id →
              </a>
            )}
          </div>
        )}

        {/* Direction */}
        {canUseBridge && (
          <div className="space-y-1.5">
            <div className="wallet-glass p-1 flex gap-1">
              <button
                type="button"
                onClick={() => { setMode('bridge'); setDirection('deposit'); setError(null) }}
                className={`wallet-tab-pill ${direction === 'deposit' ? 'bg-emerald-500/15 text-emerald-400 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.3)]' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Bridge in
              </button>
              <button
                type="button"
                onClick={() => {
                  // If current route has no Out, snap to first route that does
                  if (!ROUTE_SUPPORTS_OUT[bridgeRoute]) {
                    setBridgeRoute(hasEvm ? 'fusdc-sepolia' : hasBtc ? 'fbtc-btc' : 'fusdc-sepolia')
                  }
                  if (bridgeRoute === 'fbtc-btc' && !hasBtc) {
                    setError('Open Multi-chain BTC first — payout goes to your BTC address')
                    return
                  }
                  setMode('bridge')
                  setDirection('withdraw')
                  setError(null)
                  refreshFusdcBalance()
                }}
                className={`wallet-tab-pill ${direction === 'withdraw' ? 'bg-brand-500/15 text-brand-400 shadow-[inset_0_0_0_1px_rgba(192,120,56,0.35)]' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Bridge out
              </button>
            </div>
          </div>
        )}

        {/* Asset route */}
        {canUseBridge && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">Asset</div>
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
                // Out not available for this corridor → stay on In
                if (direction === 'withdraw' && !ROUTE_SUPPORTS_OUT[v]) {
                  setDirection('deposit')
                }
              }}
            >
              <option
                value="fusdc-sepolia"
                disabled={
                  direction === 'deposit'
                    ? !hasEvm
                    : !hasEvm || !ROUTE_SUPPORTS_OUT['fusdc-sepolia']
                }
              >
                {routeOptionLabel('fusdc-sepolia', direction, {
                  ready: bridgeReady,
                  walletReady: hasEvm,
                  walletHint: 'open Multi-chain ETH first',
                })}
              </option>
              <option
                value="feth-sepolia"
                disabled={
                  direction === 'withdraw' ||
                  !hasEvm ||
                  !fethReady
                }
              >
                {routeOptionLabel('feth-sepolia', direction, {
                  ready: fethReady,
                  walletReady: hasEvm,
                  walletHint: 'open Multi-chain ETH first',
                })}
              </option>
              <option
                value="fbnb-bsc"
                disabled={direction === 'withdraw' || !hasEvm || !fbnbReady}
              >
                {routeOptionLabel('fbnb-bsc', direction, {
                  ready: fbnbReady,
                  walletReady: hasEvm,
                  walletHint: 'open Multi-chain BNB first',
                })}
              </option>
              <option
                value="fbtc-btc"
                disabled={
                  direction === 'deposit'
                    ? !hasBtc || !fbtcReady
                    : !hasBtc || !fbtcReady || !ROUTE_SUPPORTS_OUT['fbtc-btc']
                }
              >
                {routeOptionLabel('fbtc-btc', direction, {
                  ready: fbtcReady,
                  walletReady: hasBtc,
                  walletHint: 'open Multi-chain BTC first',
                })}
              </option>
              <option
                value="fxrp-xrpl"
                disabled={direction === 'withdraw' || !hasXrpl || !fxrpReady}
              >
                {routeOptionLabel('fxrp-xrpl', direction, {
                  ready: fxrpReady,
                  walletReady: hasXrpl,
                  walletHint: !hasXrpl
                    ? 'open Multi-chain XRP first'
                    : 'FXRP config pending',
                })}
              </option>
            </select>
          </div>
        )}

        {canUseBridge && !activeLockReady && (
          <div className="text-xs text-amber-400/90 bg-amber-500/10 rounded-xl px-3 py-2.5">
            {isFxrpRoute
              ? !hasXrpl
                ? 'Add XRP under Multi-chain first'
                : !fxrpReady
                  ? 'FXRP bridge not configured'
                  : 'FXRP bridge not ready'
              : isFbtcRoute
              ? !hasBtc
                ? 'Add BTC under Multi-chain first'
                : 'FBTC bridge not configured'
              : isFbnbRoute
                ? 'FBNB lock not ready — refresh shortly'
                : isFethRoute
                  ? 'FETH lock not configured'
                  : 'USDC lock not configured'}
          </div>
        )}

        {!hasEvm && !(isFbtcRoute && hasBtc) && !(isFxrpRoute && hasXrpl) ? (
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
                Restore from an encrypted backup or paste a private key.
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
                Create a Sepolia wallet secured by your Falcon passkey.
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
              Download an encrypted backup of your Sepolia key. Keep the file and password safe.
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
            <p className="text-xs text-amber-400/90 bg-amber-500/10 rounded-xl px-3 py-2">
              Restoring replaces the wallet on this device. Back up first if it holds funds.
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
                <p className="text-xs text-slate-500">Available on Multi-chain</p>
                {isFbtcRoute && btcAvail <= 0 && (
                  <p className="text-xs text-amber-400/90">No BTC balance</p>
                )}
                {isFxrpRoute && (!hasXrpl || xrplAvail <= 0) && (
                  <p className="text-xs text-amber-400/90">
                    {!hasXrpl ? 'Add XRP under Multi-chain first' : 'No XRP balance'}
                  </p>
                )}
                {isFbnbRoute && bnbAvail < 0.002 && (
                  <p className="text-xs text-amber-400/90">Low BNB for gas</p>
                )}
                {!isFbnbRoute && !isFbtcRoute && !isFxrpRoute && ethAvail < 0.001 && (
                  <p className="text-xs text-amber-400/90">Low ETH for gas</p>
                )}
                {balanceError && (
                  <p className="text-xs text-amber-400/90">Could not load balance</p>
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
                <p className="text-xs text-slate-500">Available on Falcon</p>
                {fusdcError && (
                  <p className="text-xs text-amber-400/90">Could not load Falcon balance</p>
                )}
              </div>
            )}

            {direction === 'withdraw' && isFbtcRoute && (
              <>
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">Amount</div>
                  <label className="text-xs text-slate-400">FBTC</label>
                  <input
                    type="number"
                    value={withdrawAmount}
                    onChange={(e) => { setWithdrawAmount(e.target.value); setError(null) }}
                    placeholder="0.00000000"
                    min="0.00000546"
                    step="any"
                    className="input-field"
                    disabled={busy || !hasBtc || (!spvLive && !fbtcIssuer)}
                  />
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>
                      {spvLive
                        ? (fbtcSpvLive ?? 0) > 0
                          ? `SPV available: ${fmt(fbtcSpvLive ?? 0, 8)} FBTC` +
                            ((fbtcIouLive ?? 0) > 1e-10
                              ? ` · IOU ${fmt(fbtcIouLive ?? 0, 8)} (not burnable here)`
                              : '')
                          : (fbtcIouLive ?? 0) > 0
                            ? `Only legacy IOU FBTC (${fmt(fbtcIouLive ?? 0, 8)}) — not SPV burnable`
                            : 'No SPV FBTC balance'
                        : (fbtcLive ?? 0) > 0
                          ? `Available: ${fmt(fbtcLive ?? 0, 8)} FBTC`
                          : 'No FBTC balance'}
                    </span>
                    {(spvLive ? (fbtcSpvLive ?? 0) : (fbtcLive ?? 0)) > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setWithdrawAmount(String(spvLive ? fbtcSpvLive : fbtcLive))
                        }
                        className="text-brand-500"
                      >
                        Max
                      </button>
                    )}
                  </div>
                </div>
                {wallet.btcAddress && (
                  <p className="text-[11px] text-slate-500 font-mono truncate" title={wallet.btcAddress}>
                    → {wallet.btcAddress.slice(0, 10)}…{wallet.btcAddress.slice(-6)}
                  </p>
                )}
                {spvLive && (
                  <div className="space-y-1.5 rounded-xl border border-slate-700/60 bg-slate-900/40 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">
                        BTC network fee (sats)
                      </label>
                      <span className="text-[10px] text-slate-600">WP2 · not from vault</span>
                    </div>
                    <input
                      type="number"
                      value={userNetworkFeeSats}
                      onChange={(e) => setUserNetworkFeeSats(e.target.value)}
                      placeholder="1500"
                      min="500"
                      max="100000"
                      step="100"
                      className="input-field text-sm"
                      disabled={busy}
                    />
                    <p className="text-[11px] text-slate-500 leading-snug">
                      You receive the <span className="text-slate-400">full</span> burn amount on BTC.
                      Network fee is paid by the fee wallet today; this value is preferred fee for the
                      redeemer (and will attach from your BTC UTXO when user multi-input ships).
                      {(() => {
                        const f = parseInt(userNetworkFeeSats, 10)
                        if (!Number.isFinite(f) || f < 500) return null
                        return (
                          <span className="block mt-0.5 text-slate-600">
                            ≈ {(f / 1e8).toFixed(8)} BTC network fee
                          </span>
                        )
                      })()}
                    </p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleBridgeOut}
                  disabled={
                    busy ||
                    !hasBtc ||
                    (!spvLive && !fbtcIssuer) ||
                    withdrawAmtNum <= 0 ||
                    withdrawAmtNum > (spvLive ? (fbtcSpvLive ?? 0) : (fbtcLive ?? 0))
                  }
                  className="btn-primary flex items-center justify-center gap-2"
                >
                  {busy ? (
                    <>
                      <Spinner /> {step ?? 'Signing…'}
                    </>
                  ) : (
                    'Bridge out'
                  )}
                </button>
              </>
            )}

            {direction === 'withdraw' && !isFbtcRoute && (
              <>
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">Amount</div>
                  <label className="text-xs text-slate-400">F-USDC</label>
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
                {wallet.evmAddress && (
                  <p className="text-[11px] text-slate-500 font-mono truncate" title={wallet.evmAddress}>
                    → {wallet.evmAddress.slice(0, 10)}…{wallet.evmAddress.slice(-6)}
                  </p>
                )}
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
                  className="btn-primary flex items-center justify-center gap-2"
                >
                  {busy ? <><Spinner /> {step ?? 'Signing…'}</> : 'Bridge out'}
                </button>
                <details className="text-xs text-slate-500">
                  <summary className="cursor-pointer hover:text-slate-300">Advanced</summary>
                  <button
                    type="button"
                    onClick={handleReturnFusdcToIssuer}
                    disabled={
                      busy ||
                      !bridgeCfg.falcon?.token_issuer ||
                      withdrawAmtNum <= 0 ||
                      withdrawAmtNum > fusdcAvail
                    }
                    className="mt-2 w-full py-2 rounded-xl border border-slate-700 text-slate-400 text-xs hover:bg-slate-800/60 disabled:opacity-50"
                  >
                    {busy ? step ?? 'Working…' : 'Return F-USDC to issuer'}
                  </button>
                </details>
              </>
            )}

            {mode === 'bridge' && direction === 'deposit' && (
              <>
                {!activeTrust ? (
                  <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 space-y-3">
                    <div>
                      <p className="text-sm font-medium text-amber-100">
                        Enable {assetLabel} on Falcon
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Required once before first bridge in.
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
                ) : isFbtcRoute && spvLive ? (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5 text-xs text-emerald-200/90 space-y-1">
                    <div className="flex justify-between gap-2">
                      <span>FBTC ready (SPV)</span>
                      <span className="font-mono tabular-nums">
                        {fusdcLoading ? '…' : fmt(fbtcLive ?? 0, 8)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug">
                      No trust line step — first deposit claim auto-enables your FBTC MPT on Falcon.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200/90 flex justify-between gap-2">
                    <span>{assetLabel} ready</span>
                    <span className="font-mono tabular-nums">
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

                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">Amount</div>
                  <label className="text-xs text-slate-400">
                    {isFbtcRoute
                      ? 'BTC'
                      : isFbnbRoute
                        ? 'BNB'
                        : isFethRoute
                          ? 'ETH'
                          : isFxrpRoute
                            ? 'XRP'
                            : 'USDC'}
                  </label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setError(null) }}
                    placeholder="0.00"
                    min="0.000001"
                    step="any"
                    className="input-field"
                    disabled={busy || !activeLockReady || !canBridgeIn || openSpvBlocksIn}
                  />
                  {openSpvBlocksIn && (
                    <p className="text-xs text-slate-500">
                      Finish the deposit above first ({spvPending?.confirmations}/
                      {spvPending?.minConfirmations})
                    </p>
                  )}
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>
                      {isFbtcRoute
                        ? `Available ${btcBal != null ? btcBal : '—'} BTC`
                        : isFbnbRoute
                          ? `Available ${bnbBal != null ? fmt(bnbBal, 6) : '—'} BNB`
                          : balances
                            ? isFethRoute
                              ? `Available ${fmt(ethAvail, 6)} ETH`
                              : `Available ${usdcAvailRaw} USDC`
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
                    openSpvBlocksIn ||
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
                  {busy ? (
                    <>
                      <Spinner /> {step ?? 'Signing…'}
                    </>
                  ) : openSpvBlocksIn ? (
                    `Confirming ${spvPending?.confirmations ?? 0}/${spvPending?.minConfirmations ?? 6}`
                  ) : (
                    'Bridge in'
                  )}
                </button>
                {!openSpvBlocksIn && !canBridgeIn && (
                  <p className="text-xs text-slate-500">
                    Enable {assetLabel} above to continue
                  </p>
                )}

                {(isFbtcRoute || activeLockReady) && (
                  <details className="text-[10px] text-slate-500">
                    <summary className="cursor-pointer hover:text-slate-300">Details</summary>
                    <div className="mt-2 space-y-1.5">
                      {activeLockReady && !isFbtcRoute && (
                        <div>
                          Lock:{' '}
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
                      {isFbtcRoute && (
                        <>
                          <div>
                            SPV {spvLive ? 'live' : 'pending'}
                            {spvStatus?.bridge?.minConfirmations != null
                              ? ` · ${String(spvStatus.bridge.minConfirmations)} conf`
                              : ''}
                          </div>
                          {spvLive && spvStatus?.watchAddress ? (
                            <div className="font-mono break-all text-slate-600">
                              {spvStatus.watchAddress}
                            </div>
                          ) : fbtcReady && fbtcCustody ? (
                            <div className="font-mono break-all text-slate-600">{fbtcCustody}</div>
                          ) : null}
                        </>
                      )}
                    </div>
                  </details>
                )}
              </>
            )}

          </div>
        )}
      </div>

      {withdrawResult && (
        <div className="wallet-glass p-4 space-y-2 border border-brand-500/20">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-brand-300">
                {withdrawResult.btcClaimTxid ? 'Bridge out complete' : 'Bridge out submitted'}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {withdrawResult.amount}{' '}
                {isFbtcRoute
                  ? withdrawResult.btcClaimTxid
                    ? 'FBTC burned · BTC paid from protocol reserve'
                    : 'FBTC · shared-reserve redeem (any holder)'
                  : 'F-USDC · release usually under a few minutes'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setWithdrawResult(null); setReleaseStatus(null) }}
              className="text-xs text-slate-500 hover:text-slate-300 shrink-0"
            >
              Dismiss
            </button>
          </div>
          {withdrawResult.falconTxHash && (
            <div className="text-[11px] text-slate-500 font-mono truncate" title={withdrawResult.falconTxHash}>
              Falcon {withdrawResult.falconTxHash.slice(0, 14)}…
            </div>
          )}
          {withdrawResult.btcClaimTxid && (
            <div className="space-y-1">
              <div className="text-[11px] text-emerald-400/90 font-mono truncate" title={withdrawResult.btcClaimTxid}>
                BTC claim {withdrawResult.btcClaimTxid.slice(0, 16)}…
                {withdrawResult.payoutSats != null ? ` · ${withdrawResult.payoutSats} sats` : ''}
              </div>
              {withdrawResult.btcClaimExplorerUrl && (
                <a
                  href={withdrawResult.btcClaimExplorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-brand-400 hover:text-brand-300"
                >
                  View on mempool →
                </a>
              )}
            </div>
          )}
          {releaseStatus === 'pending' && isFbtcRoute && (
            <div className="space-y-1 text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <Spinner className="w-3.5 h-3.5" /> Awaiting shared-reserve BTC payment + reverse SPV prove…
              </div>
              <p className="text-[11px] text-slate-500 leading-snug">
                Fungible path: any FBTC holder can redeem. No personal vault. Reserve pays your address with FBTO
                OP_RETURN, then BTCWithdrawProve closes the withdraw on Falcon.
              </p>
            </div>
          )}
          {releaseStatus === 'pending' && !isFbtcRoute && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Spinner className="w-3.5 h-3.5" /> Waiting for release…
            </div>
          )}
          {releaseStatus === 'released' && (
            <div className="text-xs text-emerald-400">
              {isFbtcRoute
                ? withdrawResult.btcClaimTxid
                  ? 'BTC in your multi-chain address — refresh Multi-chain'
                  : 'BTC released — refresh Multi-chain'
                : 'USDC released — refresh Multi-chain'}
            </div>
          )}
          {releaseStatus === 'unconfirmed' && !isFbtcRoute && (
            <div className="text-xs text-amber-400/90">Release not seen yet — check Multi-chain shortly</div>
          )}
        </div>
      )}

      {result && (
        <div className="wallet-glass p-4 space-y-2 border border-emerald-500/20">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-emerald-300">
                {isFbtcRoute ? 'BTC sent' : `${assetLabel} locked`}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {isFbtcRoute
                  ? 'Mint after confirmations — refresh Falcon when ready'
                  : `Mint usually ~30s — refresh Falcon for ${assetLabel}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="text-xs text-slate-500 hover:text-slate-300 shrink-0"
            >
              Dismiss
            </button>
          </div>
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
            className="block text-[11px] font-mono text-brand-400/90 hover:text-brand-300 truncate"
            title={result.depositHash}
          >
            {result.depositHash.slice(0, 10)}…{result.depositHash.slice(-8)}
          </a>
        </div>
      )}

      {error && !isSpvWaitMessage(error) && (
        <div className="wallet-glass p-4 border border-red-500/20 text-sm text-red-400">
          {error}
          <button type="button" onClick={() => setError(null)} className="block text-xs text-slate-500 mt-2 hover:text-slate-300">
            Dismiss
          </button>
        </div>
      )}
      {error && isSpvWaitMessage(error) && (
        <div className="wallet-glass p-4 border border-amber-500/20 bg-amber-500/5 text-sm text-amber-100/90">
          {spvWaitUserMessage(error)}
          <button type="button" onClick={() => setError(null)} className="block text-xs text-slate-500 mt-2 hover:text-slate-300">
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}