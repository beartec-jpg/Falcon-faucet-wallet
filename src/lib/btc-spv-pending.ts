/**
 * Persist open SPV peg-in jobs so confirmations survive page refresh.
 *
 * Layers (newest wins on read):
 *  1. Per-account key  falcon-spv-job-v3:<account>
 *  2. Account map      falcon-spv-pending-v2
 *  3. Last-open backup falcon-spv-last-open-v1 (+ sessionStorage)
 *  4. Deposit history   falcon-spv-history-v1:<account> (txid list, never blocks)
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

const MAP_KEY = 'falcon-spv-pending-v2'
const LAST_OPEN_KEY = 'falcon-spv-last-open-v1'
const JOB_PREFIX = 'falcon-spv-job-v3:'
const HISTORY_PREFIX = 'falcon-spv-history-v1:'
/** Successful claims — never re-open Claim UI for these txids */
const CLAIMED_PREFIX = 'falcon-spv-claimed-v1:'
const LEGACY_KEYS = ['falcon-spv-pending-v1'] as const

const DEAD_SPV_TXIDS = new Set([
  'c04373f599000e888720d074e9e6ec04ec817dd2e052b1ccce762c8469a81524',
  '0ac5c315c05858ca284c9587b62acba144a540e97a8f6d2e4f3ddd7aebd3fb2d',
  '9d02624da5e96706d22c0dcd067454f916841212c0c1dd9486e5680cfe8e246c',
])

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

function jobKey(account: string): string {
  return `${JOB_PREFIX}${account}`
}

function historyKey(account: string): string {
  return `${HISTORY_PREFIX}${account}`
}

function explorerUrlFor(txid: string, btcNetwork: 'testnet' | 'mainnet'): string {
  return btcNetwork === 'testnet'
    ? `https://mempool.space/testnet/tx/${txid}`
    : `https://mempool.space/tx/${txid}`
}

function safeSet(store: Storage, key: string, value: string) {
  try {
    store.setItem(key, value)
  } catch {
    /* private mode / quota */
  }
}

function safeGet(store: Storage, key: string): string | null {
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}

function safeRemove(store: Storage, key: string) {
  try {
    store.removeItem(key)
  } catch {
    /* ignore */
  }
}

function normalizeJob(p: SpvPendingDeposit | null | undefined): SpvPendingDeposit | null {
  if (!p || p.v !== 1 || !p.txid || !p.falconAccount) return null
  const txid = p.txid.toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{64}$/.test(txid)) return null
  if (DEAD_SPV_TXIDS.has(txid)) return null
  return { ...p, txid }
}

function writeLastOpen(p: SpvPendingDeposit | null) {
  if (!isBrowser()) return
  if (!p || p.status === 'claimed' || DEAD_SPV_TXIDS.has(p.txid.toLowerCase())) {
    safeRemove(localStorage, LAST_OPEN_KEY)
    safeRemove(sessionStorage, LAST_OPEN_KEY)
    return
  }
  const json = JSON.stringify(p)
  safeSet(localStorage, LAST_OPEN_KEY, json)
  safeSet(sessionStorage, LAST_OPEN_KEY, json)
}

function readLastOpen(): SpvPendingDeposit | null {
  if (!isBrowser()) return null
  for (const store of [localStorage, sessionStorage]) {
    const raw = safeGet(store, LAST_OPEN_KEY)
    if (!raw) continue
    try {
      const p = normalizeJob(JSON.parse(raw) as SpvPendingDeposit)
      if (p && p.status !== 'claimed') return p
    } catch {
      /* ignore */
    }
  }
  return null
}

function readMap(): Record<string, SpvPendingDeposit> {
  if (!isBrowser()) return {}
  for (const k of LEGACY_KEYS) {
    safeRemove(localStorage, k)
  }
  const raw = safeGet(localStorage, MAP_KEY)
  if (!raw) return {}
  try {
    const j = JSON.parse(raw) as Record<string, SpvPendingDeposit>
    if (!j || typeof j !== 'object') return {}
    let dirty = false
    for (const [acct, p] of Object.entries(j)) {
      if (!normalizeJob(p)) {
        delete j[acct]
        dirty = true
      }
    }
    if (dirty) safeSet(localStorage, MAP_KEY, JSON.stringify(j))
    return j
  } catch {
    return {}
  }
}

