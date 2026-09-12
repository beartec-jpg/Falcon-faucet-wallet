/**
 * Persist ETH/USDC dest-lock peg-in so mint progress survives refresh.
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
  createdAt: number
  updatedAt: number
}

const KEY_PREFIX = 'falcon-destlock-pending-v1:'

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

function key(account: string): string {
  return `${KEY_PREFIX}${account.trim().toLowerCase()}`
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

export function getDestLockPending(account: string): DestLockPending | null {
  if (!isBrowser() || !account.trim()) return null
  const raw = safeGet(key(account))
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as DestLockPending
    if (!p?.txHash || !p.asset) return null
    return p
  } catch {
    return null
  }
}

export function saveDestLockPending(p: DestLockPending): DestLockPending {
  const next: DestLockPending = { ...p, v: 1, updatedAt: Date.now() }
  if (isBrowser()) safeSet(key(p.falconAccount), JSON.stringify(next))
  return next
}

export function clearDestLockPending(account: string) {
  if (isBrowser()) safeRemove(key(account))
}

export function upsertDestLockPending(
  account: string,
  patch: Partial<DestLockPending> & Pick<DestLockPending, 'txHash' | 'asset' | 'explorerUrl'>,
): DestLockPending {
  const prev = getDestLockPending(account)
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
