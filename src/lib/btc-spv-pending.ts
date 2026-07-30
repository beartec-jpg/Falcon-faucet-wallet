/**
 * Persist open SPV peg-in jobs so confirmations survive page refresh.
 * One open job per Falcon account (blocks overlapping bridges).
 *
 * Storage is multi-layered so the deposit txid never "goes missing":
 *  1. Account map  falcon-spv-pending-v2
 *  2. Last-open backup falcon-spv-last-open-v1 (full job JSON)
 *  3. sessionStorage mirror of last-open
 */

export type SpvPendingStatus =
  | 'broadcast'
  | 'waiting_confs'
  | 'ready_to_claim'
  | 'claiming'
  | 'claimed'
  | 'failed'

export interface SpvPendingDeposit {
  v: 1
  falconAccount: string
  txid: string
  watchVout: number
  watchAddress: string
  amountSats: number
  minConfirmations: number
  btcNetwork: 'testnet' | 'mainnet'
  explorerUrl: string
  status: SpvPendingStatus
  confirmations: number
  claimHash?: string
  lastError?: string
  createdAt: number
  updatedAt: number
}

const KEY = 'falcon-spv-pending-v2'
const LAST_OPEN_KEY = 'falcon-spv-last-open-v1'
/** Legacy key — drop on read so refunded jobs cannot block Bridge forever. */
const LEGACY_KEYS = ['falcon-spv-pending-v1'] as const

/** BTC deposits that must never be claim-tracked (refunded / abandoned). */
const DEAD_SPV_TXIDS = new Set([
  'c04373f599000e888720d074e9e6ec04ec817dd2e052b1ccce762c8469a81524',
])

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

function writeAll(map: Record<string, SpvPendingDeposit>) {
  if (!isBrowser()) return
  localStorage.setItem(KEY, JSON.stringify(map))
}

function writeLastOpen(p: SpvPendingDeposit | null) {
  if (!isBrowser()) return
  try {
    if (!p || p.status === 'claimed' || DEAD_SPV_TXIDS.has(p.txid.toLowerCase())) {
      localStorage.removeItem(LAST_OPEN_KEY)
      sessionStorage.removeItem(LAST_OPEN_KEY)
      return
    }
    const json = JSON.stringify(p)
    localStorage.setItem(LAST_OPEN_KEY, json)
    sessionStorage.setItem(LAST_OPEN_KEY, json)
  } catch {
    /* quota / private mode */
  }
}

