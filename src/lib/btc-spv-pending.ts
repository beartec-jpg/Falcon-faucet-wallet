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
/** User hid the tracker — chain restore must not resurrect. Resume paste undoes this. */
const DISMISS_PREFIX = 'falcon-spv-dismissed-v1:'
const LEGACY_KEYS = ['falcon-spv-pending-v1'] as const

/**
 * Closed peg-ins: Bitcoin vault UTXO stays unspent after mint, so list_deposits
 * cannot treat "unspent on Bitcoin" as "still claimable". Falcon spent_deposits
 * plus this set are the source of truth.
 */
const DEAD_SPV_TXIDS = new Set([
  'c04373f599000e888720d074e9e6ec04ec817dd2e052b1ccce762c8469a81524',
  '0ac5c315c05858ca284c9587b62acba144a540e97a8f6d2e4f3ddd7aebd3fb2d',
  '9d02624da5e96706d22c0dcd067454f916841212c0c1dd9486e5680cfe8e246c',
  // Falcon BTC rail spent_deposits (already minted FBTC)
  '1c7a16c2cb063474c6213ace0845fd6527a10fd828d5e7bd1fd2ed29037fbbf2',
  '3f27e639bf9581efe1c4846c4fe020ba3a468b7cd2c18f43b15a7d5a0cf6acbf',
  '7c900f51ecf059af62744da8a8b379f7ea9dc2d9e6337da155fab5d730f95f44',
  'b2997d9cd67c6d6b043a32d2ded0d534f6762499051a3cc158f1fcc5d2936829',
  'c31e1894f9ef0efa019e9a40b44343ac6fe4f7920824f1aca5e9c55086e3d11a',
  'f12678178476276e43eba5e3a95f8f9e199c42e880d1f7285ef48a35c66a343c',
])

function normTxid(txid: string): string {
  return txid.toLowerCase().replace(/^0x/, '')
}

export function isDeadSpvTxid(txid: string): boolean {
  const id = normTxid(txid)
  return /^[0-9a-f]{64}$/.test(id) && DEAD_SPV_TXIDS.has(id)
}

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
  const id = normTxid(txid)
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

function dismissedKey(falconAccount: string): string {
  return `${DISMISS_PREFIX}${falconAccount}`
}