function writeMap(map: Record<string, SpvPendingDeposit>) {
  if (!isBrowser()) return
  safeSet(localStorage, MAP_KEY, JSON.stringify(map))
}

function readPerAccount(account: string): SpvPendingDeposit | null {
  if (!isBrowser()) return null
  const raw = safeGet(localStorage, jobKey(account)) || safeGet(sessionStorage, jobKey(account))
  if (!raw) return null
  try {
    return normalizeJob(JSON.parse(raw) as SpvPendingDeposit)
  } catch {
    return null
  }
}

function writePerAccount(p: SpvPendingDeposit) {
  if (!isBrowser()) return
  const json = JSON.stringify(p)
  safeSet(localStorage, jobKey(p.falconAccount), json)
  safeSet(sessionStorage, jobKey(p.falconAccount), json)
}

function clearPerAccount(account: string) {
  if (!isBrowser()) return
  safeRemove(localStorage, jobKey(account))
  safeRemove(sessionStorage, jobKey(account))
}

/** Remember every deposit txid for this account (recover list). */
export function rememberDepositTxid(falconAccount: string, txid: string, amountSats?: number) {
  if (!isBrowser()) return
  const id = txid.toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{64}$/.test(id) || DEAD_SPV_TXIDS.has(id)) return
  try {
    const key = historyKey(falconAccount)
    const raw = safeGet(localStorage, key)
    const list: Array<{ txid: string; amountSats?: number; at: number }> = raw
      ? (JSON.parse(raw) as Array<{ txid: string; amountSats?: number; at: number }>)
      : []
    const next = [{ txid: id, amountSats, at: Date.now() }, ...list.filter((x) => x.txid !== id)].slice(
      0,
      20,
    )
    safeSet(localStorage, key, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

export function listRememberedDepositTxids(falconAccount: string): string[] {
  if (!isBrowser()) return []
  try {
    const raw = safeGet(localStorage, historyKey(falconAccount))
    if (!raw) return []
    const list = JSON.parse(raw) as Array<{ txid: string }>
    return list
      .map((x) => x.txid)
      .filter((t) => t && !DEAD_SPV_TXIDS.has(t) && !isDepositClaimedLocally(falconAccount, t))
  } catch {
    return []
  }
}

function claimedKey(falconAccount: string): string {
  return `${CLAIMED_PREFIX}${falconAccount}`
}

/** Persist successful claim so restore never re-opens Claim FBTC for this txid. */
export function markDepositClaimed(falconAccount: string, txid: string): void {
  if (!isBrowser()) return
  const id = txid.toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{64}$/.test(id)) return
  try {
    const key = claimedKey(falconAccount)
    const raw = safeGet(localStorage, key)
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : []
    const next = [id, ...list.filter((x) => x !== id)].slice(0, 50)
    safeSet(localStorage, key, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

export function isDepositClaimedLocally(falconAccount: string, txid: string): boolean {
  if (!isBrowser()) return false
  const id = txid.toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{64}$/.test(id)) return false
  if (DEAD_SPV_TXIDS.has(id)) return true
  try {
    const raw = safeGet(localStorage, claimedKey(falconAccount))
    if (!raw) return false
    const list = JSON.parse(raw) as string[]
    return list.includes(id)
  } catch {
    return false
  }
}

export function getSpvPending(falconAccount: string): SpvPendingDeposit | null {
  // 1) per-account
  let p = readPerAccount(falconAccount)
  // 2) map
  if (!p) {
    const map = readMap()
    p = normalizeJob(map[falconAccount])
  }
  // 3) last-open
  if (!p) {
    const last = readLastOpen()
    if (last && last.falconAccount === falconAccount && last.status !== 'claimed') {
      p = last
    }
  }
  if (!p) return null
  if (DEAD_SPV_TXIDS.has(p.txid.toLowerCase())) {
    clearSpvPending(falconAccount)
    return null
  }
  if (p.status === 'claimed' && Date.now() - p.updatedAt > 24 * 3600_000) {
    clearSpvPending(falconAccount)
    return null
  }
  // Re-persist to all layers so refresh always finds it
  if (p.status !== 'claimed') {
    saveSpvPending(p)
  }
  return p
}

export function hasOpenSpvBridge(falconAccount: string): boolean {
  const p = getSpvPending(falconAccount)
  if (!p) return false
  return p.status !== 'claimed'
}

export function saveSpvPending(p: SpvPendingDeposit): void {
  const job = normalizeJob(p)
  if (!job) return
  if (job.status === 'claimed') {
    // keep briefly for success UI, still write
  }
  const next = { ...job, updatedAt: Date.now() }
  const map = readMap()
  map[next.falconAccount] = next
  writeMap(map)
  writePerAccount(next)
  writeLastOpen(next.status === 'claimed' ? null : next)
  rememberDepositTxid(next.falconAccount, next.txid, next.amountSats)
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
  const map = readMap()
  delete map[falconAccount]
  writeMap(map)
  clearPerAccount(falconAccount)
  const last = readLastOpen()
  if (!last || last.falconAccount === falconAccount) {
    writeLastOpen(null)
  }
}

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
    throw new Error('This deposit cannot be claimed (spent or closed)')
  }
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    throw new Error('Invalid Bitcoin transaction id')
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

export function ensureSpvPendingTracked(
  falconAccount: string,
  defaults?: {
    watchAddress?: string
    minConfirmations?: number
    btcNetwork?: 'testnet' | 'mainnet'
  },
): SpvPendingDeposit | null {
  const existing = getSpvPending(falconAccount)
  if (existing && existing.status !== 'claimed') {
    // Never keep an active card for a tx we already claimed successfully
    if (isDepositClaimedLocally(falconAccount, existing.txid)) {
      clearSpvPending(falconAccount)
      return null
    }
    return existing
  }
  const last = readLastOpen()
  if (last && last.falconAccount === falconAccount && last.status !== 'claimed') {
    if (isDepositClaimedLocally(falconAccount, last.txid)) {
      writeLastOpen(null)
      return null
    }
    saveSpvPending(last)
    return last
  }
  // Do NOT rehydrate a fresh "waiting_confs" job from history alone —
  // history includes completed peg-ins; chain list_deposits is the restore path
  // for truly unclaimed deposits. Blind history rehydrate caused Claim FBTC
  // to reappear after a successful claim.
  void defaults
  return null
}

export function isSpvWaitMessage(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    /failed to fetch|networkerror|load failed|fetch failed|econnreset|etimedout|aborterror|timeout/i.test(
      m,
    ) ||
    /tx not found|not found yet|not confirmed yet|wait for|mempool|indexer|unavailable|raw tx not found|merkle proof unavailable|status \d+|502|503|504|404|409/i.test(
      m,
    ) ||
    /headers have not|header submitter|falcon tip|blocks behind|still catching up/i.test(m)
  )
}

export function spvWaitUserMessage(msg?: string): string {
  if (!msg) return 'Waiting for Bitcoin explorers to index your deposit…'
  const m = msg.toLowerCase()
  if (/headers have not|header submitter|falcon tip|blocks behind/i.test(m)) {
    return 'Bitcoin confirmations are OK, but Falcon has not imported this block header yet. Wait, then Claim FBTC again — do not re-send BTC.'
  }
  if (/not confirmed|wait for a block|need \d+ confirmation|reserve payout|redeem/i.test(m)) {
    if (/reserve|redeem|payout|prove/i.test(m)) {
      return 'Reserve BTC payout is confirming on Bitcoin — wait for blocks, then Prove. Your burn is safe (not a deposit problem).'
    }
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

/**
 * Find open FALC deposits for this Falcon account on the hold (chain-side restore).
 */
export async function fetchOpenDepositsForAccount(opts: {
  falconAccount: string
  holdAddress: string
  btcNetwork?: 'testnet' | 'mainnet'
}): Promise<Array<{ txid: string; vout: number; amountSats: number; confirmations: number }>> {
  try {
    const r = await fetch('/api/bridge/btc-spv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'list_deposits',
        account: opts.falconAccount,
        network: opts.btcNetwork || 'testnet',
      }),
      cache: 'no-store',
    })
    const j = (await r.json().catch(() => ({}))) as {
      deposits?: Array<{
        txid: string
        vout: number
        amountSats: number
        confirmations: number
      }>
      error?: string
    }
    if (!r.ok) return []
    return j.deposits || []
  } catch {
    return []
  }
}
