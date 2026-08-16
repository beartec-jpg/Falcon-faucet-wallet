/**
 * Falcon PL browser-watcher session + signed heartbeat.
 *
 * Presence is on-chain (`TxBody::WatcherHeartbeat`). This module:
 *   - funds the demo watcher account from the PL faucet if needed
 *   - signs Falcon-512 heartbeats (2300)
 *   - submits rail-header work and pull-claims
 *   - keeps a process-local enter/exit log for the faucet live panel
 *
 * Work is rail headers/deposits only. Heartbeats fill the current slot.
 * On 2300, first claim is epoch 1. Mainnet keeps the epoch-8 bootstrap.
 */

import { writeFileSync, readFileSync } from 'fs'
import { ctlClaim, ctlFaucet, ctlHeartbeat, ctlWatcherWork } from '@/lib/pl-ctl'
import { PL_NETWORK_ID, PL_WATCHER_ACCOUNT, plAccount, plStatus } from '@/lib/pl-rpc'

const LAST_PAY_FILE = '/tmp/falcon-pl-watcher-last.json'

function loadLastPay(): LastPay | null {
  try {
    return JSON.parse(readFileSync(LAST_PAY_FILE, 'utf8')) as LastPay
  } catch {
    return null
  }
}

function saveLastPay(pay: LastPay) {
  try {
    writeFileSync(LAST_PAY_FILE, JSON.stringify(pay, null, 2))
  } catch {
    /* ignore */
  }
}

export type WatcherEvent = {
  at: string
  kind: 'entered' | 'heartbeat' | 'exited' | 'funded' | 'error' | 'work' | 'paid' | 'claimed'
  detail: string
  slot?: number
  txId?: string
}

export type WatcherSnapshot = {
  online: boolean
  product?: string
  tip?: number
  networkId: number
  account: string
  exists: boolean
  balance: number
  sequence: number
  present: boolean
  work: number
  slots: number
  currentSlot: number
  inSlot: boolean
  slotMs: number
  slotsPerEpoch: number
  epoch: number
  epochMs: number
  lastSettledEpoch: number
  firstClaimEpoch: number
  genesisMs: number
  nowMs: number
  epochEndsInMs: number
  firstPaydayInMs: number
  canClaim: boolean
  claimable: number
  weight: number
  treasury: number
  railTip: number
  lastHeartbeatAt: string | null
  lastTxId: string | null
  lastError: string | null
  events: WatcherEvent[]
  running: boolean
  lastPay: LastPay | null
}

export type LastPay = {
  at: string
  epoch: number
  work: number
  slots: number
  weight: number
  paid: number
  claimed: boolean
  railTip: number
  balance: number
}

type Session = {
  account: string
  running: boolean
  lastHeartbeatAt: number
  lastTxId: string | null
  lastError: string | null
  enteredSlot: number | null
  events: WatcherEvent[]
  lastPay: LastPay | null
}

const sessions = new Map<string, Session>()
const MAX_EVENTS = 80
const MIN_BALANCE = 200
const WORK_BALANCE = 8_000
const WORK_COUNT = 168

function nowIso(ms = Date.now()): string {
  return new Date(ms).toISOString()
}

function sessionOf(account: string): Session {
  let s = sessions.get(account)
  if (!s) {
    s = {
      account,
      running: false,
      lastHeartbeatAt: 0,
      lastTxId: null,
      lastError: null,
      enteredSlot: null,
      events: [],
      lastPay: loadLastPay(),
    }
    sessions.set(account, s)
  }
  return s
}