function readLastOpen(): SpvPendingDeposit | null {
  if (!isBrowser()) return null
  try {
    for (const store of [localStorage, sessionStorage]) {
      const raw = store.getItem(LAST_OPEN_KEY)
      if (!raw) continue
      const p = JSON.parse(raw) as SpvPendingDeposit
      if (p?.v === 1 && p.txid && p.falconAccount && !DEAD_SPV_TXIDS.has(p.txid.toLowerCase())) {
        if (p.status === 'claimed') continue
        return p
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

function readAll(): Record<string, SpvPendingDeposit> {
  if (!isBrowser()) return {}
  try {
    for (const k of LEGACY_KEYS) {
      try {
        if (localStorage.getItem(k)) localStorage.removeItem(k)
      } catch {
        /* ignore */
      }
    }
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const j = JSON.parse(raw) as Record<string, SpvPendingDeposit>
    if (!j || typeof j !== 'object') return {}
    let dirty = false
    for (const [acct, p] of Object.entries(j)) {
      if (p?.txid && DEAD_SPV_TXIDS.has(p.txid.toLowerCase())) {
        delete j[acct]
        dirty = true
      }
    }
    if (dirty) writeAll(j)
    return j
  } catch {
    return {}
  }
}

function explorerUrlFor(txid: string, btcNetwork: 'testnet' | 'mainnet'): string {
  return btcNetwork === 'testnet'
    ? `https://mempool.space/testnet/tx/${txid}`
    : `https://mempool.space/tx/${txid}`
}

export function getSpvPending(falconAccount: string): SpvPendingDeposit | null {
  const map = readAll()
  let p = map[falconAccount]
  // Restore from last-open backup if map entry missing (refresh / partial wipe)
  if (!p || p.v !== 1) {
    const last = readLastOpen()
    if (last && last.falconAccount === falconAccount && last.status !== 'claimed') {
      saveSpvPending(last)
      p = last
    } else {
      return null
    }
  }
  if (DEAD_SPV_TXIDS.has(p.txid.toLowerCase())) {
    clearSpvPending(falconAccount)
    return null
  }
  if (p.status === 'claimed' && Date.now() - p.updatedAt > 24 * 3600_000) {
    clearSpvPending(falconAccount)
    return null
  }
  // Keep backup warm
  if (p.status !== 'claimed') writeLastOpen(p)
  return p
}

/** True if this account has an unfinished peg-in (blocks new bridge-in). */
export function hasOpenSpvBridge(falconAccount: string): boolean {
  const p = getSpvPending(falconAccount)
  if (!p) return false
  return p.status !== 'claimed'
}

export function saveSpvPending(p: SpvPendingDeposit): void {
  if (DEAD_SPV_TXIDS.has(p.txid.toLowerCase())) return
  const map = readAll()
  map[p.falconAccount] = { ...p, updatedAt: Date.now() }
  writeAll(map)
  writeLastOpen(map[p.falconAccount])
}

export function updateSpvPending(
  falconAccount: string,
  patch: Partial<SpvPendingDeposit>,
): SpvPendingDeposit | null {
  const cur = getSpvPending(falconAccount)
  if (!cur) return null
  const next = { ...cur, ...patch, updatedAt: Date.now() }
  saveSpvPending(next)
  return next
}

export function clearSpvPending(falconAccount: string): void {
  const map = readAll()
  delete map[falconAccount]
  writeAll(map)
  const last = readLastOpen()
  if (!last || last.falconAccount === falconAccount) {
    writeLastOpen(null)
  }
}

/**
 * Create / overwrite open job. Call as soon as BTC is broadcast (before claim).
 * Always dual-writes so the txid survives refresh without paste.
 */
export function createSpvPending(input: {
  falconAccount: string
  txid: string
  watchVout?: number
  watchAddress: string
  amountSats: number
  minConfirmations: number
  btcNetwork?: 'testnet' | 'mainnet'
  status?: SpvPendingStatus
  confirmations?: number
}): SpvPendingDeposit {
  const btcNetwork = input.btcNetwork ?? 'testnet'
  const txid = input.txid.toLowerCase().replace(/^0x/, '')
  if (DEAD_SPV_TXIDS.has(txid)) {
    throw new Error('This deposit was refunded and cannot be claimed')
  }
  const now = Date.now()
  const p: SpvPendingDeposit = {
    v: 1,
    falconAccount: input.falconAccount,
    txid,
    watchVout: input.watchVout ?? 0,
    watchAddress: input.watchAddress,
    amountSats: input.amountSats,
    minConfirmations: input.minConfirmations,
    btcNetwork,
    explorerUrl: explorerUrlFor(txid, btcNetwork),
    status: input.status ?? 'waiting_confs',
    confirmations: input.confirmations ?? 0,
    createdAt: now,
    updatedAt: now,
  }
  saveSpvPending(p)
  return p
}

/**
 * If this device has no open job, but last-open backup exists for another reason,
 * or caller provides defaults — rehydrate.
 */
export function ensureSpvPendingTracked(
  falconAccount: string,
  defaults?: {
    watchAddress?: string
    minConfirmations?: number
    btcNetwork?: 'testnet' | 'mainnet'
  },
): SpvPendingDeposit | null {
  const existing = getSpvPending(falconAccount)
  if (existing && existing.status !== 'claimed') return existing
  const last = readLastOpen()
  if (last && last.falconAccount === falconAccount && last.status !== 'claimed') {
    saveSpvPending(last)
    return last
  }
  void defaults
  return null
}

/**
 * Explorer / network messages that mean "keep waiting", not "tx failed".
 */
export function isSpvWaitMessage(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    /failed to fetch|networkerror|load failed|fetch failed|econnreset|etimedout|aborterror|timeout/i.test(
      m,
    ) ||
    /tx not found|not found yet|not confirmed yet|wait for|mempool|indexer|unavailable|raw tx not found|merkle proof unavailable|status \d+|502|503|504|404|409/i.test(
      m,
    )
  )
}

/** Human copy for wait states (never looks like a failed payment). */
export function spvWaitUserMessage(msg?: string): string {
  if (!msg) return 'Waiting for Bitcoin explorers to index your deposit…'
  const m = msg.toLowerCase()
  if (/not confirmed|wait for a block|need \d+ confirmation/i.test(m)) {
    return 'BTC is in the mempool or a recent block — waiting for more confirmations…'
  }
  if (/tx not found|not found yet|raw tx not found/i.test(m)) {
    return 'Deposit broadcast — explorers still catching up (this can take a few minutes)…'
  }
  if (/failed to fetch|network|timeout|unavailable|502|503|504/i.test(m)) {
    return 'Temporary network blip while checking status — deposit is not cancelled. Retrying…'
  }
  return `Still waiting: ${msg}`
}

/** Poll confirmations (same-origin API). Soft-fails as 0 confs while explorers lag. */
export async function pollSpvConfirmations(
  txid: string,
  network: 'testnet' | 'mainnet' = 'testnet',
): Promise<{ confirmed: boolean; confirmations: number; blockHeight?: number; waiting?: string }> {
  try {
    const r = await fetch('/api/bridge/btc-spv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status', btc_txid: txid, network }),
      cache: 'no-store',
    })
    const j = (await r.json().catch(() => ({}))) as {
      confirmed?: boolean
      confirmations?: number
      blockHeight?: number
      error?: string
    }
    if (r.status === 404 || r.status === 409) {
      return {
        confirmed: false,
        confirmations: typeof j.confirmations === 'number' ? j.confirmations : 0,
        waiting: spvWaitUserMessage(j.error || 'Tx not found yet'),
      }
    }
    if (!r.ok) {
      if (isSpvWaitMessage(j.error || String(r.status))) {
        return {
          confirmed: false,
          confirmations: 0,
          waiting: spvWaitUserMessage(j.error || `Status ${r.status}`),
        }
      }
      throw new Error(j.error || `Status ${r.status}`)
    }
    return {
      confirmed: !!j.confirmed,
      confirmations: typeof j.confirmations === 'number' ? j.confirmations : 0,
      blockHeight: j.blockHeight,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isSpvWaitMessage(msg)) {
      return { confirmed: false, confirmations: 0, waiting: spvWaitUserMessage(msg) }
    }
    throw e
  }
}
