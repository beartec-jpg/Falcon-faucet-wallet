/**
 * Persist open SPV peg-out jobs so Bridge Out status survives refresh
 * (mirrors falcon-spv-pending for peg-in).
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

export function listSpvWithdraws(
  falconAccount: string,
  opts?: { includeDismissed?: boolean },
): SpvPendingWithdraw[] {
  const list = readMap()[falconAccount] || []
  const filtered = opts?.includeDismissed ? list : list.filter((w) => !w.dismissed)
  return filtered.sort((a, b) => b.burnSeq - a.burnSeq)
}

export function saveSpvWithdraw(w: SpvPendingWithdraw): void {
  const map = readMap()
  const list = map[w.falconAccount] || []
  const i = list.findIndex((x) => x.burnSeq === w.burnSeq)
  const next = { ...w, updatedAt: Date.now() }
  if (i >= 0) list[i] = next
  else list.unshift(next)
  // keep last 12
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

export function dismissSpvWithdraw(falconAccount: string, burnSeq: number): void {
  updateSpvWithdraw(falconAccount, burnSeq, { dismissed: true })
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

export function phaseLabel(phase: SpvWithdrawPhase): string {
  switch (phase) {
    case 'challenge':
      return 'FBTC burned. Short challenge wait, then the reserve can pay BTC…'
    case 'awaiting_btc':
      return 'BTC is sent on Bitcoin first. “Finish on Falcon” only proves that payment (does not unlock a second send).'
    case 'btc_proven':
      return 'Falcon has reverse-SPV proof of the BTC payment — done.'
    case 'complete':
      return 'Done — BTC is in your multi-chain wallet; Falcon books closed.'
    default:
      return 'Bridge out in progress'
  }
}

/** 1–3 for UI steps: Burn → BTC on Bitcoin → reverse-SPV on Falcon */
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

/**
 * Protocol order (not “prove then pay”):
 *  1) Burn FBTC on Falcon → open withdraw object
 *  2) Shared hold pays BTC on Bitcoin (+ FBTO memo)  ← real coins move here
 *  3) BTCWithdrawProve on Falcon = reverse SPV of step 2 (accounting close)
 */
export const PEGOUT_STEPS = [
  '1 · Burn FBTC on Falcon',
  '2 · Reserve pays BTC on Bitcoin',
  '3 · Prove that payment on Falcon',
] as const