function pushEvent(s: Session, ev: Omit<WatcherEvent, 'at'> & { at?: string }) {
  s.events.unshift({ at: ev.at ?? nowIso(), ...ev })
  if (s.events.length > MAX_EVENTS) s.events.length = MAX_EVENTS
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

export async function watcherSnapshot(account = PL_WATCHER_ACCOUNT): Promise<WatcherSnapshot> {
  const s = sessionOf(account)
  try {
    const [st, acct] = await Promise.all([plStatus(false), plAccount(account)])
    const currentSlot = num(acct.watcher_current_slot ?? st.watcher_current_slot)
    const inSlot = Boolean(acct.watcher_in_slot)
    const slots = num(acct.watcher_slots)
    const slotMs = num(acct.watcher_slot_ms ?? st.watcher_slot_ms, 1)
    const staleMs = Math.max(slotMs * 3, 4_000)
    const fresh = s.lastHeartbeatAt > 0 && Date.now() - s.lastHeartbeatAt < staleMs
    const present = Boolean(s.running && (inSlot || fresh))
    const work = num(acct.watcher_work)
    const slotsPerEpoch = num(st.watcher_slots_per_epoch, 168)
    const weight = slotsPerEpoch > 0 ? Math.floor((work * slots) / slotsPerEpoch) : 0
    const rails = Array.isArray(st.rails) ? (st.rails as Array<Record<string, unknown>>) : []
    const btc = rails.find((r) => String(r.asset ?? '') === 'BTC')
    const epoch = num(st.epoch)
    const epochMs = num(st.epoch_ms)
    const genesisMs = num(st.genesis_ms)
    const nowMs = num(st.now_ms, Date.now())
    const firstClaimEpoch = num(st.first_claim_epoch, 1)
    const intoEpoch = epochMs > 0 ? (nowMs - genesisMs) % epochMs : 0
    const epochEndsInMs = epochMs > 0 ? Math.max(0, epochMs - intoEpoch) : 0
    const firstPaydayInMs =
      firstClaimEpoch > epoch && epochMs > 0
        ? epochEndsInMs + (firstClaimEpoch - epoch - 1) * epochMs
        : epochEndsInMs
    const claimable = num(acct.claimable)
    return {
      online: true,
      product: String(st.product_version ?? st.product ?? ''),
      tip: num(st.tip_height ?? st.tip),
      networkId: num(st.network_id, PL_NETWORK_ID),
      account,
      exists: Boolean(acct.exists),
      balance: num(acct.balance),
      sequence: num(acct.sequence),
      present,
      work,
      slots,
      currentSlot,
      inSlot,
      slotMs,
      slotsPerEpoch,
      epoch,
      epochMs,
      lastSettledEpoch: num(st.last_settled_epoch),
      firstClaimEpoch,
      genesisMs,
      nowMs,
      epochEndsInMs,
      firstPaydayInMs,
      canClaim: claimable > 0,
      claimable,
      weight,
      treasury: num(st.treasury),
      railTip: num(btc?.tip_height),
      lastHeartbeatAt: s.lastHeartbeatAt ? nowIso(s.lastHeartbeatAt) : null,
      lastTxId: s.lastTxId,
      lastError: s.lastError,
      events: s.events,
      running: s.running,
      lastPay: s.lastPay,
    }
  } catch (e) {
    return {
      online: false,
      networkId: PL_NETWORK_ID,
      account,
      exists: false,
      balance: 0,
      sequence: 0,
      present: false,
      work: 0,
      slots: 0,
      currentSlot: 0,
      inSlot: false,
      slotMs: 0,
      slotsPerEpoch: 168,
      epoch: 0,
      epochMs: 0,
      lastSettledEpoch: 0,
      firstClaimEpoch: 1,
      genesisMs: 0,
      nowMs: 0,
      epochEndsInMs: 0,
      firstPaydayInMs: 0,
      canClaim: false,
      claimable: 0,
      weight: 0,
      treasury: 0,
      railTip: 0,
      lastHeartbeatAt: s.lastHeartbeatAt ? nowIso(s.lastHeartbeatAt) : null,
      lastTxId: s.lastTxId,
      lastError: String(e instanceof Error ? e.message : e),
      events: s.events,
      running: s.running,
      lastPay: s.lastPay,
    }
  }
}

async function ensureFunded(account: string): Promise<string | null> {
  const acct = await plAccount(account)
  if (num(acct.balance) >= MIN_BALANCE) return null
  const r = await ctlFaucet(account, 10_000)
  return r.txId || 'funded'
}

export async function startWatcher(account = PL_WATCHER_ACCOUNT): Promise<WatcherSnapshot> {
  const s = sessionOf(account)
  const fundTx = await ensureFunded(account)
  if (fundTx) {
    pushEvent(s, { kind: 'funded', detail: `faucet drip 10000 FPL`, txId: fundTx })
    // wait a couple of ledgers so the drip is sequenced before the first beat
    await new Promise((r) => setTimeout(r, 1500))
  }
  s.running = true
  s.lastError = null
  if (!s.enteredSlot) {
    const snap = await watcherSnapshot(account)
    s.enteredSlot = snap.currentSlot
    pushEvent(s, {
      kind: 'entered',
      detail: `watcher entered at slot ${snap.currentSlot}`,
      slot: snap.currentSlot,
    })
  }
  return watcherSnapshot(account)
}

export async function stopWatcher(account = PL_WATCHER_ACCOUNT): Promise<WatcherSnapshot> {
  const s = sessionOf(account)
  const snap = await watcherSnapshot(account)
  s.running = false
  s.enteredSlot = null
  pushEvent(s, {
    kind: 'exited',
    detail: `watcher exited (slots=${snap.slots} last_slot=${snap.currentSlot})`,
    slot: snap.currentSlot,
  })
  return watcherSnapshot(account)
}

export async function beatWatcher(account = PL_WATCHER_ACCOUNT): Promise<{
  snapshot: WatcherSnapshot
  txId: string
  msg: string
}> {
  const s = sessionOf(account)
  if (!s.running) {
    await startWatcher(account)
  }
  const fundTx = await ensureFunded(account)
  if (fundTx) {
    pushEvent(s, { kind: 'funded', detail: `top-up 10000 FPL`, txId: fundTx })
    await new Promise((r) => setTimeout(r, 800))
  }
  const before = await plAccount(account)
  const seq0 = num(before.sequence)
  const st = await plStatus(false)
  try {
    const r = await ctlHeartbeat(account)
    // Wait until the heartbeat is packed so the next beat gets a new sequence.
    // Same-seq re-sign is a duplicate and does not fill another slot.
    for (let i = 0; i < 20; i++) {
      await new Promise((res) => setTimeout(res, 200))
      const after = await plAccount(account)
      if (num(after.sequence) > seq0) break
    }
    s.lastHeartbeatAt = Date.now()
    s.lastTxId = r.txId
    s.lastError = null
    const slot = num(st.watcher_current_slot)
    const accepted = /accepted|duplicate|ok/i.test(r.raw) ? 'accepted' : r.raw.trim().slice(-80)
    pushEvent(s, {
      kind: 'heartbeat',
      detail: `slot ${slot} ${accepted}`,
      slot,
      txId: r.txId,
    })
    return { snapshot: await watcherSnapshot(account), txId: r.txId, msg: accepted }
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e)
    s.lastError = msg
    pushEvent(s, { kind: 'error', detail: msg })
    throw e
  }
}

