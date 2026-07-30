'use client'

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'

import Header from '@/components/Header'
import ProductShell from '@/components/ProductShell'
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
  loadPrimaryWallet,
  removeWalletFromDevice,
  replacePrimaryWallet,
  saveWallet,
  type StoredWallet,
} from '@/lib/wallet-store'
import {
  generateWallet,
  keysFromFalconSecret,
  validateFalconSecret,
  signPayment,
  signFusdcPayment,
  signNameSet,
  signNameUnbond,
  qxrpToDrops,
} from '@/lib/wallet-sign-client'
import {
  normalizeAccountName,
  nameHint,
  NAME_BOND_FALCON,
  cacheAccountName,
  readCachedAccountName,
} from '@/lib/account-name'
import { submitWithSequenceRetry, fetchSequenceInfo, type SubmitResult } from '@/lib/wallet-submit'
import {
  backupHasBridgeKeys,
  createEncryptedBackup,
  decryptBackupFile,
  downloadBackup,
  parseBackupFile,
  shareBackup,
  validateBackupPassphrase,
  type BackupPayload,
} from '@/lib/wallet-backup'
import {
  loadValidatorNode,
  saveValidatorNode,
  clearValidatorNode,
  dashboardUrl,
  type SavedValidatorNode,
} from '@/lib/validator-node-store'
import {
  isValidFalconAddress,
  parseFalconAddressFromScan,
} from '@/lib/parse-falcon-address'
import {
  createEvmWalletForPasskey,
  createRandomEvmWallet,
  encryptEvmKeyForPasskey,
  hasBridgeWallet,
  provisionBridgeWalletForStoredWallet,
} from '@/lib/create-evm-wallet'
import { type UsdcBridgeManifest } from '@/lib/bridge-config'
import BridgeDepositPanel from '@/components/BridgeDepositPanel'
import WalletAssetPicker from '@/components/WalletAssetPicker'
import {
  FALCON_WALLET_ASSETS,
  NATIVE_CHAIN_WALLETS,
  multiChainAssetById,
  type FalconAssetId,
  type MultiChainAssetId,
} from '@/lib/multi-chain-assets'
import {
  FALCON_ROW_IDS,
  FALCON_ROW_LABELS,
  MULTI_ROW_IDS,
  MULTI_ROW_LABELS,
  loadFalconVisibility,
  loadMultiVisibility,
  saveFalconVisibility,
  saveMultiVisibility,
  type MultiChainRowId,
} from '@/lib/wallet-row-visibility'
import {
  falconRowBalance,
  multiRowBalance,
  parseFalconBalances,
  tokenChipClass,
  shortTokenLabel,
} from '@/lib/wallet-ui'
import { fetchSpotPrices, multiChainUsdTotal, type SpotPrices } from '@/lib/wallet-prices'
import { fetchSepoliaBalances, sendSepoliaEth } from '@/lib/evm-bridge-client'
import {
  fetchBnbTestnetBalance,
  fetchBtcTestnetBalance,
  sendBnbTestnet,
} from '@/lib/native-chain-balances'
import {
  createBtcWalletForPasskey,
  encryptBtcKeyForPasskey,
  hasBtcWallet,
  provisionBtcWalletForStoredWallet,
} from '@/lib/create-btc-wallet'
import {
  isValidBtcP2pkh,
  sendBtcP2pkh,
  type BtcBalance,
} from '@/lib/btc-client'
import { parseEvmAddressFromScan } from '@/lib/parse-evm-address'


const AddressQrScanner = dynamic(() => import('@/components/AddressQrScanner'), { ssr: false })

// ─── Types ────────────────────────────────────────────────────────────────────

interface TxRecord {
  hash:         string
  type:         string
  amount?:      string
  amountAsset?: string
  destination?: string
  destinationName?: string | null
  account:      string
  accountName?: string | null
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
  tokens?: Array<{
    id: string
    symbol: string
    balance: number
    currency: string
    issuer: string
    hasTrustLine: boolean
  }>
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
  accountName?: string | null
  accountNameStatus?: 'active' | 'releasing' | null
  names?: Record<string, string>
}