function readDismissed(falconAccount: string): string[] {
  if (!isBrowser()) return []
  try {
    const raw = safeGet(localStorage, dismissedKey(falconAccount))
    if (!raw) return []
    const list = JSON.parse(raw) as string[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** Hide this deposit tracker. Chain restore must not reopen it. Resume paste undoes. */
export function dismissSpvDeposit(falconAccount: string, txid: string): void {
  if (!isBrowser()) return
  const id = normTxid(txid)
  if (!/^[0-9a-f]{64}$/.test(id)) return
  try {
    const next = [id, ...readDismissed(falconAccount).filter((x) => x !== id)].slice(0, 50)
    safeSet(localStorage, dismissedKey(falconAccount), JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

export function undismissSpvDeposit(falconAccount: string, txid: string): void {
  if (!isBrowser()) return
  const id = normTxid(txid)
  if (!/^[0-9a-f]{64}$/.test(id)) return
  try {
    const next = readDismissed(falconAccount).filter((x) => x !== id)
    safeSet(localStorage, dismissedKey(falconAccount), JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

export function isSpvDepositDismissed(falconAccount: string, txid: string): boolean {
  const id = normTxid(txid)
  if (!/^[0-9a-f]{64}$/.test(id)) return false
  if (DEAD_SPV_TXIDS.has(id)) return true
  return readDismissed(falconAccount).includes(id)
}

/** Do not auto-restore this txid (dead / minted / user dismissed). */
export function shouldSkipSpvRestore(falconAccount: string, txid: string): boolean {
  const id = normTxid(txid)
  if (!/^[0-9a-f]{64}$/.test(id)) return true
  if (isDeadSpvTxid(id)) return true
  if (isDepositClaimedLocally(falconAccount, id)) return true
  if (isSpvDepositDismissed(falconAccount, id)) return true
  return false
}

/**
 * Wipe already-minted / closed peg-ins from every localStorage layer.
 * Bitcoin vault UTXOs stay unspent after mint, so without this the Bridge
 * card can look “in progress” forever even though FBTC was credited.
 */
export function purgeDeadSpvStorage(accounts: string[] = []): void {
  if (!isBrowser()) return
  const accountsTouched = new Set(accounts.filter(Boolean))

  const scrubJob = (job: SpvPendingDeposit | null | undefined): boolean => {
    if (!job?.txid) return false
    if (!isDeadSpvTxid(job.txid) && job.status !== 'claimed') return false
    if (job.falconAccount) accountsTouched.add(job.falconAccount)
    if (isDeadSpvTxid(job.txid)) {
      for (const a of accountsTouched) {
        markDepositClaimed(a, job.txid)
        dismissSpvDeposit(a, job.txid)
      }
    }
    return true
  }

  try {
    const map = readMap()
    let dirty = false
    for (const [k, raw] of Object.entries(map)) {
      const job = normalizeJob(raw)
      if (!job || scrubJob(job) || isDeadSpvTxid(job.txid)) {
        delete map[k]
        dirty = true
        if (job?.falconAccount) accountsTouched.add(job.falconAccount)
        if (job?.txid && isDeadSpvTxid(job.txid)) {
          markDepositClaimed(k, job.txid)
          dismissSpvDeposit(k, job.txid)
        }
      }
    }
    if (dirty) writeMap(map)

    const last = readLastOpen()
    if (last && (isDeadSpvTxid(last.txid) || last.status === 'claimed')) {
      if (isDeadSpvTxid(last.txid) && last.falconAccount) {
        markDepositClaimed(last.falconAccount, last.txid)
        dismissSpvDeposit(last.falconAccount, last.txid)
      }
      writeLastOpen(null)
    }

    for (const a of accountsTouched) {
      const per = readPerAccount(a)
      if (per && (isDeadSpvTxid(per.txid) || per.status === 'claimed')) {
        if (isDeadSpvTxid(per.txid)) {
          markDepositClaimed(a, per.txid)
          dismissSpvDeposit(a, per.txid)
        }
        clearSpvPending(a)
      }
    }

    // Sweep any leftover keyed blobs that still embed a dead txid
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (!key || !key.includes('falcon-spv')) continue
      if (key.includes('claimed') || key.includes('dismissed') || key.includes('remember')) continue
      try {
        const raw = safeGet(localStorage, key)
        if (!raw) continue
        if ([...DEAD_SPV_TXIDS].some((id) => raw.toLowerCase().includes(id))) {
          safeSet(localStorage, key, key.includes('map') ? '{}' : '')
          if (!key.includes('map')) localStorage.removeItem(key)
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
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
  if (
    DEAD_SPV_TXIDS.has(p.txid.toLowerCase()) ||
    isDepositClaimedLocally(falconAccount, p.txid) ||
    isSpvDepositDismissed(falconAccount, p.txid)
  ) {
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
  const txid = normTxid(input.txid)
  if (DEAD_SPV_TXIDS.has(txid)) {
    throw new Error('This deposit cannot be claimed (spent or closed)')
  }
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    throw new Error('Invalid Bitcoin transaction id')
  }
  // Explicit resume/create undoes a prior Dismiss so the user can Claim.
  undismissSpvDeposit(input.falconAccount, txid)
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
    // Never keep an active card for a tx we already claimed or dismissed
    if (shouldSkipSpvRestore(falconAccount, existing.txid)) {
      clearSpvPending(falconAccount)
      return null
    }
    return existing
  }
  const last = readLastOpen()
  if (last && last.falconAccount === falconAccount && last.status !== 'claimed') {
    if (shouldSkipSpvRestore(falconAccount, last.txid)) {
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
  // Hard claim/config errors must never look like a soft "network blip"
  if (
    /wrong watch|retired watch|already minted|already spent|tecduplicate|amount too small|merkle verify|client bitcoin merkle|btc rail is not/i.test(
      m,
    )
  ) {
    return false
  }
  return (
    /failed to fetch|networkerror|load failed|fetch failed|econnreset|etimedout|aborterror|timeout|offline|unreachable/i.test(
      m,
    ) ||
    /tx not found|not found yet|not confirmed yet|wait for|mempool|indexer|unavailable|raw tx not found|merkle proof unavailable|status \d+|502|503|504|404|409/i.test(
      m,
    ) ||
    /headers have not|header submitter|falcon tip|blocks behind|still catching up|did not commit the rail|no header at height|older block|no longer has bitcoin block/i.test(
      m,
    )
  )
}

export function spvWaitUserMessage(msg?: string): string {
  if (!msg) return 'Waiting for Bitcoin explorers to index your deposit…'
  const m = msg.toLowerCase()
  if (/no header at height|headers have not|header submitter|falcon tip|blocks behind|older block|no longer has bitcoin block/i.test(m)) {
    return 'Bitcoin confirmations are OK. Falcon is loading the older block this deposit is in. Wait, then Claim FBTC again — do not re-send BTC.'
  }
  if (/did not commit the rail/i.test(m)) {
    return 'Waiting for Falcon packers to mint FBTC. Deposit is still on Bitcoin — do not re-send BTC.'
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
  if (
    /failed to fetch|networkerror|network|timeout|unavailable|offline|unreachable|aborterror|econnreset|econnrefused|etimedout|epipe|socket|502|503|504|read econn/i.test(
      m,
    )
  ) {
    return 'Temporary network blip while checking status — deposit is not cancelled. Retrying…'
  }
  // Never surface raw Node/fetch errors under Bridge In
  if (/^still waiting:/i.test(msg.trim())) {
    return 'Still checking deposit status — deposit is not cancelled. Retrying…'
  }
  return 'Still checking deposit status — deposit is not cancelled. Retrying…'
}

async function explorerTxStatus(
  txid: string,
  network: 'testnet' | 'mainnet',
): Promise<{ confirmed: boolean; confirmations: number; blockHeight?: number } | null> {
  const bases =
    network === 'mainnet'
      ? ['https://mempool.space/api', 'https://blockstream.info/api']
      : ['https://mempool.space/testnet/api', 'https://blockstream.info/testnet/api']
  for (const base of bases) {
    try {
      const txR = await fetch(`${base}/tx/${txid}`, { cache: 'no-store' })
      if (!txR.ok) continue
      const tx = (await txR.json()) as {
        status?: { confirmed?: boolean; block_height?: number }
      }
      const height = Number(tx.status?.block_height ?? 0)
      const confirmed = !!tx.status?.confirmed && height > 0
      let tip = 0
      try {
        const tipR = await fetch(`${base}/blocks/tip/height`, { cache: 'no-store' })
        if (tipR.ok) tip = parseInt(await tipR.text(), 10) || 0
      } catch {
        /* ignore */
      }
      const confirmations =
        confirmed && tip > 0 ? Math.max(1, tip - height + 1) : confirmed ? 1 : 0
      return { confirmed, confirmations, blockHeight: confirmed ? height : undefined }
    } catch {
      /* next explorer */
    }
  }
  return null
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
    if (r.ok) {
      return {
        confirmed: !!j.confirmed,
        confirmations: typeof j.confirmations === 'number' ? j.confirmations : 0,
        blockHeight: j.blockHeight,
      }
    }
    // API blip / indexer lag: ask Bitcoin explorers directly so Claim FBTC
    // is not stuck on 0 confirmations.
    const expl = await explorerTxStatus(txid, network)
    if (expl) return expl
    if (r.status === 404 || r.status === 409) {
      return {
        confirmed: false,
        confirmations: typeof j.confirmations === 'number' ? j.confirmations : 0,
        waiting: spvWaitUserMessage(j.error || 'Tx not found yet'),
      }
    }
    if (isSpvWaitMessage(j.error || String(r.status))) {
      return {
        confirmed: false,
        confirmations: typeof j.confirmations === 'number' ? j.confirmations : 0,
        waiting: spvWaitUserMessage(j.error || `Status ${r.status}`),
      }
    }
    throw new Error(j.error || `Status ${r.status}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const expl = await explorerTxStatus(txid, network)
    if (expl) return expl
    if (isSpvWaitMessage(msg)) {
      return { confirmed: false, confirmations: 0, waiting: spvWaitUserMessage(msg) }
    }
    throw e
  }
}

/**
 * Find open FALC deposits for this Falcon account on the hold (chain-side restore).
 */
/** True when Falcon has already minted FBTC for this Bitcoin tx. */
export async function btcDepositAlreadyMinted(txid: string): Promise<boolean> {
  const id = normTxid(txid)
  if (!/^[0-9a-f]{64}$/.test(id) || !isBrowser()) return false
  if (isDeadSpvTxid(id)) return true
  try {
    const r = await fetch('/api/bridge/btc-spv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deposit_spent', txid: id }),
      cache: 'no-store',
    })
    const j = (await r.json().catch(() => ({}))) as { spent?: boolean }
    return r.ok && j.spent === true
  } catch {
    return false
  }
}

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
    return (j.deposits || []).filter((d) => !isDeadSpvTxid(d.txid))
  } catch {
    return []
  }
}
