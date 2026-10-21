// Public network health (/network/health) and Discord alerts.
//
// Sources (nothing new is exposed on the nodes):
//   - the brief PL status_req the site already makes (tip, epoch, validators with
//     last_advertised_tip, jailed, v2.inactive, v2.missed_turns, pack_count, pong_fresh)
//   - operatorsBoard (same epoch work share the operator_epoch_work cron records)
//   - the 24h metric store (blocks_min series written by /api/cron/sample-metrics)
//   - HealthState below, carried between cron runs (tip advance time, per-seat
//     pack_count changes = last proposal seen, active alerts for dedupe/recovery)
// Pure functions; storage in network-health-store.ts.

import { operatorsBoard, validatorList } from '@/lib/tracker'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export const RULES = {
  /** Tip unchanged this long => chain stall. */
  stallMs: 3 * 60_000,
  /** Seat behind the network tip by more than this => lagging. */
  lagBlocks: 20,
} as const

export type SeatStatus = 'active' | 'syncing' | 'offline' | 'jailed' | 'inactive'

export interface SeatRow {
  id: string
  status: SeatStatus
  height: number | null
  lag: number | null
  /** Unix ms of the cron sample where this seat's pack_count last went up (null = not seen yet). */
  lastProposalAt: number | null
  /** Seats do not report their version to the public status; blank until they do. */
  version: string | null
  workShare: number | null
  missedTurns: number | null
  bond: number | null
}

export type Severity = 'critical' | 'warning'
export interface Alert {
  key: string
  severity: Severity
  title: string
  detail: string
  since: number
  /** Discord firing message delivered. */
  notified: boolean
}

export interface HealthState {
  tip: number | null
  tipAdvancedAt: number | null
  /** Next-height proposer while the tip is unchanged: who, at what height, since when. */
  proposer: { id: string; height: number; since: number } | null
  packs: Record<string, { count: number; at: number | null }>
  alerts: Record<string, Alert>
  /** Recoveries not yet delivered to Discord. */
  pendingRecoveries: Alert[]
  updatedAt: number | null
}

export const emptyState = (): HealthState => ({
  tip: null,
  tipAdvancedAt: null,
  proposer: null,
  packs: {},
  alerts: {},
  pendingRecoveries: [],
  updatedAt: null,
})

export function seatRows(st: Obj, state: HealthState): SeatRow[] {
  const tip = num(st.tip_height)
  const online = new Set(Array.isArray(st.online_seats) ? (st.online_seats as unknown[]).map(String) : [])
  const share = new Map(operatorsBoard(st).map((r) => [r.id, r.work_share]))
  return validatorList(st)
    .map((v) => {
      const id = str(v.id)
      const v2 = obj(v.v2)
      const adv = num(v.last_advertised_tip)
      const height = adv && adv > 0 ? adv : null
      const lag = tip != null && height != null ? Math.max(0, tip - height) : null
      const jailed = v.jailed === true
      const inactive = v2.inactive === true
      const fresh = v.pong_fresh === true || online.has(id)
      const status: SeatStatus = jailed
        ? 'jailed'
        : inactive
          ? 'inactive'
          : lag != null && lag > RULES.lagBlocks
            ? 'syncing'
            : v.pong_fresh === false && !online.has(id)
              ? 'offline'
              : fresh || lag != null
                ? 'active'
                : 'offline'
      return {
        id,
        status,
        height,
        lag,
        lastProposalAt: state.packs[id]?.at ?? null,
        version: str(v.product_version) || null,
        workShare: share.has(id) ? (share.get(id) as number) : null,
        missedTurns: num(v2.missed_turns),
        bond: num(v.bond),
      }
    })
    .filter((r) => r.id)
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}