interface LendSupplySummary {
  shares: number
  sharePct: number | null
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
  evmAddress: string
  evmPrivateKeyHex: string
  evmEncrypted: StoredWallet['evmEncrypted']
  btcAddress: string
  btcAddressMainnet: string
  btcPrivateKeyHex: string
  btcEncrypted: StoredWallet['btcEncrypted']
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
    tx_per_sec?: number | null
    tx_per_min?: number | null
    total_txs?: number | null
    last_ledger_txs?: number | null
    tx_index_complete?: boolean
    tx_index_scanned_through?: number | null
    tx_index_tip?: number | null
    tx_index_progress_pct?: number | null
    tx_index_scanning?: boolean
    tx_index_remaining?: number | null
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

/** Human uptime — never show "0h" / bare "0" for short runtimes. */
function fmtUptimeSeconds(sec: number | null | undefined): string {
  if (sec == null || Number.isNaN(Number(sec))) return '—'
  const s = Math.max(0, Math.floor(Number(sec)))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return `${m}m`
  return s > 0 ? '<1m' : 'just started'
}

function fmtTxPerSec(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  if (v >= 10) return `${v.toFixed(1)}/s`
  if (v >= 1) return `${v.toFixed(2)}/s`
  if (v > 0) return `${v.toFixed(3)}/s`
  return '0/s'
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
  const [lendSupply, setLendSupply] = useState<LendSupplySummary | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [busy,    setBusy]    = useState(false)
  const [copied,  setCopied]  = useState(false)
  const [nodeName, setNodeName] = useState('my-falcon-node')
  const [savedNode, setSavedNode] = useState<SavedValidatorNode | null>(null)
  const [nodeHostInput, setNodeHostInput] = useState('')
  const [nodeStats, setNodeStats] = useState<NodeStatsPayload | null>(null)
  const [networkStats, setNetworkStats] = useState<NodeStatsPayload['network'] | null>(null)
  const [nodeStatsError, setNodeStatsError] = useState<string | null>(null)
  const [nodeStatsLoading, setNodeStatsLoading] = useState(false)
  const [showNodeSetup, setShowNodeSetup] = useState(false)
  const [bridgeCfg, setBridgeCfg] = useState<(UsdcBridgeManifest & { lock_contract_ready?: boolean }) | null>(null)
  const [walletSection, setWalletSection] = useState<'falcon' | 'multichain' | 'bridge'>('falcon')
  const [showRowCustomize, setShowRowCustomize] = useState(false)
  const [falconVisible, setFalconVisible] = useState<Record<FalconAssetId, boolean>>({
    falcon: true,
    fusdc: true,
    feth: true,
    fbtc: true,
    fbnb: true,
  })
  const [multiVisible, setMultiVisible] = useState<Record<MultiChainRowId, boolean>>({
    eth: true,
    usdc: true,
    btc: true,
    bnb: true,
  })
  const [hideZeroBalances, setHideZeroBalances] = useState(false)
  const [assetSearch, setAssetSearch] = useState('')
  const [balanceFlash, setBalanceFlash] = useState(0)
  const [panelKey, setPanelKey] = useState(0)
  const [transferPicker, setTransferPicker] = useState<null | 'send' | 'receive'>(null)
  const [spotPrices, setSpotPrices] = useState<SpotPrices>({ eth: 0, btc: 0, bnb: 0, usdc: 1 })
  const [bridgeInitialMode, setBridgeInitialMode] = useState<'deposit' | 'withdraw' | 'send' | 'receive'>('deposit')
  const [bridgeInitialRoute, setBridgeInitialRoute] = useState<
    'fusdc-sepolia' | 'feth-sepolia' | 'fbnb-bsc' | 'fbtc-btc'
  >('fusdc-sepolia')
  const [receiveAssetId, setReceiveAssetId] = useState<MultiChainAssetId>('falcon')
  const [ethNativeBal, setEthNativeBal] = useState<string | null>(null)
  const [usdcNativeBal, setUsdcNativeBal] = useState<string | null>(null)
  const [bnbNativeBal, setBnbNativeBal] = useState<string | null>(null)
  const [btcNativeBal, setBtcNativeBal] = useState<BtcBalance | null>(null)
  const [nativeBalLoading, setNativeBalLoading] = useState(false)
  const [bridgeMissing, setBridgeMissing] = useState(false)
  const bridgeAutoProvisioned = useRef(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('bridge') === '1' || params.get('section') === 'bridge') {
      setWalletSection('bridge')
    }
  }, [])

  useEffect(() => {
    setFalconVisible(loadFalconVisibility())
    setMultiVisible(loadMultiVisibility())
    try {
      if (localStorage.getItem('falcon-wallet-hide-zero-v1') === '1') setHideZeroBalances(true)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (walletSection !== 'multichain' && walletSection !== 'bridge') return
    let cancelled = false
    void fetchSpotPrices().then((p) => {
      if (!cancelled) setSpotPrices(p)
    })
    return () => {
      cancelled = true
    }
  }, [walletSection])


  // Create-wallet form
  const [createLabel, setCreateLabel] = useState('')

  // Send form (Falcon IOUs + native multi-chain)
  const [sendAsset,  setSendAsset]  = useState<'falcon' | 'fusdc' | 'feth' | 'fbnb' | 'fbtc' | 'btc' | 'bnb' | 'eth'>('falcon')
  const [sendTo,     setSendTo]     = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sendResult, setSendResult] = useState<{
    success: boolean; hash?: string; message: string; explorerUrl?: string
  } | null>(null)
  const [showSendScanner, setShowSendScanner] = useState(false)

  // Account name (AccountNames amendment)
  const [accountName, setAccountName] = useState<string | null>(null)
  const [accountNameStatus, setAccountNameStatus] = useState<'active' | 'releasing' | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [nameAvailability, setNameAvailability] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  >('idle')
  const [nameBusy, setNameBusy] = useState(false)
  const [nameMsg, setNameMsg] = useState<string | null>(null)
  const [showRemoveNameModal, setShowRemoveNameModal] = useState(false)

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
      const fetchOpts: RequestInit = { cache: 'no-store' }
      const [accR, assetsR, lendR] = await Promise.all([
        fetch(withNetworkQuery(`/api/wallet/account?address=${encodeURIComponent(address)}`, networkKey), fetchOpts),
        fetch(withNetworkQuery(`/api/wallet/assets?address=${encodeURIComponent(address)}`, networkKey), fetchOpts),
        fetch(withNetworkQuery(`/api/lend/overview?address=${encodeURIComponent(address)}`, networkKey), fetchOpts),
      ])
      if (!accR.ok) return
      const data: AccountData = await accR.json()
      if (assetsR.ok) {
        const assetsData = await assetsR.json()
        if (assetsData.assets) data.assets = assetsData.assets
      }
      setAccount(data)

      // Own name: prefer account API, then dedicated name route, then cache
      const cached = readCachedAccountName(address)
      let resolvedName = data.accountName ?? null
      let resolvedStatus: 'active' | 'releasing' | null =
        data.accountNameStatus ?? (resolvedName ? 'active' : null)

      if (!resolvedName) {
        try {
          const nameR = await fetch(
            withNetworkQuery(`/api/wallet/name?address=${encodeURIComponent(address)}`, networkKey),
            fetchOpts,
          )
          if (nameR.ok) {
            const nj = (await nameR.json()) as {
              name?: string | null
              status?: 'active' | 'releasing'
            }
            if (nj.name) {
              resolvedName = nj.name
              resolvedStatus = nj.status ?? 'active'
            }
          }
        } catch {
          /* ignore */
        }
      }

      if (resolvedName) {
        setAccountName(resolvedName)
        setAccountNameStatus(resolvedStatus ?? 'active')
        cacheAccountName(address, resolvedName, resolvedStatus ?? 'active')
      } else if (cached) {
        setAccountName(cached.name)
        setAccountNameStatus(cached.status)
      } else {
        setAccountName(null)
        setAccountNameStatus(null)
        cacheAccountName(address, null)
      }
      setBalanceFlash((n) => n + 1)

      if (lendR.ok) {
        const lend = await lendR.json() as {
          lpPositions?: Array<{ vaultId: string; shareBalance: number }>
          vaults?: Array<{ id: string; sharesOutstanding: number }>
        }
        const positions = lend.lpPositions ?? []
        const shares = positions.reduce((s, p) => s + (p.shareBalance ?? 0), 0)
        const vaultById = new Map((lend.vaults ?? []).map((v) => [v.id, v.sharesOutstanding]))
        let sharePct: number | null = null
        if (shares > 0) {
          const totals = positions.map((p) => {
            const outstanding = vaultById.get(p.vaultId) ?? 0
            return outstanding > 0 ? (p.shareBalance / outstanding) * 100 : null
          }).filter((x): x is number => x != null)
          if (totals.length > 0) {
            sharePct = totals.reduce((a, b) => a + b, 0) / totals.length
          }
        }
        setLendSupply({ shares, sharePct })
      }
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

  // Native multi-chain balances — each chain independent so one RPC failure
  // does not wipe the others (previously Promise.all + catch cleared BTC too).
  useEffect(() => {
    if (walletSection !== 'multichain' && walletSection !== 'bridge') return
    if (!wallet) return
    let cancelled = false
    setNativeBalLoading(true)

    const ethP =
      wallet.evmAddress && bridgeCfg?.sepolia
        ? fetchSepoliaBalances(bridgeCfg.sepolia, wallet.evmAddress).catch(() => null)
        : Promise.resolve(null)
    const bnbP = wallet.evmAddress
      ? fetchBnbTestnetBalance(wallet.evmAddress).catch(() => null)
      : Promise.resolve(null)
    const btcP = wallet.btcAddress
      ? fetchBtcTestnetBalance(wallet.btcAddress).catch(() => null)
      : Promise.resolve(null)

    void Promise.all([ethP, bnbP, btcP]).then(([ethB, bnbB, btcB]) => {
      if (cancelled) return
      if (ethB) {
        setEthNativeBal(ethB.eth)
        setUsdcNativeBal(ethB.usdc)
      } else if (wallet.evmAddress) {
        // keep previous eth/usdc on transient fail; only clear if never loaded
      }
      setBnbNativeBal(bnbB)
      setBtcNativeBal(btcB)
      setNativeBalLoading(false)
    })

    return () => { cancelled = true }
  }, [walletSection, wallet?.evmAddress, wallet?.btcAddress, bridgeCfg, wallet])

  // Auto-provision missing BTC deposit key (same passkey vault)
  useEffect(() => {
    if (!wallet || hasBtcWallet(wallet) || busy || view !== 'dashboard') return
    if (walletSection !== 'multichain' && walletSection !== 'bridge') return
    void provisionBtcWalletForStoredWallet(wallet)
      .then((w) => setWallet(w))
      .catch(() => { /* user can retry via Open Bridge */ })
  }, [wallet, walletSection, view, busy])

  // ── On mount: load wallet from IndexedDB ──────────────────────────────────

  /** Public full-history dashboard (network-wide metrics). */
  const FULL_DASH_HOST = '46.224.0.140'
  const FULL_DASH_PORT = 8080

  const fetchDashStats = useCallback(async (host: string, port: number) => {
    const q = new URLSearchParams({ host, port: String(port) })
    const r = await fetch(`/api/node-dashboard?${q.toString()}`)
    const data = await r.json()
    if (!r.ok) {
      throw new Error(data.error || data.hint || 'Dashboard unreachable')
    }
    return data as NodeStatsPayload
  }, [])

  const refreshNodeStats = useCallback(async (host: string, port?: number, nodeNameHint?: string) => {
    setNodeStatsLoading(true)
    setNodeStatsError(null)
    const tryPorts = [
      port && port > 0 ? port : 8080,
      8080,
      8081,
    ].filter((p, i, a) => a.indexOf(p) === i)

    // Network / full-node metrics (independent of personal node)
    void fetchDashStats(FULL_DASH_HOST, FULL_DASH_PORT)
      .then((data) => {
        if (data.network) setNetworkStats(data.network)
      })
      .catch(() => { /* keep last good network stats */ })

    try {
      let lastErr: Error | null = null
      let data: NodeStatsPayload | null = null
      let workingPort = tryPorts[0]
      for (const p of tryPorts) {
        try {
          data = await fetchDashStats(host, p)
          workingPort = p
          break
        } catch (e: unknown) {
          lastErr = e instanceof Error ? e : new Error(String(e))
        }
      }
      if (!data) throw lastErr || new Error('Dashboard unreachable')
      setNodeStats(data)
      if (data.network) setNetworkStats(data.network)
      // Persist working port (e.g. val2 on 8081) without depending on savedNode state
      if (workingPort && workingPort !== port) {
        const fixed = saveValidatorNode(
          `${host}:${workingPort}`,
          nodeNameHint || 'my-falcon-node',
        )
        setSavedNode(fixed)
      }
    } catch (e: unknown) {
      setNodeStats(null)
      setNodeStatsError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setNodeStatsLoading(false)
    }
  }, [fetchDashStats])

  const handleLinkValidatorNode = () => {
    const host = nodeHostInput.trim()
    if (!host) {
      setError('Enter dashboard host: public IP, domain, or host:port (e.g. 46.224.0.140 or 46.224.0.140:8080). Not the RPC :6005 port.')
      return
    }
    const saved = saveValidatorNode(host, nodeName)
    // Guard against RPC port paste producing broken double-port URLs
    if (saved.port === 6005 || saved.port === 5005) {
      const fixed = saveValidatorNode(`${saved.host}:8080`, nodeName)
      setSavedNode(fixed)
      setShowNodeSetup(false)
      setError(null)
      void refreshNodeStats(fixed.host, fixed.port, fixed.nodeName)
      return
    }
    setSavedNode(saved)
    setShowNodeSetup(false)
    setError(null)
    void refreshNodeStats(saved.host, saved.port, saved.nodeName)
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
      refreshNodeStats(savedNode.host, savedNode.port, savedNode.nodeName)
      const id = setInterval(
        () => refreshNodeStats(savedNode.host, savedNode.port, savedNode.nodeName),
        15000,
      )
      return () => clearInterval(id)
    }
  }, [view, savedNode, showNodeSetup, refreshNodeStats])

  useEffect(() => {
    loadPrimaryWallet().then(primary => {
      if (primary) {
        setWallet(primary)
        setBridgeMissing(!hasBridgeWallet(primary))
        setView('dashboard')
        refreshBalance(primary.address)
      } else {
        setBridgeMissing(false)
        setView('no-wallet')
      }
    }).catch(() => setView('no-wallet'))
  }, [refreshBalance])

  // Auto-repair wallets saved without a Sepolia bridge key (one passkey prompt).
  useEffect(() => {
    if (
      view !== 'dashboard' ||
      !wallet ||
      !bridgeMissing ||
      bridgeAutoProvisioned.current ||
      busy
    ) {
      return
    }
    bridgeAutoProvisioned.current = true
    void (async () => {
      setBusy(true)
      setError(null)
      try {
        const updated = await provisionBridgeWalletForStoredWallet(wallet)
        setWallet(updated)
        setBridgeMissing(false)
        setWalletSection('bridge')
      } catch (e: unknown) {
        bridgeAutoProvisioned.current = false
        setError(
          e instanceof Error
            ? e.message
            : 'Bridge wallet setup failed — use the button below or open Bridge',
        )
      } finally {
        setBusy(false)
      }
    })()
  }, [view, wallet, bridgeMissing, busy])

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
      const { address: evmAddress, privateKeyHex: evmPrivateKeyHex } = createRandomEvmWallet()
      const evmEncrypted = await encryptSeed(evmPrivateKeyHex, keyBytes, hasPrf)
      const btc = await createBtcWalletForPasskey(keyBytes, hasPrf)

      setPendingSave({
        credentialId,
        address,
        publicKey,
        label,
        encrypted,
        hasPrf,
        falcon_secret,
        evmAddress,
        evmPrivateKeyHex,
        evmEncrypted,
        btcAddress: btc.address,
        btcAddressMainnet: btc.addressMainnet,
        btcPrivateKeyHex: btc.privateKeyHex,
        btcEncrypted: btc.btcEncrypted,
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
      if (!pendingSave.evmAddress || !pendingSave.evmEncrypted) {
        throw new Error('Sepolia bridge wallet was not created — please create the wallet again')
      }

      const {
        falcon_secret: _secret,
        evmPrivateKeyHex: _evmPk,
        btcPrivateKeyHex: _btcPk,
        ...rest
      } = pendingSave
      const stored: StoredWallet = {
        ...rest,
        createdAt: Date.now(),
        evmAddress: pendingSave.evmAddress,
        evmEncrypted: pendingSave.evmEncrypted,
        btcAddress: pendingSave.btcAddress,
        btcAddressMainnet: pendingSave.btcAddressMainnet,
        btcEncrypted: pendingSave.btcEncrypted,
      }
      await replacePrimaryWallet(stored)
      const verified = await loadPrimaryWallet()
      if (!verified || !hasBridgeWallet(verified)) {
        throw new Error('Wallet saved but Sepolia bridge keys did not persist — try again in this browser tab')
      }
      setWallet(verified)
      setBridgeMissing(false)
      bridgeAutoProvisioned.current = true
      setPendingSave(null)
      setBackupPassphrase('')
      setBackupPassConfirm('')
      setBackupDownloaded(false)
      setBackupAcknowledged(false)
      setWeakEncryptionAck(false)
      setView('dashboard')
      setWalletSection('bridge')
      refreshBalance(verified.address)
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
        evm_private_key: pendingSave.evmPrivateKeyHex,
        evm_address: pendingSave.evmAddress,
        btc_private_key: pendingSave.btcPrivateKeyHex,
        btc_address: pendingSave.btcAddress,
        btc_address_mainnet: pendingSave.btcAddressMainnet,
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

  const finishRestore = async (
    falconSecret: string,
    label: string,
    bridgeFromBackup?: Pick<
      BackupPayload,
      'evm_private_key' | 'evm_address' | 'btc_private_key' | 'btc_address' | 'btc_address_mainnet'
    >,
  ) => {
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
      const evm = bridgeFromBackup?.evm_private_key && bridgeFromBackup.evm_address
        ? await encryptEvmKeyForPasskey(bridgeFromBackup.evm_private_key, keyBytes, hasPrf)
        : await createEvmWalletForPasskey(keyBytes, hasPrf)
      if (
        bridgeFromBackup?.evm_address &&
        evm.address.toLowerCase() !== bridgeFromBackup.evm_address.toLowerCase()
      ) {
        throw new Error('EVM key in backup does not match the stored address')
      }

      const btc = bridgeFromBackup?.btc_private_key
        ? await encryptBtcKeyForPasskey(bridgeFromBackup.btc_private_key, keyBytes, hasPrf)
        : await createBtcWalletForPasskey(keyBytes, hasPrf)
      if (
        bridgeFromBackup?.btc_address &&
        btc.address !== bridgeFromBackup.btc_address &&
        bridgeFromBackup.btc_address_mainnet !== btc.addressMainnet
      ) {
        // Prefer restoring the key; recompute addresses from key (already done in encryptBtcKey)
      }

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
        btcAddress: btc.address,
        btcAddressMainnet: btc.addressMainnet,
        btcEncrypted: btc.btcEncrypted,
      }
      await replacePrimaryWallet(stored)

      setWallet(stored)
      setBridgeMissing(!hasBridgeWallet(stored))
      setRestoreSeed('')
      setRestorePassphrase('')
      setView('dashboard')
      setWalletSection(hasBridgeWallet(stored) ? 'multichain' : 'falcon')
      refreshBalance(address)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Restore failed')
    } finally {
      setBusy(false)
    }
  }

  const handleProvisionBridge = async () => {
    if (!wallet || hasBridgeWallet(wallet)) return
    setBusy(true)
    setError(null)
    try {
      const updated = await provisionBridgeWalletForStoredWallet(wallet)
      setWallet(updated)
      setBridgeMissing(false)
      setWalletSection('bridge')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create bridge wallet')
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
      if (!backupHasBridgeKeys(payload)) {
        throw new Error(
          'This backup file only contains Falcon keys. Export a new falcon-backup file from Wallet — current backups include Falcon and Sepolia together.',
        )
      }
      await finishRestore(payload.falcon_secret, payload.label || restoreLabel, {
        evm_private_key: payload.evm_private_key,
        evm_address: payload.evm_address,
        btc_private_key: payload.btc_private_key,
        btc_address: payload.btc_address,
        btc_address_mainnet: payload.btc_address_mainnet,
      })
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
      if (!wallet.evmEncrypted || !wallet.evmAddress) {
        throw new Error('Sepolia bridge wallet is missing — add it from Bridge before exporting backup')
      }
      const evm_private_key = (await decryptSeed(wallet.evmEncrypted, keyBytes)).replace(/^0x/i, '')
      let btc_private_key: string | undefined
      let btc_address = wallet.btcAddress
      let btc_address_mainnet = wallet.btcAddressMainnet
      if (wallet.btcEncrypted) {
        btc_private_key = (await decryptSeed(wallet.btcEncrypted, keyBytes)).replace(/^0x/i, '')
      } else {
        const btc = await createBtcWalletForPasskey(keyBytes, wallet.hasPrf)
        btc_private_key = btc.privateKeyHex
        btc_address = btc.address
        btc_address_mainnet = btc.addressMainnet
        const withBtc = {
          ...wallet,
          btcAddress: btc.address,
          btcAddressMainnet: btc.addressMainnet,
          btcEncrypted: btc.btcEncrypted,
        }
        await saveWallet(withBtc)
        setWallet(withBtc)
      }
      const file = await createEncryptedBackup({
        falcon_secret,
        address: wallet.address,
        publicKey: wallet.publicKey,
        label: wallet.label,
        createdAt: wallet.createdAt,
        evm_private_key,
        evm_address: wallet.evmAddress,
        btc_private_key,
        btc_address,
        btc_address_mainnet,
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

  const handleRemoveWallet = async () => {
    if (!wallet) return
    if (
      !confirm(
        'Remove this wallet from this device? This deletes your Falcon wallet and Sepolia bridge wallet (0x address). Save backups first — on-chain balances at old addresses are not erased.',
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await removeWalletFromDevice()
      clearValidatorNode()
      setPendingSave(null)
      setWallet(null)
      setAccount(null)
      setView('no-wallet')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to remove wallet')
    } finally {
      setBusy(false)
    }
  }

  // ── Send transaction ──────────────────────────────────────────────────────

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!wallet) return

    const isNative = sendAsset === 'btc' || sendAsset === 'bnb' || sendAsset === 'eth'
    if (!isNative && !account) return
    if (!isNative && !network.live) {
      setError(`${network.name} is not live yet.`)
      return
    }

    // ── Native multi-chain send (BTC / BNB / ETH) ───────────────────────────
    if (isNative) {
      let to = sendTo.trim()
      const amt = parseFloat(sendAmount)
      if (isNaN(amt) || amt <= 0) {
        setError('Invalid amount')
        return
      }

      if (sendAsset === 'btc') {
        if (!wallet.btcEncrypted || !wallet.btcAddress) {
          setError('Bitcoin wallet not set up — open Multi-chain to provision keys')
          return
        }
        if (!isValidBtcP2pkh(to, 'testnet')) {
          setError('Invalid Bitcoin testnet address (expect m… or n… P2PKH)')
          return
        }
        if (to === wallet.btcAddress) {
          setError('Destination must be a different Bitcoin address')
          return
        }
        if (btcNativeBal && amt > btcNativeBal.totalSats / 1e8) {
          setError('Insufficient BTC balance')
          return
        }
      } else {
        const evmTo = parseEvmAddressFromScan(to) || to
        to = evmTo
        if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
          setError('Invalid EVM address (0x…)')
          return
        }
        if (!wallet.evmEncrypted || !wallet.evmAddress) {
          setError('ETH/BNB wallet not set up — open Bridge to create one')
          return
        }
        if (to.toLowerCase() === wallet.evmAddress.toLowerCase()) {
          setError('Destination must be a different address')
          return
        }
        if (sendAsset === 'bnb' && bnbNativeBal != null && amt > parseFloat(bnbNativeBal)) {
          setError('Insufficient BNB balance')
          return
        }
        if (sendAsset === 'eth' && ethNativeBal != null && amt > parseFloat(ethNativeBal)) {
          setError('Insufficient ETH balance')
          return
        }
        if (sendAsset === 'eth' && !bridgeCfg?.sepolia) {
          setError('Bridge config not loaded')
          return
        }
      }

      setBusy(true)
      setError(null)
      setSendResult(null)
      try {
        const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
        if (sendAsset === 'btc') {
          const btcPk = (await decryptSeed(wallet.btcEncrypted!, keyBytes)).replace(/^0x/i, '')
          const result = await sendBtcP2pkh({
            privateKeyHex: btcPk,
            toAddress: to,
            amountBtc: sendAmount.trim(),
            network: 'testnet',
          })
          setSendResult({
            success: true,
            hash: result.txid,
            message: `Broadcast ${sendAmount} BTC (fee ~${(result.feeSats / 1e8).toFixed(8)} BTC)`,
            explorerUrl: result.explorerUrl,
          })
          setSendTo('')
          setSendAmount('')
          // refresh balance
          if (wallet.btcAddress) {
            void fetchBtcTestnetBalance(wallet.btcAddress).then(setBtcNativeBal)
          }
        } else {
          const evmPk = await decryptSeed(wallet.evmEncrypted!, keyBytes)
          const pk = evmPk.startsWith('0x') ? evmPk : `0x${evmPk}`
          if (sendAsset === 'bnb') {
            const hash = await sendBnbTestnet({
              evmPrivateKey: pk,
              to,
              amountBnb: sendAmount.trim(),
            })
            setSendResult({
              success: true,
              hash,
              message: `Sent ${sendAmount} BNB on BSC testnet`,
              explorerUrl: `https://testnet.bscscan.com/tx/${hash}`,
            })
            if (wallet.evmAddress) {
              void fetchBnbTestnetBalance(wallet.evmAddress).then(setBnbNativeBal)
            }
          } else {
            const hash = await sendSepoliaEth({
              cfg: bridgeCfg!.sepolia,
              evmPrivateKey: pk,
              to,
              amountEth: sendAmount.trim(),
            })
            setSendResult({
              success: true,
              hash,
              message: `Sent ${sendAmount} ETH on Sepolia`,
              explorerUrl: `${bridgeCfg!.sepolia.explorer_url}/tx/${hash}`,
            })
            if (wallet.evmAddress && bridgeCfg?.sepolia) {
              void fetchSepoliaBalances(bridgeCfg.sepolia, wallet.evmAddress).then((b) => {
                setEthNativeBal(b.eth)
                setUsdcNativeBal(b.usdc)
              })
            }
          }
          setSendTo('')
          setSendAmount('')
        }
      } catch (err: unknown) {
        setSendResult({
          success: false,
          message: err instanceof Error ? err.message : 'Send failed',
        })
      } finally {
        setBusy(false)
      }
      return
    }

    // Resolve destination: r-address, QR paste, or claimed name (alice.bob)
    let to = sendTo.trim()
    const extracted = parseFalconAddressFromScan(to)
    if (extracted) to = extracted

    const destNameNorm = !isValidFalconAddress(to) ? normalizeAccountName(to) : null
    if (destNameNorm) {
      try {
        const r = await fetch(
          withNetworkQuery(`/api/wallet/name?name=${encodeURIComponent(destNameNorm)}`, networkKey),
        )
        const j = (await r.json()) as {
          available?: boolean
          owner?: string
          error?: string
          status?: string
        }
        if (j.available) {
          setError(`Name “${destNameNorm}” is not claimed yet`)
          return
        }
        if (!r.ok || !j.owner || !isValidFalconAddress(String(j.owner).trim())) {
          setError(j.error || `Could not resolve “${destNameNorm}” to an address`)
          return
        }
        if (j.status === 'releasing') {
          setError(`Name “${destNameNorm}” is releasing and cannot receive by name`)
          return
        }
        to = String(j.owner).trim()
      } catch {
        setError('Could not resolve named address — check network and try again')
        return
      }
    }

    const amt = parseFloat(sendAmount)
    const fusdc = account!.assets?.fusdc
    const fusdcBal = fusdc?.balance ?? 0
    const fethTok = account!.assets?.tokens?.find(
      (t) => t.currency === 'ETH' || t.symbol === 'FETH',
    )
    const fethBal = fethTok?.balance ?? 0
    const fbnbTok = account!.assets?.tokens?.find(
      (t) => t.currency === 'BNB' || t.symbol === 'FBNB',
    )
    const fbnbBal = fbnbTok?.balance ?? 0
    const fbtcTok = account!.assets?.tokens?.find(
      (t) => t.currency === 'BTC' || t.symbol === 'FBTC',
    )
    const fbtcBal = fbtcTok?.balance ?? 0

    if (!isValidFalconAddress(to)) {
      setError('Invalid destination — use an r… address or a claimed name (e.g. alice.bob)')
      return
    }
    if (to === wallet.address) {
      setError('Destination must be a different Falcon address')
      return
    }
    if (isNaN(amt) || amt <= 0) {
      setError('Invalid amount'); return
    }
    if (sendAsset === 'falcon') {
      if (amt > account!.balance) {
        setError('Insufficient FALCON balance'); return
      }
    } else if (sendAsset === 'feth') {
      if (!fethTok?.issuer || fethTok.hasTrustLine === false) {
        setError('Add a FETH trust line on Bridge before sending'); return
      }
      if (amt > fethBal) {
        setError('Insufficient FETH balance'); return
      }
    } else if (sendAsset === 'fbnb') {
      if (!fbnbTok?.issuer || fbnbTok.hasTrustLine === false) {
        setError('Add a FBNB trust line on Bridge before sending'); return
      }
      if (amt > fbnbBal) {
        setError('Insufficient FBNB balance'); return
      }
    } else if (sendAsset === 'fbtc') {
      if (!fbtcTok?.issuer || fbtcTok.hasTrustLine === false) {
        setError('Add a FBTC trust line on Bridge before sending'); return
      }
      if (amt > fbtcBal) {
        setError('Insufficient FBTC balance'); return
      }
    } else {
      if (!fusdc?.issuer || fusdc.hasTrustLine === false) {
        setError('Add a F-USDC trust line on Swap or Bridge before sending'); return
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
          return { sequence: account!.sequence, currentLedger: account!.currentLedger }
        }
      }

      const data = await submitWithSequenceRetry({
        networkKey,
        fetchSequence,
        sign: ({ sequence, lastLedgerSequence }) => {
          if (sendAsset === 'falcon') {
            return signPayment(
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
          }
          const iou =
            sendAsset === 'feth'
              ? { issuer: fethTok!.issuer, currency: fethTok!.currency }
              : sendAsset === 'fbnb'
                ? { issuer: fbnbTok!.issuer, currency: fbnbTok!.currency }
                : sendAsset === 'fbtc'
                  ? { issuer: fbtcTok!.issuer, currency: fbtcTok!.currency }
                  : { issuer: fusdc!.issuer, currency: fusdc!.currency }
          return signFusdcPayment(
            {
              account:            wallet.address,
              destination:        to,
              issuer:             iou.issuer,
              currency:           iou.currency,
              amount:             String(amt),
              sequence,
              lastLedgerSequence,
              networkId:          network.networkId,
            },
            falcon_secret,
          )
        },
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
    <ProductShell intensity={0.4}>

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
                  One passkey creates your Falcon and Sepolia bridge wallets together. One backup file restores both.
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
                  One backup file holds both your Falcon and Sepolia bridge keys. Download it, then tap Continue.
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
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide">Falcon address</div>
                  <div className="font-mono text-xs text-emerald-300 break-all">{pendingSave.address}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide">Sepolia bridge address</div>
                  <div className="font-mono text-xs text-cyan-300 break-all">{pendingSave.evmAddress}</div>
                  <p className="text-[10px] text-slate-600">
                    Included in the same encrypted backup file as your Falcon wallet.
                  </p>
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
                  {backupDownloaded ? 'Download again ✓' : 'Download Falcon + Sepolia backup file'}
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
                Upload your <span className="font-mono">falcon-backup-….json</span> file (Falcon + Sepolia keys in one file).
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
              {view === 'dashboard' && bridgeMissing && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 space-y-2">
                  <p>
                    <span className="font-semibold text-amber-200">Sepolia bridge wallet not set up on this device.</span>{' '}
                    Your Falcon wallet is saved, but the 0x bridge address was not stored locally.
                  </p>
                  <p className="text-xs text-amber-200/80">
                    Restore from your <span className="font-mono">falcon-backup-….json</span> to recover both wallets on a new device.
                  </p>
                  <button
                    type="button"
                    onClick={handleProvisionBridge}
                    disabled={busy}
                    className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm disabled:opacity-50"
                  >
                    {busy ? 'Creating bridge wallet…' : 'Create bridge wallet with passkey'}
                  </button>
                </div>
              )}

              {view === 'dashboard' && (
                <div className="wallet-glass p-1.5 flex gap-1">
                  {(
                    [
                      { id: 'falcon' as const, label: 'Falcon' },
                      { id: 'multichain' as const, label: 'Multi-chain' },
                      { id: 'bridge' as const, label: 'Bridge' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setWalletSection(tab.id)
                        setPanelKey((k) => k + 1)
                        if (tab.id === 'bridge') setBridgeInitialMode('deposit')
                        refreshBalance(wallet.address)
                      }}
                      className={`wallet-tab-pill ${
                        walletSection === tab.id
                          ? 'bg-brand-500/15 text-brand-400 shadow-[inset_0_0_0_1px_rgba(192,120,56,0.35)]'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Network health */}
              {view === 'dashboard' && (walletSection === 'falcon' || walletSection === 'multichain') && (
                <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        network.live && account?.exists
                          ? 'bg-emerald-400 animate-pulse-slow'
                          : network.live
                            ? 'bg-amber-400'
                            : 'bg-slate-600'
                      }`}
                    />
                    {network.live
                      ? account?.exists
                        ? 'Network live'
                        : 'Network live · account not activated'
                      : 'Network offline'}
                  </span>
                  {account?.currentLedger != null && (
                    <span className="font-mono text-slate-600">
                      ledger {account.currentLedger.toLocaleString()}
                    </span>
                  )}
                </div>
              )}

              {view === 'dashboard' && (walletSection === 'falcon' || walletSection === 'multichain') && (
              <div key={panelKey} className="wallet-glass p-5 space-y-4 wallet-panel-enter">
                {/* Identity — Falcon Wallet only */}
                {walletSection === 'falcon' && (
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {accountName ? (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <div className="text-2xl sm:text-xl font-semibold text-emerald-300 tracking-tight break-all leading-tight">
                            {accountName}
                            {accountNameStatus === 'releasing' && (
                              <span className="ml-2 align-middle text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                releasing
                              </span>
                            )}
                          </div>
                          {account?.exists && network.live && accountNameStatus !== 'releasing' && (
                            <button
                              type="button"
                              disabled={nameBusy}
                              onClick={() => setShowRemoveNameModal(true)}
                              className="shrink-0 text-[11px] font-medium text-slate-500 hover:text-rose-300 underline underline-offset-2 decoration-slate-600 hover:decoration-rose-400/60 disabled:opacity-40"
                            >
                              Remove name from this wallet
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm font-medium text-slate-200">
                          {wallet.label || 'Falcon wallet'}
                        </div>
                      )}
                      <div className="text-xs text-slate-500 mt-0.5">
                        {accountName ? `${wallet.label || 'Wallet'} · Falcon` : 'Falcon'}
                      </div>
                      <button
                        type="button"
                        onClick={copyAddress}
                        className="mt-1 font-mono text-slate-400 text-sm hover:text-slate-200 break-all text-left"
                        title="Copy full address"
                      >
                        {copied ? 'Copied!' : shortAddr(wallet.address)}
                      </button>
                    </div>
                    <button
                      onClick={copyAddress}
                      className="p-2 text-slate-500 hover:text-slate-300 transition-colors shrink-0"
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

                  {accountName && accountNameStatus === 'releasing' && (
                    <div className="w-full rounded-xl border border-amber-500/30 bg-amber-950/25 px-3 py-2 text-xs text-amber-100 leading-relaxed">
                      <span className="font-mono font-semibold">{accountName}</span> is being removed.
                      One-epoch cooldown: name stays reserved to you, name payments are off, and your{' '}
                      {NAME_BOND_FALCON} FALCON bond returns when release finishes. You can claim a new name after that.
                    </div>
                  )}
                  {nameMsg && accountName && (
                    <div className="text-[11px] text-slate-400">{nameMsg}</div>
                  )}
                </div>
                )}

                {/* Portfolio total + primary actions */}
                {(() => {
                  const fb = parseFalconBalances(account)
                  const multiBals = {
                    eth: ethNativeBal != null ? Number(ethNativeBal) : null,
                    usdc: usdcNativeBal != null ? Number(usdcNativeBal) : null,
                    btc: btcNativeBal != null ? Number(btcNativeBal.btc) : null,
                    bnb: bnbNativeBal != null ? Number(bnbNativeBal) : null,
                  }
                  const usdTotal = multiChainUsdTotal(multiBals, spotPrices)
                  const falconTotal = fb.falcon
                  const totalLabel =
                    walletSection === 'falcon'
                      ? falconTotal.toLocaleString(undefined, { maximumFractionDigits: 6 })
                      : usdTotal == null
                        ? '—'
                        : usdTotal.toLocaleString(undefined, {
                            style: 'currency',
                            currency: 'USD',
                            maximumFractionDigits: 2,
                          })
                  const totalUnit = walletSection === 'falcon' ? 'FALCON' : ''
                  const emptyFalcon =
                    walletSection === 'falcon' &&
                    account?.exists &&
                    fb.falcon <= 0 &&
                    fb.fusdc <= 0 &&
                    fb.feth <= 0 &&
                    fb.fbtc <= 0 &&
                    fb.fbnb <= 0

                  const openSendPicker = () => setTransferPicker('send')
                  const openReceivePicker = () => setTransferPicker('receive')
                  const openBridge = () => {
                    // Falcon tab = bridge out (withdraw); Multi-chain = bridge in (deposit)
                    if (walletSection === 'falcon') {
                      setBridgeInitialMode('withdraw')
                      setBridgeInitialRoute('fusdc-sepolia')
                    } else {
                      setBridgeInitialMode('deposit')
                      setBridgeInitialRoute('fusdc-sepolia')
                    }
                    setWalletSection('bridge')
                  }

                  return (
                    <>
                      <div className="rounded-xl border border-brand-500/15 bg-gradient-to-br from-brand-500/10 via-slate-900/40 to-transparent px-4 py-4">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                          {walletSection === 'falcon' ? 'Falcon balance' : 'Portfolio (approx. USD)'}
                        </div>
                        <div
                          key={balanceFlash}
                          className="mt-1 text-3xl font-bold tracking-tight tabular-nums text-white wallet-balance-flash"
                        >
                          {account == null && walletSection === 'falcon' ? (
                            <span className="wallet-skeleton inline-block h-9 w-36 align-middle" />
                          ) : (
                            <>
                              {totalLabel}
                              {totalUnit ? (
                                <span className="text-base font-semibold text-brand-400"> {totalUnit}</span>
                              ) : null}
                            </>
                          )}
                        </div>
                        {walletSection === 'multichain' && (
                          <p className="text-[11px] text-slate-500 mt-1">
                            ETH · USDC · BTC · BNB · spot rates when available
                          </p>
                        )}
                        {walletSection === 'falcon' && (
                          <p className="text-[11px] text-slate-500 mt-1">
                            Bridged assets listed below · use Send / Receive to pick a token
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={copyAddress}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-950/50 px-2.5 py-1 font-mono text-xs text-slate-300 hover:border-brand-500/40 hover:text-brand-300 transition-colors"
                          >
                            {copied ? (
                              <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            )}
                            {copied ? 'Copied' : shortAddr(wallet.address)}
                          </button>
                          {wallet.label && (
                            <span className="text-[11px] text-slate-500 truncate max-w-[8rem]">{wallet.label}</span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={openReceivePicker}
                          className="wallet-action-btn bg-slate-800/80 hover:bg-slate-700 text-slate-100 border border-slate-700/80"
                        >
                          Receive
                        </button>
                        <button
                          type="button"
                          disabled={walletSection === 'falcon' && (!account?.exists || !network.live)}
                          onClick={openSendPicker}
                          className="wallet-action-btn bg-brand-500/90 hover:bg-brand-400 text-slate-950 disabled:opacity-35"
                        >
                          Send
                        </button>
                        <button
                          type="button"
                          onClick={openBridge}
                          className="wallet-action-btn bg-emerald-950/50 hover:bg-emerald-900/40 text-emerald-300 border border-emerald-500/25"
                          title={walletSection === 'falcon' ? 'Bridge out from Falcon' : 'Bridge in to Falcon'}
                        >
                          {walletSection === 'falcon' ? 'Bridge out' : 'Bridge in'}
                        </button>
                      </div>

                      {walletSection === 'falcon' && emptyFalcon && (
                        <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 px-4 py-4 text-center space-y-2">
                          <p className="text-sm text-slate-300">No balances yet on Falcon.</p>
                          <Link
                            href="/faucet"
                            className="inline-flex items-center justify-center px-4 py-2 rounded-xl text-sm font-semibold bg-brand-500 text-slate-950 hover:bg-brand-400"
                          >
                            Get FALCON from faucet
                          </Link>
                        </div>
                      )}
                      {walletSection === 'falcon' && account && !account.exists && (
                        <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 px-4 py-3 text-center space-y-2">
                          <p className="text-sm text-amber-100/90">Account not activated on-chain.</p>
                          <Link
                            href="/faucet"
                            className="inline-flex text-sm font-semibold text-brand-400 hover:text-brand-300"
                          >
                            Top up via faucet →
                          </Link>
                        </div>
                      )}
                    </>
                  )
                })()}

                {/* Remove-name confirm: cooldown explained, then passkey sign */}
                {showRemoveNameModal && accountName && (
                  <div
                    className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="remove-name-title"
                    onClick={(e) => {
                      if (e.target === e.currentTarget && !nameBusy) setShowRemoveNameModal(false)
                    }}
                  >
                    <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl p-5 space-y-4">
                      <div>
                        <h3 id="remove-name-title" className="text-base font-semibold text-white">
                          Remove name from this wallet?
                        </h3>
                        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                          You are about to start releasing{' '}
                          <span className="font-mono text-emerald-300">{accountName}</span>.
                        </p>
                      </div>
                      <ul className="text-[12px] text-slate-400 space-y-2 leading-relaxed list-disc pl-4">
                        <li>
                          <strong className="text-slate-300">One name per wallet</strong> — you cannot mint a second name while this one is held.
                        </li>
                        <li>
                          There is a <strong className="text-slate-300">1 epoch cooldown</strong> before you can pick a new name.
                        </li>
                        <li>
                          During the cooldown the name stays reserved to you; payments <em>by name</em> are rejected. Your <span className="font-mono">r…</span> address still works.
                        </li>
                        <li>
                          Your <strong className="text-slate-300">{NAME_BOND_FALCON} FALCON</strong> bond stays locked until release finishes, then returns. Claiming a new name locks 100 FALCON again.
                        </li>
                      </ul>
                      <p className="text-sm text-slate-300">
                        Are you sure you want to remove this name from your account?
                      </p>
                      <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
                        <button
                          type="button"
                          disabled={nameBusy}
                          onClick={() => setShowRemoveNameModal(false)}
                          className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-40"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={nameBusy}
                          onClick={async () => {
                            if (!wallet || !account || !accountName) return
                            setNameBusy(true)
                            setNameMsg(null)
                            setError(null)
                            try {
                              const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
                              const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)
                              await submitWithSequenceRetry({
                                networkKey,
                                fetchSequence: async () => {
                                  try {
                                    return await fetchSequenceInfo(wallet.address, networkKey)
                                  } catch {
                                    return {
                                      sequence: account.sequence,
                                      currentLedger: account.currentLedger,
                                    }
                                  }
                                },
                                sign: ({ sequence, lastLedgerSequence }) =>
                                  signNameUnbond(
                                    {
                                      account: wallet.address,
                                      name: accountName,
                                      sequence,
                                      lastLedgerSequence,
                                      networkId: network.networkId,
                                    },
                                    falcon_secret,
                                  ),
                              })
                              setAccountNameStatus('releasing')
                              cacheAccountName(wallet.address, accountName, 'releasing')
                              setNameMsg(
                                `Removal started for “${accountName}”. After 1 epoch the bond returns and you can claim a new name.`,
                              )
                              setShowRemoveNameModal(false)
                              await refreshBalance(wallet.address)
                            } catch (e: unknown) {
                              const msg = e instanceof Error ? e.message : String(e)
                              setNameMsg(msg)
                              setError(msg)
                            } finally {
                              setNameBusy(false)
                            }
                          }}
                          className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-40"
                        >
                          {nameBusy ? 'Signing…' : 'Yes, remove name'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">
                      {walletSection === 'falcon' ? 'Bridged assets' : 'Chains & tokens'}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setHideZeroBalances((v) => {
                            const next = !v
                            try {
                              localStorage.setItem('falcon-wallet-hide-zero-v1', next ? '1' : '0')
                            } catch { /* ignore */ }
                            return next
                          })
                        }}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                          hideZeroBalances
                            ? 'border-brand-500/40 bg-brand-500/10 text-brand-400'
                            : 'border-slate-700 bg-slate-800/80 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Hide zero
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowRowCustomize((v) => !v)}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                          showRowCustomize
                            ? 'border-brand-500/40 bg-brand-500/10 text-brand-400'
                            : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:border-brand-500/30 hover:text-brand-400'
                        }`}
                      >
                        Customize
                      </button>
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      type="search"
                      value={assetSearch}
                      onChange={(e) => setAssetSearch(e.target.value)}
                      placeholder={walletSection === 'falcon' ? 'Search assets…' : 'Search chains…'}
                      className="w-full rounded-xl border border-slate-700/80 bg-slate-950/50 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/40"
                    />
                  </div>
                  {showRowCustomize && (walletSection === 'falcon' || walletSection === 'multichain') && (
                    <div className="rounded-xl border border-slate-700/80 bg-slate-900/80 p-3 space-y-2">
                      <p className="text-[11px] text-slate-500">
                        Choose which rows appear. Hidden assets stay in your wallet — only the list is filtered.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {(walletSection === 'falcon' ? FALCON_ROW_IDS.filter((id) => id !== 'falcon') : MULTI_ROW_IDS).map((id) => {
                          const on =
                            walletSection === 'falcon'
                              ? falconVisible[id as FalconAssetId]
                              : multiVisible[id as MultiChainRowId]
                          const label =
                            walletSection === 'falcon'
                              ? FALCON_ROW_LABELS[id as FalconAssetId]
                              : MULTI_ROW_LABELS[id as MultiChainRowId]
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => {
                                if (walletSection === 'falcon') {
                                  const next = {
                                    ...falconVisible,
                                    [id]: !falconVisible[id as FalconAssetId],
                                  }
                                  // Keep at least one row visible
                                  if (!Object.values(next).some(Boolean)) return
                                  setFalconVisible(next)
                                  saveFalconVisibility(next)
                                } else {
                                  const next = {
                                    ...multiVisible,
                                    [id]: !multiVisible[id as MultiChainRowId],
                                  }
                                  if (!Object.values(next).some(Boolean)) return
                                  setMultiVisible(next)
                                  saveMultiVisibility(next)
                                }
                              }}
                              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                                on
                                  ? 'border-brand-500/40 bg-brand-500/15 text-brand-300'
                                  : 'border-slate-700 bg-slate-800/50 text-slate-500'
                              }`}
                            >
                              {on ? '✓ ' : ''}
                              {label}
                            </button>
                          )
                        })}
                      </div>
                      <button
                        type="button"
                        className="text-[11px] text-slate-500 hover:text-brand-400"
                        onClick={() => {
                          if (walletSection === 'falcon') {
                            const all = Object.fromEntries(FALCON_ROW_IDS.map((id) => [id, true])) as Record<
                              FalconAssetId,
                              boolean
                            >
                            setFalconVisible(all)
                            saveFalconVisibility(all)
                          } else {
                            const all = Object.fromEntries(MULTI_ROW_IDS.map((id) => [id, true])) as Record<
                              MultiChainRowId,
                              boolean
                            >
                            setMultiVisible(all)
                            saveMultiVisibility(all)
                          }
                        }}
                      >
                        Show all
                      </button>
                    </div>
                  )}
                  {walletSection === 'multichain' && (
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      <strong className="text-slate-400">Native</strong> wallets on each chain. USDC has its own
                      row (Ethereum). Bridge into Falcon for F-assets — those show under{' '}
                      <strong className="text-slate-400">Falcon Wallet</strong>.
                    </p>
                  )}
                  {walletSection === 'falcon' && !account?.exists && account !== null && (
                    <p className="text-xs text-slate-600">
                      Account not activated — fund your Falcon address first (faucet).
                    </p>
                  )}

                  {/* ── Falcon Ledger rows ── */}
                  {walletSection === 'falcon' && (
                  <div className="space-y-2">
                    {FALCON_WALLET_ASSETS.filter((asset) => {
                      // Top card is FALCON — list only bridged assets under it
                      if (asset.id === 'falcon') return false
                      if (!falconVisible[asset.id]) return false
                      const q = assetSearch.trim().toLowerCase()
                      if (q && !asset.symbol.toLowerCase().includes(q) && !asset.subtitle.toLowerCase().includes(q)) return false
                      if (hideZeroBalances) {
                        const fb = parseFalconBalances(account)
                        if (falconRowBalance(asset.id, fb) <= 0) return false
                      }
                      return true
                    }).map((asset, assetIdx) => {
                      const isLive = asset.status === 'live'
                      let balanceLabel = '—'
                      let detail: ReactNode = asset.subtitle
                      if (asset.id === 'falcon') {
                        balanceLabel = account == null
                          ? '—'
                          : account.balance.toLocaleString(undefined, { maximumFractionDigits: 6 })
                      } else if (asset.id === 'fusdc') {
                        balanceLabel = (account?.assets?.fusdc?.balance ?? 0).toLocaleString(undefined, {
                          maximumFractionDigits: 4,
                        })
                        if (account?.assets?.fusdc?.hasTrustLine === false) {
                          detail = (
                            <span>
                              Need trust line — open Bridge or{' '}
                              <Link href="/swap" className="text-brand-400">Swap</Link>
                            </span>
                          )
                        }
                      } else if (asset.id === 'feth') {
                        const fethTok = account?.assets?.tokens?.find(
                          (t) => t.currency === 'ETH' || t.symbol === 'FETH',
                        )
                        balanceLabel = (fethTok?.balance ?? 0).toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })
                        if (fethTok && !fethTok.hasTrustLine) {
                          detail = (
                            <span>
                              Need trust line — open Bridge · FETH
                            </span>
                          )
                        } else if (!fethTok) {
                          detail = asset.subtitle
                        }
                      } else if (asset.id === 'fbnb') {
                        const fbnbTok = account?.assets?.tokens?.find(
                          (t) => t.currency === 'BNB' || t.symbol === 'FBNB',
                        )
                        balanceLabel = (fbnbTok?.balance ?? 0).toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })
                        if (fbnbTok && !fbnbTok.hasTrustLine) {
                          detail = (
                            <span>
                              Need trust line — open Bridge · FBNB
                            </span>
                          )
                        } else if (!fbnbTok) {
                          detail = asset.subtitle
                        }
                      } else if (asset.id === 'fbtc') {
                        const fbtcTok = account?.assets?.tokens?.find(
                          (t) => t.currency === 'BTC' || t.symbol === 'FBTC',
                        )
                        balanceLabel = (fbtcTok?.balance ?? 0).toLocaleString(undefined, {
                          maximumFractionDigits: 8,
                        })
                        if (fbtcTok && !fbtcTok.hasTrustLine) {
                          detail = (
                            <span>
                              Need trust line — open Bridge · BTC → FBTC
                            </span>
                          )
                        } else if (!fbtcTok) {
                          detail = asset.subtitle
                        }
                      }
                      return (
                        <div
                          key={asset.id}
                          className={`wallet-asset-row wallet-row-enter ${
                            !isLive ? 'opacity-70' : ''
                          }`}
                          style={{ animationDelay: `${assetIdx * 45}ms` }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-3 min-w-0">
                              <span className={`wallet-chip ${tokenChipClass(asset.id)}`}>
                                {shortTokenLabel(asset.id)}
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold text-white">{asset.symbol}</span>
                                  {!isLive && (
                                    <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">
                                      Soon
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">{detail}</div>
                              </div>
                            </div>
                            <div className="font-mono text-base font-semibold text-slate-100 shrink-0 tabular-nums">
                              {balanceLabel}
                            </div>
                          </div>

                        </div>
                      )
                    })}
                  </div>
                  )}

                  {/* ── Native multi-chain rows (ETH / USDC / BTC / BNB) ── */}
                  {walletSection === 'multichain' && (
                  <div className="space-y-2">
                    {!hasBridgeWallet(wallet) && (
                      <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 px-3 py-2 text-xs text-amber-100/90">
                        No ETH deposit wallet yet.{' '}
                        <button
                          type="button"
                          className="text-emerald-400 underline"
                          onClick={() => setWalletSection('bridge')}
                        >
                          Open Bridge
                        </button>{' '}
                        to create one with your passkey (used for ETH, USDC, and BNB).
                      </div>
                    )}
                    {NATIVE_CHAIN_WALLETS.filter((chain) => {
                      if (!multiVisible[chain.id]) return false
                      const q = assetSearch.trim().toLowerCase()
                      if (
                        q &&
                        !chain.symbol.toLowerCase().includes(q) &&
                        !chain.chainLabel.toLowerCase().includes(q) &&
                        !chain.subtitle.toLowerCase().includes(q)
                      )
                        return false
                      if (hideZeroBalances) {
                        const bal = multiRowBalance(chain.id, {
                          eth: ethNativeBal != null ? Number(ethNativeBal) : null,
                          usdc: usdcNativeBal != null ? Number(usdcNativeBal) : null,
                          btc: btcNativeBal != null ? Number(btcNativeBal.btc) : null,
                          bnb: bnbNativeBal != null ? Number(bnbNativeBal) : null,
                        })
                        if (bal != null && bal <= 0) return false
                      }
                      return true
                    }).map((chain, assetIdx) => {
                      const isLive = chain.status === 'live'
                      const hasEvmKey = hasBridgeWallet(wallet)
                      const hasBtc = hasBtcWallet(wallet)
                      const usesEvm = chain.id === 'eth' || chain.id === 'usdc' || chain.id === 'bnb'
                      const hasKey = chain.id === 'btc' ? hasBtc : hasEvmKey
                      const shortEvm = wallet.evmAddress
                        ? `${wallet.evmAddress.slice(0, 10)}…${wallet.evmAddress.slice(-6)}`
                        : ''
                      const shortBtc = wallet.btcAddress
                        ? `${wallet.btcAddress.slice(0, 10)}…${wallet.btcAddress.slice(-6)}`
                        : ''
                      let balanceLabel = '—'
                      if (chain.id === 'eth' && hasEvmKey) {
                        balanceLabel = nativeBalLoading
                          ? '…'
                          : ethNativeBal != null
                            ? Number(ethNativeBal).toLocaleString(undefined, { maximumFractionDigits: 6 })
                            : '—'
                      } else if (chain.id === 'usdc' && hasEvmKey) {
                        balanceLabel = nativeBalLoading
                          ? '…'
                          : usdcNativeBal != null
                            ? Number(usdcNativeBal).toLocaleString(undefined, { maximumFractionDigits: 2 })
                            : '—'
                      } else if (chain.id === 'bnb' && hasEvmKey) {
                        balanceLabel = nativeBalLoading
                          ? '…'
                          : bnbNativeBal != null
                            ? Number(bnbNativeBal).toLocaleString(undefined, { maximumFractionDigits: 6 })
                            : 'unavailable'
                      } else if (chain.id === 'btc' && hasBtc) {
                        balanceLabel = nativeBalLoading
                          ? '…'
                          : btcNativeBal != null
                            ? Number(btcNativeBal.btc).toLocaleString(undefined, {
                                maximumFractionDigits: 8,
                                minimumFractionDigits: 0,
                              })
                            : 'unavailable'
                      }
                      return (
                        <div
                          key={chain.id}
                          className={`wallet-asset-row wallet-row-enter ${
                            !(isLive && hasKey) ? 'opacity-80' : ''
                          }`}
                          style={{ animationDelay: `${assetIdx * 45}ms` }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-3 min-w-0">
                              <span className={`wallet-chip ${tokenChipClass(chain.id)}`}>
                                {shortTokenLabel(chain.id)}
                              </span>
                              <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-white">{chain.symbol}</span>
                                <span className="text-[10px] text-slate-500">{chain.chainLabel}</span>
                              </div>
                              <div className="text-[10px] text-slate-500 mt-0.5 leading-snug font-mono">
                                {usesEvm && hasEvmKey && (
                                  <span className="text-slate-400">
                                    {shortEvm}{' '}
                                    <span className="font-sans text-slate-600">
                                      · {chain.id === 'bnb' ? 'BSC testnet' : chain.id === 'usdc' ? 'Sepolia USDC' : 'Sepolia'}
                                    </span>
                                  </span>
                                )}
                                {chain.id === 'btc' && hasBtc && (
                                  <span className="text-slate-400">
                                    {shortBtc} <span className="font-sans text-slate-600">· BTC testnet</span>
                                  </span>
                                )}
                                {!hasKey && <span className="font-sans">{chain.subtitle}</span>}
                              </div>
                              {chain.id === 'btc' && hasBtc && btcNativeBal && btcNativeBal.totalSats > 0 && (
                                <div className="text-[10px] text-slate-600 mt-0.5">
                                  {btcNativeBal.totalSats.toLocaleString()} sats
                                </div>
                              )}
                              {chain.id === 'bnb' && bnbNativeBal == null && !nativeBalLoading && hasEvmKey && (
                                <div className="text-[10px] text-amber-400/80 mt-0.5 font-sans">
                                  Balance unavailable
                                </div>
                              )}
                            </div>
                            </div>
                            <div className="font-mono text-base font-semibold text-slate-100 shrink-0 tabular-nums">
                              {balanceLabel}
                            </div>
                          </div>

                        </div>
                      )
                    })}
                  </div>
                  )}

                  {walletSection === 'falcon' && account?.exists && (
                    <div className="grid grid-cols-2 gap-2 text-sm pt-1">
                      <div className="bg-slate-800/40 rounded-xl px-3 py-2.5 border border-slate-800">
                        <div className="text-xs text-slate-500">LP tokens</div>
                        <div className="font-mono text-slate-100 mt-0.5">
                          {(account.assets?.lp?.balance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </div>
                        <div className="text-[10px] text-slate-600 mt-0.5">
                          {(account.assets?.lp?.balance ?? 0) > 0 ? (
                            <>
                              {(account.assets!.lp.sharePct).toFixed(2)}% of pool
                              <span className="text-slate-700 mx-1">·</span>
                              <Link href="/pool" className="text-brand-400 hover:text-brand-300">Pool →</Link>
                            </>
                          ) : (
                            <Link href="/pool" className="text-brand-400 hover:text-brand-300">Add on Pool →</Link>
                          )}
                        </div>
                      </div>
                      <div className="bg-slate-800/40 rounded-xl px-3 py-2.5 border border-slate-800">
                        <div className="text-xs text-slate-500">Lend share</div>
                        <div className="font-mono text-slate-100 mt-0.5">
                          {(lendSupply?.shares ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </div>
                        <div className="text-[10px] text-slate-600 mt-0.5">
                          {(lendSupply?.shares ?? 0) > 0 && lendSupply?.sharePct != null ? (
                            <>
                              {lendSupply.sharePct.toFixed(2)}% of vault
                              <span className="text-slate-700 mx-1">·</span>
                              <Link href="/lend" className="text-brand-400 hover:text-brand-300">Lend →</Link>
                            </>
                          ) : (
                            <Link href="/lend" className="text-brand-400 hover:text-brand-300">Supply on Lend →</Link>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Account name claim — Falcon wallet only */}
                {walletSection === 'falcon' && account?.exists && network.live && !accountName && (
                  <div className="rounded-xl border border-violet-500/25 bg-violet-950/20 p-3 space-y-2">
                    <div className="text-sm font-medium text-violet-200">Create named address</div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Claim a human name for this wallet. Locks <strong className="text-slate-400">{NAME_BOND_FALCON} FALCON</strong> until you release the name (1-epoch cooldown).
                      Settlement still uses your <span className="font-mono">r…</span> address.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={nameInput}
                        onChange={(e) => {
                          const v = e.target.value.toLowerCase()
                          setNameInput(v)
                          setNameMsg(null)
                          const n = normalizeAccountName(v)
                          if (!v.trim()) setNameAvailability('idle')
                          else if (!n) setNameAvailability('invalid')
                          else setNameAvailability('idle')
                        }}
                        onBlur={async () => {
                          const n = normalizeAccountName(nameInput)
                          if (!n) {
                            setNameAvailability(nameInput.trim() ? 'invalid' : 'idle')
                            return
                          }
                          setNameAvailability('checking')
                          try {
                            const r = await fetch(
                              withNetworkQuery(`/api/wallet/name?name=${encodeURIComponent(n)}`, networkKey),
                            )
                            const j = await r.json()
                            if (!r.ok && j.error === 'Invalid name') setNameAvailability('invalid')
                            else if (j.available) setNameAvailability('available')
                            else setNameAvailability('taken')
                          } catch {
                            setNameAvailability('idle')
                          }
                        }}
                        placeholder="alice.bob"
                        maxLength={32}
                        className="flex-1 rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-sm font-mono text-slate-100 placeholder:text-slate-600"
                        disabled={nameBusy}
                      />
                      <button
                        type="button"
                        disabled={
                          nameBusy ||
                          !normalizeAccountName(nameInput) ||
                          nameAvailability === 'taken' ||
                          nameAvailability === 'invalid' ||
                          (account?.balance ?? 0) < NAME_BOND_FALCON + 1
                        }
                        onClick={async () => {
                          const n = normalizeAccountName(nameInput)
                          if (!n || !wallet || !account) return
                          if ((account.balance ?? 0) < NAME_BOND_FALCON + 1) {
                            setNameMsg(`Need at least ${NAME_BOND_FALCON + 1} FALCON (bond + fee). Use the faucet first.`)
                            return
                          }
                          setNameBusy(true)
                          setNameMsg(null)
                          setError(null)
                          try {
                            const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
                            const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)
                            await submitWithSequenceRetry({
                              networkKey,
                              fetchSequence: async () => {
                                try {
                                  return await fetchSequenceInfo(wallet.address, networkKey)
                                } catch {
                                  return {
                                    sequence: account.sequence,
                                    currentLedger: account.currentLedger,
                                  }
                                }
                              },
                              sign: ({ sequence, lastLedgerSequence }) =>
                                signNameSet(
                                  {
                                    account: wallet.address,
                                    name: n,
                                    sequence,
                                    lastLedgerSequence,
                                    networkId: network.networkId,
                                  },
                                  falcon_secret,
                                ),
                            })
                            setNameMsg(`Claimed “${n}”. Bond of ${NAME_BOND_FALCON} FALCON locked.`)
                            setNameInput('')
                            setNameAvailability('idle')
                            setAccountName(n)
                            setAccountNameStatus('active')
                            cacheAccountName(wallet.address, n, 'active')
                            await refreshBalance(wallet.address)
                          } catch (e: unknown) {
                            const msg = e instanceof Error ? e.message : String(e)
                            setNameMsg(msg)
                            setError(msg)
                          } finally {
                            setNameBusy(false)
                          }
                        }}
                        className="px-4 py-2 rounded-lg text-sm font-semibold bg-violet-500 hover:bg-violet-400 disabled:opacity-40 text-slate-950"
                      >
                        {nameBusy ? '…' : 'Claim'}
                      </button>
                    </div>
                    <div className="text-[11px] min-h-[1rem]">
                      {nameAvailability === 'checking' && <span className="text-slate-500">Checking…</span>}
                      {nameAvailability === 'available' && <span className="text-emerald-400">Available</span>}
                      {nameAvailability === 'taken' && <span className="text-rose-400">Taken</span>}
                      {nameAvailability === 'invalid' && (
                        <span className="text-amber-400">{nameHint(nameInput) ?? 'Invalid name'}</span>
                      )}
                      {nameMsg && <span className="text-slate-300">{nameMsg}</span>}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 flex-wrap">
                  {walletSection === 'falcon' && (
                    <>
                      <Link
                        href="/vault"
                        className="flex-1 min-w-[100px] py-2.5 rounded-xl text-sm font-semibold bg-cyan-950/50 hover:bg-cyan-900/40 text-cyan-300 border border-cyan-500/25 text-center"
                        title="Air-gapped vault (cold signer)"
                      >
                        Vault
                      </Link>
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
                    </>
                  )}
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
                  key={`bridge-${bridgeInitialMode}-${bridgeInitialRoute}`}
                  wallet={wallet}
                  bridgeCfg={bridgeCfg}
                  fusdcBalance={account?.assets?.fusdc?.balance ?? null}
                  onWalletUpdate={setWallet}
                  onFalconRefresh={() => refreshBalance(wallet.address)}
                  initialMode={bridgeInitialMode}
                  initialRoute={bridgeInitialRoute}
                />
              )}

              {view === 'dashboard' && walletSection === 'bridge' && !bridgeCfg && (
                <div className="card p-4 text-sm text-slate-500">Loading bridge config…</div>
              )}

              {/* ── Receive panel ── */}
              {view === 'receive' && (() => {
                const isNativeEvm = receiveAssetId === 'eth' || receiveAssetId === 'bnb' || receiveAssetId === 'usdc'
                const isBtc = receiveAssetId === 'btc'
                const recvAddr = isNativeEvm
                  ? (wallet.evmAddress || '')
                  : isBtc
                    ? (wallet.btcAddress || '')
                    : wallet.address
                const recvSymbol = multiChainAssetById(receiveAssetId)?.symbol
                  ?? (receiveAssetId === 'eth' ? 'ETH' : receiveAssetId === 'btc' ? 'BTC' : receiveAssetId === 'bnb' ? 'BNB' : 'assets')
                return (
                <div className="card p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setView('dashboard')}
                      className="text-slate-500 hover:text-slate-300"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <h3 className="font-semibold text-white text-sm">
                      Receive {recvSymbol}
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {receiveAssetId === 'eth'
                      ? 'Native Ethereum address (Sepolia testnet). Fund ETH for gas and for bridging to FETH.'
                      : receiveAssetId === 'usdc'
                        ? 'USDC on Ethereum (Sepolia). Same 0x as ETH — send only USDC here, then Bridge → F-USDC.'
                      : receiveAssetId === 'bnb'
                        ? 'Same 0x as ETH. On BSC testnet this receives BNB. Bridge → FBNB.'
                      : receiveAssetId === 'btc'
                        ? 'Native Bitcoin testnet P2PKH address. Only send testnet BTC. Bridge → FBTC.'
                      : receiveAssetId === 'fusdc'
                        ? 'F-USDC lives on Falcon. Share your r… address, or Bridge In from Multi-chain USDC.'
                        : receiveAssetId === 'falcon'
                          ? 'Only send FALCON / Falcon-network assets to this r… address.'
                            : 'Falcon-wrapped asset — use Falcon r… after minting via Bridge.'}
                  </p>
                  {recvAddr ? (
                    <>
                      <div className="bg-white rounded-xl p-3 mx-auto w-fit">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(recvAddr)}&size=180x180&margin=0`}
                          alt="Address QR code"
                          width={180}
                          height={180}
                          className="rounded"
                        />
                      </div>
                      <div className="bg-slate-800 rounded-xl px-3 py-2.5 font-mono text-xs text-slate-300 break-all text-center leading-relaxed">
                        {recvAddr}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-amber-300">No deposit address yet — open Bridge to create the ETH wallet.</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        if (!recvAddr) return
                        await navigator.clipboard.writeText(recvAddr)
                        setCopied(true)
                        setTimeout(() => setCopied(false), 2000)
                      }}
                      disabled={!recvAddr}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors disabled:opacity-40"
                    >
                      {copied ? '✓ Copied!' : 'Copy Address'}
                    </button>
                    {receiveAssetId === 'falcon' && (
                      <Link
                        href={`/?address=${encodeURIComponent(wallet.address)}`}
                        className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors text-center"
                      >
                        Get from Faucet →
                      </Link>
                    )}
                    {(receiveAssetId === 'fusdc' || receiveAssetId === 'eth') && (
                      <button
                        type="button"
                        onClick={() => {
                          setBridgeInitialMode('deposit')
                          setWalletSection('bridge')
                          setView('dashboard')
                        }}
                        className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-emerald-950/50 text-emerald-300 border border-emerald-500/25"
                      >
                        Bridge →
                      </button>
                    )}
                  </div>
                </div>
                )
              })()}

              {showSendScanner && (
                <AddressQrScanner
                  onScan={(raw) => {
                    setShowSendScanner(false)
                    if (sendAsset === 'btc') {
                      const t = raw.trim()
                      if (!isValidBtcP2pkh(t, 'testnet')) {
                        setError('QR does not contain a valid Bitcoin testnet address (m…/n…)')
                        return
                      }
                      setSendTo(t)
                      setError(null)
                      return
                    }
                    if (sendAsset === 'eth' || sendAsset === 'bnb') {
                      const addr = parseEvmAddressFromScan(raw)
                      if (!addr) {
                        setError('QR does not contain a valid 0x address')
                        return
                      }
                      setSendTo(addr)
                      setError(null)
                      return
                    }
                    const addr = parseFalconAddressFromScan(raw)
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
                      onClick={() => {
                        setView('dashboard')
                        setError(null)
                        setSendResult(null)
                        if (sendAsset === 'btc' || sendAsset === 'bnb' || sendAsset === 'eth') {
                          setWalletSection('multichain')
                        }
                      }}
                      className="text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <h3 className="font-semibold text-white text-sm">
                      {sendAsset === 'btc'
                        ? 'Send Bitcoin (testnet)'
                        : sendAsset === 'bnb'
                          ? 'Send BNB (BSC testnet)'
                          : sendAsset === 'eth'
                            ? 'Send ETH (Sepolia)'
                            : 'Send on Falcon'}
                    </h3>
                  </div>

                  {(sendAsset === 'falcon' || sendAsset === 'fusdc' || sendAsset === 'feth' || sendAsset === 'fbnb') && (
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
                    <button
                      type="button"
                      onClick={() => { setSendAsset('feth'); setSendAmount(''); setError(null) }}
                      className={`flex-1 py-2 ${sendAsset === 'feth' ? 'bg-sky-500/10 text-sky-400' : 'text-slate-500'}`}
                    >
                      FETH
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSendAsset('fbnb'); setSendAmount(''); setError(null) }}
                      className={`flex-1 py-2 ${sendAsset === 'fbnb' ? 'bg-yellow-500/10 text-yellow-400' : 'text-slate-500'}`}
                    >
                      FBNB
                    </button>
                  </div>
                  )}

                  {(sendAsset === 'btc' || sendAsset === 'bnb' || sendAsset === 'eth') && (
                    <p className="text-[11px] text-slate-500 leading-snug">
                      {sendAsset === 'btc'
                        ? 'Signed in-browser · broadcast via Blockstream/Mempool testnet API. Keys never leave this device.'
                        : sendAsset === 'bnb'
                          ? 'Same 0x key as ETH · BSC testnet. Keys stay encrypted under your passkey.'
                          : 'Sepolia ETH · same deposit wallet used for Bridge In.'}
                    </p>
                  )}

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
                      {sendResult.explorerUrl && sendResult.success && (
                        <a
                          href={sendResult.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-brand-400 hover:text-brand-300"
                        >
                          View on explorer →
                        </a>
                      )}
                      <div className="text-xs text-slate-500">{sendResult.message}</div>
                      <button
                        onClick={() => {
                          setSendResult(null)
                          setView('dashboard')
                          if (sendAsset === 'btc' || sendAsset === 'bnb' || sendAsset === 'eth') {
                            setWalletSection('multichain')
                          }
                        }}
                        className="text-sm text-brand-400 hover:text-brand-300 transition-colors"
                      >
                        ← Back to wallet
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleSend} className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-xs text-slate-400">
                          {sendAsset === 'btc'
                            ? 'Destination (testnet m… / n…)'
                            : sendAsset === 'eth' || sendAsset === 'bnb'
                              ? 'Destination (0x…)'
                              : 'Destination (r… or name)'}
                        </label>
                        <div className="flex items-stretch gap-2">
                          <input
                            type="text"
                            value={sendTo}
                            onChange={e => { setSendTo(e.target.value); setError(null) }}
                            placeholder={
                              sendAsset === 'btc'
                                ? 'm… or n…'
                                : sendAsset === 'eth' || sendAsset === 'bnb'
                                  ? '0x…'
                                  : 'rXXX… or alice.bob'
                            }
                            className="input-field flex-1 min-w-0 w-0"
                            disabled={busy}
                            autoComplete="off"
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
                        <label className="text-xs text-slate-400">
                          Amount (
                          {sendAsset === 'falcon'
                            ? 'FALCON'
                            : sendAsset === 'fusdc'
                              ? 'F-USDC'
                              : sendAsset === 'feth'
                                ? 'FETH'
                                : sendAsset === 'fbnb'
                                  ? 'FBNB'
                                  : sendAsset === 'btc'
                                    ? 'BTC'
                                    : sendAsset === 'bnb'
                                      ? 'BNB'
                                      : 'ETH'}
                          )
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
                        {account?.exists && sendAsset === 'feth' && (
                          <div className="flex justify-between text-xs text-slate-600">
                            <span>
                              Available:{' '}
                              {(
                                account.assets?.tokens?.find(
                                  (t) => t.currency === 'ETH' || t.symbol === 'FETH',
                                )?.balance ?? 0
                              ).toLocaleString(undefined, { maximumFractionDigits: 6 })}{' '}
                              FETH
                            </span>
                            {(
                              account.assets?.tokens?.find(
                                (t) => t.currency === 'ETH' || t.symbol === 'FETH',
                              )?.balance ?? 0
                            ) > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSendAmount(
                                    String(
                                      account.assets!.tokens!.find(
                                        (t) => t.currency === 'ETH' || t.symbol === 'FETH',
                                      )!.balance,
                                    ),
                                  )
                                }
                                className="text-brand-500 hover:text-brand-400 transition-colors"
                              >
                                Max
                              </button>
                            )}
                          </div>
                        )}
                        {account?.exists && sendAsset === 'fbnb' && (
                          <div className="flex justify-between text-xs text-slate-600">
                            <span>
                              Available:{' '}
                              {(
                                account.assets?.tokens?.find(
                                  (t) => t.currency === 'BNB' || t.symbol === 'FBNB',
                                )?.balance ?? 0
                              ).toLocaleString(undefined, { maximumFractionDigits: 6 })}{' '}
                              FBNB
                            </span>
                            {(
                              account.assets?.tokens?.find(
                                (t) => t.currency === 'BNB' || t.symbol === 'FBNB',
                              )?.balance ?? 0
                            ) > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSendAmount(
                                    String(
                                      account.assets!.tokens!.find(
                                        (t) => t.currency === 'BNB' || t.symbol === 'FBNB',
                                      )!.balance,
                                    ),
                                  )
                                }
                                className="text-brand-500 hover:text-brand-400 transition-colors"
                              >
                                Max
                              </button>
                            )}
                          </div>
                        )}
                        {sendAsset === 'btc' && (
                          <div className="flex justify-between text-xs text-slate-600">
                            <span>
                              Available:{' '}
                              {btcNativeBal
                                ? Number(btcNativeBal.btc).toLocaleString(undefined, { maximumFractionDigits: 8 })
                                : '—'}{' '}
                              BTC
                            </span>
                            {btcNativeBal && btcNativeBal.totalSats > 1000 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSendAmount(
                                    // leave room for ~2 sat/vB fee on 1-in/1-out
                                    ((btcNativeBal.totalSats - 400) / 1e8).toFixed(8),
                                  )
                                }
                                className="text-brand-500 hover:text-brand-400 transition-colors"
                              >
                                Max
                              </button>
                            )}
                          </div>
                        )}
                        {sendAsset === 'bnb' && (
                          <div className="flex justify-between text-xs text-slate-600">
                            <span>
                              Available:{' '}
                              {bnbNativeBal != null
                                ? Number(bnbNativeBal).toLocaleString(undefined, { maximumFractionDigits: 6 })
                                : '—'}{' '}
                              BNB
                            </span>
                            {bnbNativeBal != null && parseFloat(bnbNativeBal) > 0.001 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSendAmount(String(Math.max(0, parseFloat(bnbNativeBal) - 0.0005)))
                                }
                                className="text-brand-500 hover:text-brand-400 transition-colors"
                              >
                                Max
                              </button>
                            )}
                          </div>
                        )}
                        {sendAsset === 'eth' && (
                          <div className="flex justify-between text-xs text-slate-600">
                            <span>
                              Available:{' '}
                              {ethNativeBal != null
                                ? Number(ethNativeBal).toLocaleString(undefined, { maximumFractionDigits: 6 })
                                : '—'}{' '}
                              ETH
                            </span>
                            {ethNativeBal != null && parseFloat(ethNativeBal) > 0.002 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSendAmount(String(Math.max(0, parseFloat(ethNativeBal) - 0.001)))
                                }
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
                            <Link href="/wallet?bridge=1" className="text-brand-400 underline">Bridge</Link>
                            {' or '}
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
                            {savedNode.nodeName} ·{' '}
                            <span className="font-mono text-slate-400">
                              {savedNode.host}:{savedNode.port ?? 8080}
                            </span>
                          </p>
                        </div>
                        <div className="flex gap-1.5 flex-shrink-0">
                          <button
                            onClick={() =>
                              savedNode &&
                              refreshNodeStats(savedNode.host, savedNode.port, savedNode.nodeName)
                            }
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
                        href={dashboardUrl(savedNode.host, savedNode.port)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-center py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold transition break-all px-2"
                      >
                        Open full dashboard → {dashboardUrl(savedNode.host, savedNode.port)}
                      </a>

                      {nodeStatsError && (
                        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                          {nodeStatsError}
                          <p className="text-[10px] text-red-400/80 mt-1">
                            Ensure the dashboard container is up and TCP {savedNode.port ?? 8080} is open
                            (or reverse-proxy TLS on 443). Private/LAN IPs are blocked by the portal.
                          </p>
                        </div>
                      )}

                      {/* Network (full) still shows if personal node fetch fails */}
                      {!nodeStats?.node && networkStats && (
                        <div className="space-y-2 rounded-xl border border-slate-700/60 p-3">
                          <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">Network activity</div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <MetricTile label="Network ledger" value={`#${fmtStat(networkStats.ledger_seq)}`} tone="good" sub={networkStats.complete_ledgers} />
                            <MetricTile label="Network state" value={networkStats.server_state || '—'} />
                            <MetricTile label="Bonded validators" value={fmtStat(networkStats.bonded_validator_count)} tone="good" />
                            <MetricTile
                              label="Epoch"
                              value={networkStats.epoch?.epoch_number != null ? String(networkStats.epoch.epoch_number) : '—'}
                            />
                            <MetricTile
                              label="Tx rate"
                              value={fmtTxPerSec(networkStats.tx_per_sec)}
                              tone={(networkStats.tx_per_sec ?? 0) > 0 ? 'good' : ''}
                              sub="network-wide closes"
                            />
                            <MetricTile
                              label="Total txs"
                              value={fmtStat(networkStats.total_txs)}
                              tone={networkStats.tx_index_complete ? 'good' : 'warn'}
                              sub={networkStats.tx_index_complete
                                ? 'all closed ledgers'
                                : `indexing… ${networkStats.tx_index_progress_pct != null ? `${Number(networkStats.tx_index_progress_pct).toFixed(1)}%` : ''}`}
                            />
                          </div>
                          {nodeStatsError && (
                            <p className="text-[11px] text-amber-300/90">
                              Personal node metrics failed ({nodeStatsError}). Network view above still works. Try re-link with <span className="font-mono">IP:8080</span> or <span className="font-mono">IP:8081</span>.
                            </p>
                          )}
                        </div>
                      )}

                      {nodeStats?.node && (() => {
                        const isValidatorNode = !!nodeStats.node.validator_account
                        const bond = nodeStats.node.bond
                        const bondOk = bond?.status === 'bonded'
                        return (
                        <>
                          <div className="space-y-2">
                            <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">
                              {isValidatorNode ? 'Your node (personal)' : 'Your node (full-history)'}
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              <MetricTile
                                label="Server state"
                                value={nodeStats.node.server_state || '—'}
                                tone={nodeStats.node.server_state === 'proposing' ? 'good' : (nodeStats.node.server_state === 'full' ? '' : 'warn')}
                                sub={isValidatorNode
                                  ? ((nodeStats.node.validation_pubkey || '').slice(0, 20) + (nodeStats.node.validation_pubkey ? '…' : ''))
                                  : 'full-history node'}
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
                                label="Bond status"
                                value={isValidatorNode ? (bond?.status || 'unknown') : 'n/a'}
                                tone={bondOk ? 'good' : (isValidatorNode ? 'warn' : '')}
                                sub={isValidatorNode
                                  ? `${fmtStat(bond?.bonded_amount_qxrp, 2)} FALCON locked`
                                  : 'full-history node · not a validator'}
                              />
                              <MetricTile
                                label="Composite score"
                                value={isValidatorNode ? fmtStat(bond?.composite_score) : 'n/a'}
                                tone={isValidatorNode
                                  ? ((bond?.composite_score ?? 0) >= 5000 ? 'good' : 'warn')
                                  : ''}
                                sub={isValidatorNode ? 'basis points / 10000' : 'see bonded table'}
                              />
                              <MetricTile
                                label="Rewards pending"
                                value={isValidatorNode ? `${fmtStat(bond?.reward_accum_qxrp, 4)}` : 'n/a'}
                                sub={isValidatorNode ? 'FALCON accumulator' : 'not a validator'}
                              />
                              <MetricTile
                                label={isValidatorNode ? 'Validator balance' : 'Balance'}
                                value={isValidatorNode ? `${fmtStat(nodeStats.node.balance_qxrp, 2)}` : 'n/a'}
                                sub={isValidatorNode ? 'FALCON on-chain' : 'see bonded table'}
                              />
                              <MetricTile
                                label="Uptime"
                                value={fmtUptimeSeconds(nodeStats.node.uptime_seconds)}
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

                          {(() => {
                            const net = nodeStats.network || networkStats
                            if (!net) return null
                            return (
                            <div className="space-y-2 pt-1 border-t border-slate-800">
                              <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">Network activity</div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                <MetricTile label="Network ledger" value={`#${fmtStat(net.ledger_seq)}`} tone="good" sub={net.complete_ledgers} />
                                <MetricTile label="Network state" value={net.server_state || '—'} />
                                <MetricTile label="Bonded validators" value={fmtStat(net.bonded_validator_count)} tone="good" sub={`${fmtStat(net.total_validator_entries)} on ledger`} />
                                <MetricTile
                                  label="Epoch"
                                  value={net.epoch?.epoch_number != null ? String(net.epoch.epoch_number) : '—'}
                                  sub={net.epoch?.epoch_pool_balance_qxrp != null
                                   ? `pool ${fmtStat(net.epoch.epoch_pool_balance_qxrp, 2)} FALCON`
                                    : undefined}
                                />
                                <MetricTile
                                  label="Tx rate"
                                  value={fmtTxPerSec(net.tx_per_sec)}
                                  tone={(net.tx_per_sec ?? 0) > 0 ? 'good' : ''}
                                  sub={net.last_ledger_txs != null
                                    ? `network-wide · last ledger ${net.last_ledger_txs}`
                                    : 'network-wide closes'}
                                />
                                <MetricTile
                                  label="Total txs"
                                  value={fmtStat(net.total_txs)}
                                  tone={net.tx_index_complete ? 'good' : 'warn'}
                                  sub={net.tx_index_complete
                                    ? `all closed ledgers · tip #${fmtStat(net.tx_index_tip ?? net.ledger_seq)}`
                                    : `indexing on-ledger… ${net.tx_index_progress_pct != null ? `${Number(net.tx_index_progress_pct).toFixed(1)}%` : ''}${net.tx_index_scanned_through != null ? ` · through #${fmtStat(net.tx_index_scanned_through)}` : ''}`}
                                />
                              </div>
                            </div>
                            )
                          })()}

                          {(() => {
                            const vals = (nodeStats.network || networkStats)?.validators
                            if (!vals?.length) return null
                            return (
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
                                    {vals.map((v) => {
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
                            )
                          })()}

                          {nodeStats.updated_at && (
                            <p className="text-[10px] text-slate-600 text-center">Auto-refreshes every 15s · Last update {nodeStats.updated_at}</p>
                          )}
                        </>
                        )
                      })()}

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
                      Paste your server&apos;s <strong className="text-cyan-100">public IP</strong>,{' '}
                      <strong className="text-cyan-100">domain</strong>, or <strong className="text-cyan-100">host:port</strong>.
                      Examples: <span className="font-mono text-[11px]">203.0.113.10</span>,{' '}
                      <span className="font-mono text-[11px]">node.example.com</span>,{' '}
                      <span className="font-mono text-[11px]">node.example.com:6080</span>.
                    </p>
                    <div>
                      <label className="block text-[10px] text-cyan-200/70 mb-1">
                        Dashboard host (not RPC :6005)
                      </label>
                      <input
                        value={nodeHostInput}
                        onChange={(e) => setNodeHostInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleLinkValidatorNode()}
                        className="w-full bg-slate-900 border border-cyan-500/30 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-cyan-400"
                        placeholder="46.224.0.140   or   46.224.0.140:8080"
                      />
                      <p className="text-[10px] text-cyan-100/60 mt-1">
                        Full-history dashboard: <span className="font-mono">46.224.0.140</span> (port 8080).
                        RPC is <span className="font-mono">:6005</span> — do not use that for the dashboard link.
                      </p>
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
                      <span className="font-semibold">Port 51235 (TCP)</span> must be public for peering.{' '}
                      Dashboard defaults to <span className="font-semibold">8080</span> but you may publish{' '}
                      <span className="font-semibold">6080</span> (or any port) and enter <span className="font-mono">host:6080</span> here.
                      Domain + reverse proxy (HTTPS :443) is fine too — enter the domain and map to the dashboard container.
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


              {/* Asset picker for Send / Receive */}
              {transferPicker && wallet && (() => {
                const fb = parseFalconBalances(account)
                const falconOpts = FALCON_WALLET_ASSETS.map((a) => {
                  const bal = falconRowBalance(a.id, fb)
                  return {
                    id: a.id,
                    symbol: a.symbol,
                    subtitle: a.subtitle,
                    balance: bal,
                    canSend: a.canSend && a.status === 'live',
                    balanceLabel: bal.toLocaleString(undefined, { maximumFractionDigits: 6 }),
                  }
                })
                const multiOpts = NATIVE_CHAIN_WALLETS.map((c) => {
                  const bal =
                    multiRowBalance(c.id, {
                      eth: ethNativeBal != null ? Number(ethNativeBal) : null,
                      usdc: usdcNativeBal != null ? Number(usdcNativeBal) : null,
                      btc: btcNativeBal != null ? Number(btcNativeBal.btc) : null,
                      bnb: bnbNativeBal != null ? Number(bnbNativeBal) : null,
                    }) ?? 0
                  return {
                    id: c.id,
                    symbol: c.symbol,
                    subtitle: c.chainLabel,
                    balance: bal,
                    canSend: c.canSend && c.status === 'live',
                    balanceLabel:
                      bal > 0
                        ? bal.toLocaleString(undefined, { maximumFractionDigits: 6 })
                        : '0',
                  }
                })
                // Send: falcon tab → falcon assets with balance; multi → multi with balance
                // Receive: show all rows for current tab (including zero)
                const options =
                  walletSection === 'multichain' || walletSection === 'bridge'
                    ? multiOpts
                    : falconOpts
                return (
                  <WalletAssetPicker
                    mode={transferPicker}
                    title={transferPicker === 'send' ? 'Send' : 'Receive'}
                    options={options}
                    onClose={() => setTransferPicker(null)}
                    onPick={(id) => {
                      if (transferPicker === 'send') {
                        if (id === 'fusdc' || id === 'feth' || id === 'fbnb' || id === 'fbtc' || id === 'falcon') {
                          setSendAsset(id)
                        } else if (id === 'btc' || id === 'bnb' || id === 'eth') {
                          setSendAsset(id)
                        } else {
                          setTransferPicker(null)
                          return
                        }
                        setSendTo('')
                        setSendAmount('')
                        setSendResult(null)
                        setError(null)
                        setTransferPicker(null)
                        setView('send')
                      } else {
                        setReceiveAssetId(id as MultiChainAssetId)
                        setTransferPicker(null)
                        setView('receive')
                      }
                    }}
                  />
                )
              })()}

              {/* ── Transaction history ── */}
              {view === 'dashboard' && account && account.transactions.length > 0 && (
                <div className="wallet-glass divide-y divide-slate-800/60 wallet-panel-enter">
                  <div className="px-4 py-3 flex items-center justify-between">
                    <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                      Activity
                    </div>
                    <span className="text-[10px] text-slate-600">Latest {Math.min(5, account.transactions.length)}</span>
                  </div>
                  {account.transactions.slice(0, 5).map((tx, i) => {
                    const incoming = tx.destination === wallet.address
                    const ok  = tx.result === 'tesSUCCESS'
                    const asset = tx.amountAsset ?? 'FALCON'
                    const amt = tx.amount ?? '—'
                    const amountLabel = tx.type === 'Payment' && tx.amount
                      ? `${incoming ? '+' : '-'}${amt} ${asset}`
                      : tx.type

                    // Name always takes precedence over r-address for counterparty
                    const fromName = tx.accountName?.trim() || null
                    const toName = tx.destinationName?.trim() || null
                    const fromLabel = fromName || (tx.account ? shortAddr(tx.account) : 'unknown')
                    const toLabel = toName || (tx.destination ? shortAddr(tx.destination) : 'unknown')

                    let action = tx.type
                    let party: string | null = null
                    let partyIsName = false
                    if (tx.type === 'Payment') {
                      if (incoming) {
                        action = 'Received from'
                        party = fromLabel
                        partyIsName = !!fromName
                      } else {
                        action = 'Sent to'
                        party = toLabel
                        partyIsName = !!toName
                      }
                    } else if (tx.type === 'NameSet') {
                      action = 'Claimed name'
                      party = accountName || null
                      partyIsName = !!accountName
                    } else if (tx.type === 'NameUnbond') {
                      action = 'Unbonded name'
                      party = accountName || null
                      partyIsName = !!accountName
                    }

                    return (
                      <div
                        key={tx.hash ?? i}
                        className="px-4 py-3 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between wallet-row-enter"
                        style={{ animationDelay: `${i * 40}ms` }}
                      >
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className={`w-7 h-7 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
                            incoming ? 'bg-emerald-500/15 text-emerald-400' : 'bg-brand-500/15 text-brand-400'
                          }`}>
                            {incoming ? '↓' : '↑'}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs text-slate-500">{action}</div>
                            {party && (
                              <div
                                className={`text-sm font-medium break-all ${
                                  partyIsName ? 'text-emerald-300' : 'text-slate-200 font-mono'
                                }`}
                              >
                                {party}
                              </div>
                            )}
                            {!party && (
                              <div className="text-sm text-slate-300">{tx.type}</div>
                            )}
                            <div className="text-[10px] text-slate-600 font-mono truncate mt-0.5">
                              {tx.hash ? `${tx.hash.slice(0, 14)}…` : ''}
                            </div>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 pl-10 sm:pl-3">
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
                  type="button"
                  onClick={handleRemoveWallet}
                  disabled={busy}
                  className="text-xs text-slate-700 hover:text-red-500 transition-colors w-full text-center py-2 disabled:opacity-50"
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
    </ProductShell>
  )
}