async function waitUntilPacked(account: string, seq0: number, tries = 40) {
  for (let i = 0; i < tries; i++) {
    await new Promise((res) => setTimeout(res, 250))
    const after = await plAccount(account)
    if (num(after.sequence) > seq0) return num(after.sequence)
  }
  return seq0
}

export async function workWatcher(
  account = PL_WATCHER_ACCOUNT,
  count = WORK_COUNT,
): Promise<WatcherSnapshot> {
  const s = sessionOf(account)
  if (num((await plAccount(account)).balance) < WORK_BALANCE) {
    const r = await ctlFaucet(account, 50_000)
    pushEvent(s, { kind: 'funded', detail: `work fund 50000 FPL`, txId: r.txId })
    await new Promise((res) => setTimeout(res, 1500))
  }
  const before = await plAccount(account)
  const r = await ctlWatcherWork(account, count, 'BTC')
  await waitUntilPacked(account, num(before.sequence) + Math.max(0, r.accepted - 1), 80)
  s.lastTxId = r.lastTx
  pushEvent(s, {
    kind: 'work',
    detail: `submitted ${r.accepted}/${count} BTC rail headers`,
    txId: r.lastTx,
  })
  return watcherSnapshot(account)
}

export async function claimWatcher(account = PL_WATCHER_ACCOUNT): Promise<WatcherSnapshot> {
  const s = sessionOf(account)
  const beforeSnap = await watcherSnapshot(account)
  if (beforeSnap.claimable <= 0) {
    const msg =
      beforeSnap.epoch < beforeSnap.firstClaimEpoch
        ? `Nothing to claim yet. Epoch ${beforeSnap.epoch}; first payday is epoch ${beforeSnap.firstClaimEpoch}.`
        : 'Nothing to claim — no settled reward on this account.'
    pushEvent(s, { kind: 'error', detail: msg })
    throw new Error(msg)
  }
  const before = await plAccount(account)
  const r = await ctlClaim(account)
  await waitUntilPacked(account, num(before.sequence), 40)
  const after = await watcherSnapshot(account)
  if (s.lastPay) {
    s.lastPay.claimed = true
    s.lastPay.balance = after.balance
    saveLastPay(s.lastPay)
  }
  pushEvent(s, {
    kind: 'claimed',
    detail: `claimed ${beforeSnap.claimable} FPL; balance now ${after.balance}`,
    txId: r.txId,
  })
  return after
}