/** Advance the carried state with one status sample (cron). */
export function advanceState(st: Obj, prev: HealthState, at: number): HealthState {
  const tip = num(st.tip_height)
  const s: HealthState = { ...prev, packs: { ...prev.packs }, alerts: { ...prev.alerts }, pendingRecoveries: [...prev.pendingRecoveries] }
  if (tip != null && (prev.tip == null || tip !== prev.tip)) {
    s.tip = tip
    s.tipAdvancedAt = at
    s.proposer = null
  }
  const next = str(st.lottery_winner_next)
  if (tip != null && next) {
    if (!s.proposer || s.proposer.id !== next || s.proposer.height !== tip + 1) s.proposer = { id: next, height: tip + 1, since: at }
  }
  for (const v of validatorList(st)) {
    const id = str(v.id)
    const c = num(v.pack_count)
    if (!id || c == null) continue
    const p = prev.packs[id]
    // First sighting only records the baseline: we did not see when it proposed.
    s.packs[id] = { count: c, at: p && c > p.count ? at : (p?.at ?? null) }
  }
  s.updatedAt = at
  return s
}

const fmtN = (n: number | null) => (n == null ? '?' : n.toLocaleString('en-GB'))

/** Conditions true right now (keyed for dedupe). */
export function detect(st: Obj, state: HealthState, rows: SeatRow[], at: number): Omit<Alert, 'since' | 'notified'>[] {
  const out: Omit<Alert, 'since' | 'notified'>[] = []
  const tip = num(st.tip_height)
  if (state.tipAdvancedAt != null && at - state.tipAdvancedAt > RULES.stallMs) {
    const mins = Math.round((at - state.tipAdvancedAt) / 60_000)
    out.push({ key: 'chain:stall', severity: 'critical', title: 'Chain stalled', detail: `Tip ${fmtN(tip)} has not advanced for ${mins} min` })
    const p = state.proposer
    if (p && at - p.since > RULES.stallMs) {
      const round = num(st.height_view_round)
      out.push({
        key: `proposer:${p.id}:${p.height}`,
        severity: 'critical',
        title: `Proposer ${p.id} stuck`,
        detail: `${p.id} has been the next proposer for height ${fmtN(p.height)} for ${Math.round((at - p.since) / 60_000)} min${round ? ` (view round ${round})` : ''}`,
      })
    }
  }
  for (const r of rows) {
    if (r.status === 'jailed') out.push({ key: `seat:${r.id}:jailed`, severity: 'critical', title: `${r.id} jailed`, detail: `${r.id} is jailed${r.missedTurns != null ? `, ${r.missedTurns}/20 missed turns` : ''}` })
    else if (r.status === 'inactive') out.push({ key: `seat:${r.id}:inactive`, severity: 'warning', title: `${r.id} inactive`, detail: `${r.id} is inactive${r.missedTurns != null ? ` (${r.missedTurns}/20 missed turns)` : ''}` })
    else if (r.lag != null && r.lag > RULES.lagBlocks)
      out.push({ key: `seat:${r.id}:lag`, severity: 'warning', title: `${r.id} falling behind`, detail: `${r.id} is ${fmtN(r.lag)} blocks behind (height ${fmtN(r.height)}, tip ${fmtN(tip)})` })
  }
  return out
}

/** Merge detections into state: new alerts keep `since`, cleared ones become pending recoveries. */
export function reconcile(state: HealthState, now: Omit<Alert, 'since' | 'notified'>[], at: number): HealthState {
  const alerts: Record<string, Alert> = {}
  for (const a of now) {
    const p = state.alerts[a.key]
    alerts[a.key] = { ...a, since: p?.since ?? at, notified: p?.notified ?? false }
  }
  const pendingRecoveries = [...state.pendingRecoveries]
  for (const [k, p] of Object.entries(state.alerts)) if (!alerts[k] && p.notified) pendingRecoveries.push(p)
  return { ...state, alerts, pendingRecoveries }
}

const COLORS = { critical: 0xf87171, warning: 0xfacc15, ok: 0x4ade80 }

