/**
 * Falcon PL browser-watcher session + signed heartbeat.
 *
 * Presence is on-chain (`TxBody::WatcherHeartbeat`). This module only:
 *   - funds the demo watcher account from the PL faucet if needed
 *   - signs HMAC-dev heartbeats (private 2200)
 *   - keeps a process-local enter/exit log for the faucet live panel
 *
 * Work still comes only from rail headers/deposits. Heartbeats fill slots.
 */

import { ctlClaim, ctlFaucet, ctlHeartbeat, ctlWatcherWork } from '@/lib/pl-ctl'
import { PL_NETWORK_ID, PL_WATCHER_ACCOUNT, plAccount, plStatus } from '@/lib/pl-rpc'

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
  claimable: number
  weight: number
  treasury: number
  railTip: number
  lastHeartbeatAt: string | null
  lastTxId: string | null
  lastError: string | null
  events: WatcherEvent[]
  running: boolean
}

type Session = {
  account: string
  running: boolean
  lastHeartbeatAt: number
  lastTxId: string | null
  lastError: string | null
  enteredSlot: number | null
  events: WatcherEvent[]
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
      epoch: num(st.epoch),
      epochMs: num(st.epoch_ms),
      lastSettledEpoch: num(st.last_settled_epoch),
      claimable: num(acct.claimable),
      weight,
      treasury: num(st.treasury),
      railTip: num(btc?.tip_height),
      lastHeartbeatAt: s.lastHeartbeatAt ? nowIso(s.lastHeartbeatAt) : null,
      lastTxId: s.lastTxId,
      lastError: s.lastError,
      events: s.events,
      running: s.running,
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
      claimable: 0,
      weight: 0,
      treasury: 0,
      railTip: 0,
      lastHeartbeatAt: s.lastHeartbeatAt ? nowIso(s.lastHeartbeatAt) : null,
      lastTxId: s.lastTxId,
      lastError: String(e instanceof Error ? e.message : e),
      events: s.events,
      running: s.running,
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
  const before = await plAccount(account)
  const r = await ctlClaim(account)
  await waitUntilPacked(account, num(before.sequence), 40)
  const after = await watcherSnapshot(account)
  pushEvent(s, {
    kind: 'claimed',
    detail: `claim submitted; claimable now ${after.claimable}, balance ${after.balance}`,
    txId: r.txId,
  })
  return watcherSnapshot(account)
}

export async function realWatcherTest(account = PL_WATCHER_ACCOUNT): Promise<WatcherSnapshot> {
  const s = sessionOf(account)
  await startWatcher(account)
  const st0 = await plStatus(false)
  const epochMs = Math.max(1, num(st0.epoch_ms, 30_000))
  const into =
    (num(st0.now_ms) - num(st0.genesis_ms)) % epochMs
  // Land the whole burst in one epoch so settle does not wipe work mid-flight.
  if (into > epochMs * 0.45) {
    const waitMs = Math.min(epochMs - into + 800, epochMs)
    pushEvent(s, {
      kind: 'work',
      detail: `waiting ${Math.ceil(waitMs / 1000)}s for next epoch so work is not settled away`,
    })
    await new Promise((res) => setTimeout(res, waitMs))
  }
  const workEpoch = num((await plStatus(false)).epoch)
  pushEvent(s, {
    kind: 'work',
    detail: `submitting ${WORK_COUNT} signed BTC headers in epoch ${workEpoch}`,
  })
  await workWatcher(account, WORK_COUNT)
  pushEvent(s, {
    kind: 'work',
    detail: `waiting for epoch ${workEpoch} to settle`,
  })
  const deadline = Date.now() + epochMs + 8_000
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 800))
    const st = await plStatus(false)
    if (num(st.last_settled_epoch) >= workEpoch) break
  }
  const paid = await watcherSnapshot(account)
  pushEvent(s, {
    kind: 'paid',
    detail: `settled; work=${paid.work} slots=${paid.slots} weight=${paid.weight} claimable=${paid.claimable}`,
  })
  if (paid.claimable > 0) {
    return claimWatcher(account)
  }
  return paid
}