export async function realWatcherTest(account = PL_WATCHER_ACCOUNT): Promise<WatcherSnapshot> {
  const s = sessionOf(account)
  await startWatcher(account)
  await beatWatcher(account)
  const st0 = await watcherSnapshot(account)
  const shortEpoch = st0.epochMs > 0 && st0.epochMs <= 120_000
  pushEvent(s, {
    kind: 'work',
    detail: `submitting ${WORK_COUNT} signed BTC headers in epoch ${st0.epoch} (first payday epoch ${st0.firstClaimEpoch})`,
  })
  const mid = await workWatcher(account, WORK_COUNT)
  if (shortEpoch) {
    pushEvent(s, {
      kind: 'work',
      detail: `waiting for epoch ${st0.epoch} to settle (work=${mid.work} slots=${mid.slots})`,
    })
    const deadline = Date.now() + st0.epochMs + 8_000
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 800))
      const st = await plStatus(false)
      if (num(st.last_settled_epoch) >= st0.epoch) break
    }
  } else {
    pushEvent(s, {
      kind: 'work',
      detail: `work recorded. 2300 does not settle for ${Math.round(st0.epochMs / 86_400_000)}d — claim after epoch ${st0.firstClaimEpoch}.`,
    })
  }
  const paid = await watcherSnapshot(account)
  s.lastPay = {
    at: nowIso(),
    epoch: st0.epoch,
    work: mid.work,
    slots: mid.slots,
    weight: mid.weight,
    paid: paid.claimable,
    claimed: false,
    railTip: mid.railTip || paid.railTip,
    balance: paid.balance,
  }
  pushEvent(s, {
    kind: 'paid',
    detail: paid.claimable > 0
      ? `epoch ${st0.epoch} paid ${paid.claimable} FPL (work=${mid.work} slots=${mid.slots})`
      : `work=${mid.work} slots=${mid.slots} weight=${mid.weight} · claimable 0 until epoch ${paid.firstClaimEpoch}`,
  })
  if (paid.claimable > 0) {
    return claimWatcher(account)
  }
  saveLastPay(s.lastPay)
  return paid
}
