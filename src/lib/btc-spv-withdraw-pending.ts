/**
 * Persist open SPV peg-out jobs so Bridge Out status survives refresh
 * (mirrors falcon-spv-pending for peg-in).
 *
 * Dismiss is a separate durable set — Hide must never be undone by the
 * 15s chain poll re-importing BtcWithdrawal objects.
 */

export type SpvWithdrawPhase =
  | 'challenge'
  | 'awaiting_btc'
  | 'btc_proven'
  | 'complete'
  | 'unknown'

export interface SpvPendingWithdraw {
  v: 1
  falconAccount: string
  burnSeq: number
  burnHash?: string
  amountSats: number
  payoutAddress: string
  phase: SpvWithdrawPhase
  status: number
  challengeEndLedger?: number
  currentLedger?: number
  btcProven?: boolean
  dismissed?: boolean
  createdAt: number
  updatedAt: number
}

const KEY = 'falcon-spv-withdraw-v1'
/** Permanent Hide list: `${account}:${burnSeq}` — survives poll / refresh */
const DISMISS_KEY = 'falcon-spv-withdraw-dismissed-v1'

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

function readMap(): Record<string, SpvPendingWithdraw[]> {
  if (!isBrowser()) return {}
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const j = JSON.parse(raw) as Record<string, SpvPendingWithdraw[]>
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
}

function writeMap(map: Record<string, SpvPendingWithdraw[]>) {
  if (!isBrowser()) return
  localStorage.setItem(KEY, JSON.stringify(map))
}

function dismissKey(falconAccount: string, burnSeq: number): string {
  return `${falconAccount}:${burnSeq}`
}

function readDismissedSet(): Set<string> {
  if (!isBrowser()) return new Set()
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function writeDismissedSet(set: Set<string>) {
  if (!isBrowser()) return
  // Cap so localStorage cannot grow forever
  const arr = Array.from(set).slice(-200)
  localStorage.setItem(DISMISS_KEY, JSON.stringify(arr))
}

export function isSpvWithdrawDismissed(falconAccount: string, burnSeq: number): boolean {
  return readDismissedSet().has(dismissKey(falconAccount, burnSeq))
}

export function listSpvWithdraws(
  falconAccount: string,
  opts?: { includeDismissed?: boolean },
): SpvPendingWithdraw[] {
  const list = readMap()[falconAccount] || []
  const filtered = opts?.includeDismissed
    ? list
    : list.filter((w) => !w.dismissed && !isSpvWithdrawDismissed(falconAccount, w.burnSeq))
  return filtered.sort((a, b) => b.burnSeq - a.burnSeq)
}

export function saveSpvWithdraw(w: SpvPendingWithdraw): void {
  // Never re-open a user-hidden burn
  if (isSpvWithdrawDismissed(w.falconAccount, w.burnSeq)) return
  if (w.phase === 'complete' || w.status === 2 || w.status === 3) return
  const map = readMap()
  const list = map[w.falconAccount] || []
  const i = list.findIndex((x) => x.burnSeq === w.burnSeq)
  const next = { ...w, updatedAt: Date.now() }
  if (i >= 0) list[i] = next
  else list.unshift(next)
  map[w.falconAccount] = list.slice(0, 12)
  writeMap(map)
}

export function updateSpvWithdraw(
  falconAccount: string,
  burnSeq: number,
  patch: Partial<SpvPendingWithdraw>,
): SpvPendingWithdraw | null {
  const map = readMap()
  const list = map[falconAccount] || []
  const i = list.findIndex((x) => x.burnSeq === burnSeq)
  if (i < 0) return null
  list[i] = { ...list[i], ...patch, updatedAt: Date.now() }
  map[falconAccount] = list
  writeMap(map)
  return list[i]
}

/**
 * Hide this burn forever (poll must not resurrect it).
 * Works even if the job was never in localStorage (chain-only objects).
 */
export function dismissSpvWithdraw(falconAccount: string, burnSeq: number): void {
  const set = readDismissedSet()
  set.add(dismissKey(falconAccount, burnSeq))
  writeDismissedSet(set)

  const map = readMap()
  const list = map[falconAccount] || []
  const i = list.findIndex((x) => x.burnSeq === burnSeq)
  if (i >= 0) {
    list[i] = { ...list[i], dismissed: true, updatedAt: Date.now() }
    map[falconAccount] = list
    writeMap(map)
  }
}

/** True if this object should never appear in the open tracker UI. */
export function isSpvWithdrawClosed(w: {
  phase?: string
  status?: number
  btcProven?: boolean
}): boolean {
  const st = Number(w.status ?? 0)
  if (st === 2 || st === 3) return true
  if (w.phase === 'complete' || w.phase === 'btc_proven') return true
  if (w.btcProven) return true
  return false
}

export function createSpvWithdraw(input: {
  falconAccount: string
  burnSeq: number
  burnHash?: string
  amountSats: number
  payoutAddress: string
  phase?: SpvWithdrawPhase
}): SpvPendingWithdraw {
  const now = Date.now()
  const w: SpvPendingWithdraw = {
    v: 1,
    falconAccount: input.falconAccount,
    burnSeq: input.burnSeq,
    burnHash: input.burnHash,
    amountSats: input.amountSats,
    payoutAddress: input.payoutAddress,
    phase: input.phase ?? 'challenge',
    status: 0,
    createdAt: now,
    updatedAt: now,
  }
  saveSpvWithdraw(w)
  return w
}

export interface SpvWithdrawLive {
  account: string
  burnSeq: number
  status: number
  amountSats: number
  challengeEndLedger: number
  currentLedger: number
  ready: boolean
  btcProven: boolean
  burnCommit?: string
  btcTxId?: string
  payoutScript?: string
  phase: SpvWithdrawPhase
}

/** Live list from Falcon (survives wipe of localStorage). */
export async function fetchSpvWithdrawList(account: string): Promise<{
  currentLedger: number
  withdrawals: SpvWithdrawLive[]
}> {
  const r = await fetch('/api/bridge/btc-spv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'withdraw_list', account }),
    cache: 'no-store',
  })
  const j = (await r.json().catch(() => ({}))) as {
    error?: string
    currentLedger?: number
    withdrawals?: SpvWithdrawLive[]
  }
  if (!r.ok) throw new Error(j.error || `withdraw_list ${r.status}`)
  return {
    currentLedger: j.currentLedger ?? 0,
    withdrawals: j.withdrawals ?? [],
  }
}

/** One short status line for the progress card */
export function phaseLabel(phase: SpvWithdrawPhase): string {
  switch (phase) {
    case 'challenge':
      return 'Waiting…'
    case 'awaiting_btc':
      return 'Paying BTC…'
    case 'btc_proven':
    case 'complete':
      return 'Done'
    default:
      return 'In progress'
  }
}

/** Progress 0–3: burned → paying → finish on Falcon → done */
export function phaseStepIndex(phase: SpvWithdrawPhase): number {
  switch (phase) {
    case 'challenge':
      return 1
    case 'awaiting_btc':
      return 2
    case 'btc_proven':
    case 'complete':
      return 3
    default:
      return 1
  }
}

export const PEGOUT_STEP_TOTAL = 3
