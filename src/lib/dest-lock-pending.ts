/**
 * Persist ETH/USDC dest-lock peg-in so mint progress survives refresh.
 * Multiple jobs (ETH and USDC at once) are stored per account.
 */

export type DestLockPendingStatus = 'locking' | 'minting' | 'done' | 'error'

export interface DestLockPending {
  v: 1
  falconAccount: string
  txHash: string
  asset: 'ETH' | 'USDC'
  amountLabel?: string
  explorerUrl: string
  status: DestLockPendingStatus
  lastError?: string
  depositBlock?: number
  lcExecution?: number
  /** Blocks until the deposit is inside the light client's safe range (from mint-status). */
  waitingBlocks?: number
  /** Last successful mint-status poll (ms since epoch). */
  statusCheckedAt?: number
  /** Set when the latest mint-status poll failed; cleared on the next success. */
  statusError?: string
  /** FalconQcBridgeV3 deposit id (V3 peg-in only): needed to claim a refund after 3 days. */
  v3DepositId?: string
  createdAt: number
  updatedAt: number
}

const LIST_PREFIX = 'falcon-destlock-jobs-v2:'
const LEGACY_PREFIX = 'falcon-destlock-pending-v1:'

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

function listKey(account: string): string {
  return `${LIST_PREFIX}${account.trim().toLowerCase()}`
}

function legacyKey(account: string): string {
  return `${LEGACY_PREFIX}${account.trim().toLowerCase()}`
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}

function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* quota / private */
  }
}

function safeRemove(k: string) {
  try {
    localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}

function parseOne(raw: string | null): DestLockPending | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as DestLockPending
    if (!p?.txHash || !p.asset) return null
    return p
  } catch {
    return null
  }
}

export function listDestLockPending(account: string): DestLockPending[] {
  if (!isBrowser() || !account.trim()) return []
  const out: DestLockPending[] = []
  const raw = safeGet(listKey(account))
  if (raw) {
    try {
      const arr = JSON.parse(raw) as DestLockPending[]
      if (Array.isArray(arr)) {
        for (const p of arr) {
          if (p?.txHash && (p.asset === 'ETH' || p.asset === 'USDC')) out.push(p)
        }
      }
    } catch {
      /* ignore */
    }
  }
  const legacy = parseOne(safeGet(legacyKey(account)))
  if (legacy && !out.some((j) => j.txHash.toLowerCase() === legacy.txHash.toLowerCase())) {
    out.push(legacy)
  }
  return out
}

function saveList(account: string, jobs: DestLockPending[]) {
  safeSet(listKey(account), JSON.stringify(jobs))
}

/** Latest job (legacy helper). Prefer listDestLockPending. */
export function getDestLockPending(account: string): DestLockPending | null {
  const jobs = listDestLockPending(account)
  const open = jobs.find((j) => j.status !== 'done')
  return open ?? jobs[jobs.length - 1] ?? null
}

export function saveDestLockPending(p: DestLockPending): DestLockPending {
  const next: DestLockPending = { ...p, v: 1, updatedAt: Date.now() }
  const jobs = listDestLockPending(p.falconAccount)
  const i = jobs.findIndex((j) => j.txHash.toLowerCase() === next.txHash.toLowerCase())
  if (i >= 0) jobs[i] = next
  else jobs.push(next)
  saveList(p.falconAccount, jobs)
  return next
}

export function clearDestLockPending(account: string, txHash?: string) {
  if (!isBrowser()) return
  if (!txHash) {
    saveList(account, [])
    safeRemove(legacyKey(account))
    return
  }
  const want = txHash.toLowerCase()
  saveList(
    account,
    listDestLockPending(account).filter((j) => j.txHash.toLowerCase() !== want),
  )
  const legacy = parseOne(safeGet(legacyKey(account)))
  if (legacy && legacy.txHash.toLowerCase() === want) safeRemove(legacyKey(account))
}

export function upsertDestLockPending(
  account: string,
  patch: Partial<DestLockPending> & Pick<DestLockPending, 'txHash' | 'asset' | 'explorerUrl'>,
): DestLockPending {
  const jobs = listDestLockPending(account)
  const prev = jobs.find((j) => j.txHash.toLowerCase() === patch.txHash.toLowerCase())
  return saveDestLockPending({
    v: 1,
    falconAccount: account,
    status: 'minting',
    createdAt: prev?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    ...prev,
    ...patch,
  })
}

/**
 * Human text for a deposit waiting on the Sepolia light client.
 * lcExecution 0 / missing means the light client has no resolved execution
 * head yet, so it reads "syncing" rather than "at block 0".
 * Returns null when the deposit is not waiting on the light client.
 */
export function destLockLcWaitText(job: {
  depositBlock?: number
  lcExecution?: number
  waitingBlocks?: number
}): string | null {
  const dep = Number(job.depositBlock ?? 0)
  if (!(dep > 0)) return null
  const lc = Number(job.lcExecution ?? 0)
  const waiting = Number(job.waitingBlocks ?? 0)
  const remaining = waiting > 0 ? waiting : lc > 0 && lc < dep ? dep - lc : 0
  const rem = remaining > 0 ? ` ${remaining.toLocaleString()} blocks remaining.` : ''
  if (!(lc > 0)) {
    return `Waiting for Ethereum finality. Light client syncing; deposit is in block ${dep.toLocaleString()}.${rem}`
  }
  if (lc < dep || waiting > 0) {
    return `Waiting for Ethereum finality. Light client is at block ${lc.toLocaleString()}, deposit is in ${dep.toLocaleString()}.${rem}`
  }
  return null
}