export interface DiscordMessage {
  username: string
  embeds: { title: string; description: string; color: number; url?: string; timestamp: string }[]
}

export function discordMessages(state: HealthState, at: number, siteUrl: string): { msg: DiscordMessage; fire: string[]; recover: number }[] {
  const url = `${siteUrl.replace(/\/$/, '')}/network/health`
  const out: { msg: DiscordMessage; fire: string[]; recover: number }[] = []
  const fire = Object.values(state.alerts).filter((a) => !a.notified)
  const ts = new Date(at).toISOString()
  const embeds = [
    ...fire.map((a) => ({ title: `${a.severity === 'critical' ? '🔴' : '⚠️'} ${a.title}`, description: a.detail, color: COLORS[a.severity], url, timestamp: ts })),
    ...state.pendingRecoveries.map((a) => ({
      title: `✅ Recovered: ${a.title}`,
      description: `${a.detail.split(' (')[0]} — cleared after ${Math.max(1, Math.round((at - a.since) / 60_000))} min`,
      color: COLORS.ok,
      url,
      timestamp: ts,
    })),
  ]
  // Discord allows 10 embeds per message.
  for (let i = 0; i < embeds.length; i += 10) {
    const chunk = embeds.slice(i, i + 10)
    out.push({
      msg: { username: 'Falcon Health Bot', embeds: chunk },
      fire: fire.slice(i, i + 10).map((a) => a.key),
      recover: chunk.filter((e) => e.title.startsWith('✅')).length,
    })
  }
  return out
}

/** After a successful send: mark fired alerts notified, drop delivered recoveries. */
export function markSent(state: HealthState, fired: string[], recovered: number): HealthState {
  const alerts = { ...state.alerts }
  for (const k of fired) if (alerts[k]) alerts[k] = { ...alerts[k], notified: true }
  return { ...state, alerts, pendingRecoveries: state.pendingRecoveries.slice(recovered) }
}

export interface NetworkHealth {
  at: number
  tip: number | null
  networkId: number | null
  epoch: number | null
  epochProgressPct: number | null
  blocksPerMin: number | null
  blocksPerMin24h: number | null
  tipAdvancedAt: number | null
  validators: { active: number; total: number }
  behind: string[]
  jailed: string[]
  seats: SeatRow[]
  alerts: Alert[]
  sampledAt: number | null
}

export function buildHealth(st: Obj, state: HealthState, blocksMin: { t: number; v: number }[], at: number): NetworkHealth {
  const seats = seatRows(st, state)
  const epoch = num(st.epoch)
  const epochMs = num(st.epoch_ms)
  const genesis = num(st.genesis_ms)
  const now = num(st.now_ms) ?? at
  const progress =
    epoch != null && epochMs && genesis != null ? Math.min(100, Math.max(0, Math.round(((now - genesis - (epoch - 1) * epochMs) / epochMs) * 100))) : null
  const recent = blocksMin.length ? blocksMin[blocksMin.length - 1].v : null
  const avg = blocksMin.length ? blocksMin.reduce((t, p) => t + p.v, 0) / blocksMin.length : null
  return {
    at,
    tip: num(st.tip_height),
    networkId: num(st.network_id),
    epoch,
    epochProgressPct: progress,
    blocksPerMin: recent,
    blocksPerMin24h: avg,
    tipAdvancedAt: state.tipAdvancedAt,
    validators: { active: seats.filter((r) => r.status === 'active').length, total: seats.length },
    behind: seats.filter((r) => r.status === 'syncing').map((r) => r.id),
    jailed: seats.filter((r) => r.status === 'jailed').map((r) => r.id),
    seats,
    alerts: Object.values(state.alerts).sort((a, b) => (a.severity === b.severity ? a.since - b.since : a.severity === 'critical' ? -1 : 1)),
    sampledAt: state.updatedAt,
  }
}

/** Relative age for the page; blank when unknown. */
export function ago(ms: number | null, now: number): string {
  if (ms == null) return ''
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
