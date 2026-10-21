import { describe, expect, it, vi } from 'vitest'
import { advanceState, ago, buildHealth, detect, discordMessages, emptyState, reconcile, seatRows, RULES } from '@/lib/network-health'
import { retiredSeats, RETIRED_SEATS } from '@/config/retired-seats'
import { memoryHealthStore } from '@/lib/network-health-store'
import { postDiscord, runHealthAlerts } from '@/lib/network-health-server'

type V = Record<string, unknown>
const seat = (id: string, o: V = {}): V => ({ id, bond: 50_000, jailed: false, pack_count: 10, pong_fresh: true, last_advertised_tip: 1000, v2: { missed_turns: 0, inactive: false }, ...o })
function status(tip: number, vals: V[], o: V = {}): V {
  return { tip_height: tip, network_id: 2300, epoch: 10, epoch_ms: 1000, genesis_ms: 0, now_ms: 9_500, lottery_winner_next: 'v1', validators: vals, online_seats: vals.map((v) => v.id), ...o }
}
const MIN = 60_000

describe('seat rows', () => {
  it('status, lag, blanks', () => {
    const st = status(1000, [
      seat('v1'),
      seat('v3', { last_advertised_tip: 958 }),
      seat('v12', { jailed: true, last_advertised_tip: 768, v2: { missed_turns: 20 } }),
      seat('v44', { v2: { inactive: true } }),
      seat('v99', { last_advertised_tip: 0, pong_fresh: false }),
    ], { online_seats: ['v1', 'v3'] })
    const r = Object.fromEntries(seatRows(st, emptyState()).map((x) => [x.id, x]))
    expect(r.v1.status).toBe('active')
    expect(r.v1.lag).toBe(0)
    expect(r.v3).toMatchObject({ status: 'syncing', lag: 42, height: 958 })
    expect(r.v12).toMatchObject({ status: 'jailed', lag: 232, missedTurns: 20 })
    expect(r.v44.status).toBe('inactive')
    expect(r.v99).toMatchObject({ status: 'offline', height: null, lag: null })
    // Not reported publicly yet => blank, never a placeholder.
    expect(r.v1.version).toBeNull()
    expect(r.v1.lastProposalAt).toBeNull()
  })
  it('KPIs', () => {
    const st = status(1000, [seat('v1'), seat('v3', { last_advertised_tip: 900 }), seat('v12', { jailed: true })])
    const h = buildHealth(st, emptyState(), [{ t: 1, v: 12 }, { t: 2, v: 13 }], 5)
    expect(h).toMatchObject({ tip: 1000, epoch: 10, epochProgressPct: 50, blocksPerMin: 13, blocksPerMin24h: 12.5, behind: ['v3'], jailed: ['v12'] })
    expect(h.validators).toEqual({ active: 1, total: 3 })
    expect(buildHealth(st, emptyState(), [], 5).blocksPerMin).toBeNull()
  })
})

describe('state', () => {
  it('last proposal = sample where pack_count rose; first sighting is only a baseline', () => {
    let s = advanceState(status(1000, [seat('v1', { pack_count: 5 })]), emptyState(), 1)
    expect(s.packs.v1).toEqual({ count: 5, at: null })
    s = advanceState(status(1001, [seat('v1', { pack_count: 5 })]), s, 2)
    expect(s.packs.v1.at).toBeNull()
    s = advanceState(status(1002, [seat('v1', { pack_count: 6 })]), s, 3)
    expect(s.packs.v1.at).toBe(3)
    expect(s.tipAdvancedAt).toBe(3)
  })
})

describe('detect + dedupe', () => {
  const vals = [seat('v1'), seat('v22', { last_advertised_tip: 1000 - RULES.lagBlocks - 1 })]
  it('lag > 20 fires, exactly 20 does not', () => {
    const st = status(1000, [seat('v1', { last_advertised_tip: 980 }), ...vals.slice(1)])
    const s = advanceState(st, emptyState(), 0)
    const keys = detect(st, s, seatRows(st, s), 0).map((a) => a.key)
    expect(keys).toEqual(['seat:v22:lag'])
  })
  it('stall after 3 min, proposer stuck, jailed/inactive', () => {
    const st = status(1000, [seat('v1'), seat('v55', { jailed: true }), seat('v6', { v2: { inactive: true } })], { height_view_round: 3 })
    let s = advanceState(st, emptyState(), 0)
    expect(detect(st, s, seatRows(st, s), 2 * MIN).map((a) => a.key)).not.toContain('chain:stall')
    s = advanceState(st, s, 5 * MIN)
    const a = detect(st, s, seatRows(st, s), 5 * MIN)
    expect(a.map((x) => x.key).sort()).toEqual(['chain:stall', 'proposer:v1:1001', 'seat:v55:jailed', 'seat:v6:inactive'])
    expect(a.find((x) => x.key === 'proposer:v1:1001')?.detail).toContain('view round 3')
  })
  it('one firing message per alert, then a recovery', () => {
    const lag = status(1000, vals)
    let s = advanceState(lag, emptyState(), 0)
    s = reconcile(s, detect(lag, s, seatRows(lag, s), 0), 0)
    let m = discordMessages(s, 0, 'https://falcon-fpl.com')
    expect(m).toHaveLength(1)
    expect(m[0].msg.embeds[0].title).toContain('v22 falling behind')
    expect(m[0].msg.embeds[0].url).toBe('https://falcon-fpl.com/network/health')
    s = { ...s, alerts: { ...s.alerts, 'seat:v22:lag': { ...s.alerts['seat:v22:lag'], notified: true } } }
    // still lagging: no new message, since kept
    const s2 = reconcile(advanceState(lag, s, MIN), detect(lag, s, seatRows(lag, s), MIN), MIN)
    expect(discordMessages(s2, MIN, 'x')).toHaveLength(0)
    expect(s2.alerts['seat:v22:lag'].since).toBe(0)
    // recovered
    const ok = status(1001, [seat('v1', { last_advertised_tip: 1001 }), seat('v22', { last_advertised_tip: 1001 })])
    const s3 = advanceState(ok, s2, 7 * MIN)
    const s4 = reconcile(s3, detect(ok, s3, seatRows(ok, s3), 7 * MIN), 7 * MIN)
    m = discordMessages(s4, 7 * MIN, 'x')
    expect(m[0].msg.embeds[0].title).toBe('✅ Recovered: v22 falling behind')
    expect(m[0].recover).toBe(1)
  })
})

describe('runHealthAlerts', () => {
  const lagging = status(1000, [seat('v1'), seat('v22', { last_advertised_tip: 900 })])
  it('webhook unset: sends nothing, keeps state', async () => {
    const f = vi.fn()
    const store = memoryHealthStore()
    const r = await runHealthAlerts(lagging, 0, { store, webhook: null, fetch: f as never })
    expect(f).not.toHaveBeenCalled()
    expect(r).toMatchObject({ active: 1, sent: 0, webhook: false })
    expect(Object.keys((await store.load()).alerts)).toEqual(['seat:v22:lag'])
  })
  it('webhook set: fires once, dedupes, sends recovery; retries after a failed post', async () => {
    const bodies: unknown[] = []
    let ok = false
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return { ok } as Response
    })
    const store = memoryHealthStore()
    const opts = { store, webhook: 'https://discord.test/hook', fetch: f as never, siteUrl: 'https://falcon-fpl.com' }
    expect((await runHealthAlerts(lagging, 0, opts)).sent).toBe(0) // post failed
    ok = true
    expect((await runHealthAlerts(lagging, MIN, opts)).sent).toBe(1) // retried
    expect((await runHealthAlerts(lagging, 2 * MIN, opts)).sent).toBe(0) // deduped
    const healed = status(1001, [seat('v1', { last_advertised_tip: 1001 }), seat('v22', { last_advertised_tip: 1001 })])
    expect((await runHealthAlerts(healed, 3 * MIN, opts)).recoveries).toBe(1)
    expect((await runHealthAlerts(healed, 4 * MIN, opts)).recoveries).toBe(0)
    expect(f).toHaveBeenCalledTimes(3)
    expect((bodies[1] as { allowed_mentions: unknown }).allowed_mentions).toEqual({ parse: [] })
  })
  it('postDiscord swallows errors', async () => {
    const f = vi.fn(async () => {
      throw new Error('net')
    })
    expect(await postDiscord('https://x', {}, f as never)).toBe(false)
  })
})

describe('ago', () => {
  it('formats and blanks', () => {
    expect(ago(null, 0)).toBe('')
    expect(ago(0, 12_000)).toBe('12s ago')
    expect(ago(0, 6 * MIN)).toBe('6m ago')
  })
})

describe('retired seats', () => {
  it('config list + env extras', () => {
    expect([...retiredSeats('')].sort()).toEqual([...RETIRED_SEATS].sort())
    expect(retiredSeats(' x1, x2 ,').has('x2')).toBe(true)
  })
  it('hidden from table, KPIs and alerts', () => {
    const st = status(1000, [seat('v1'), seat('v2', { jailed: true }), seat('v9', { jailed: true }), seat('v3', { last_advertised_tip: 900 })])
    const s = advanceState(st, emptyState(), 0)
    expect(seatRows(st, s).map((r) => r.id)).toEqual(['v1', 'v3'])
    const h = buildHealth(st, s, [], 0)
    expect(h.jailed).toEqual([])
    expect(h.validators.total).toBe(2)
    expect(detect(st, s, seatRows(st, s), 0).map((a) => a.key)).toEqual(['seat:v3:lag'])
  })
  it('existing retired alerts clear silently (no recovery post)', async () => {
    const store = memoryHealthStore()
    const old = { severity: 'critical' as const, title: 'v2 jailed', detail: 'v2 is jailed', since: 0, notified: true }
    await store.save({ ...emptyState(), alerts: { 'seat:v2:jailed': { key: 'seat:v2:jailed', ...old } }, pendingRecoveries: [{ key: 'seat:v9:jailed', ...old }] })
    const f = vi.fn(async () => ({ ok: true }) as Response)
    const r = await runHealthAlerts(status(1000, [seat('v1'), seat('v2', { jailed: true })]), MIN, { store, webhook: 'https://d.test/h', fetch: f as never })
    expect(f).not.toHaveBeenCalled()
    expect(r).toMatchObject({ active: 0, recoveries: 0 })
    const s = await store.load()
    expect(s.alerts).toEqual({})
    expect(s.pendingRecoveries).toEqual([])
    // and the page hides stale stored ones right away
    expect(buildHealth(status(1000, []), { ...emptyState(), alerts: { 'seat:v2:jailed': { key: 'seat:v2:jailed', ...old } } }, [], 0).alerts).toEqual([])
  })
})

describe('missed turns only when known', () => {
  it('legacy jailed seat: no x/20 in detail', () => {
    const st = status(1000, [seat('v31', { jailed: true, v2: { missed_turns: 0, inactive: false, v2_seat: false } }), seat('v32', { jailed: true, v2: { missed_turns: 0, v2_seat: true } }), seat('v33', { jailed: true, v2: {} })])
    const s = advanceState(st, emptyState(), 0)
    const d = Object.fromEntries(detect(st, s, seatRows(st, s), 0).map((a) => [a.key, a.detail]))
    expect(d['seat:v31:jailed']).toBe('v31 is jailed')
    expect(d['seat:v32:jailed']).toBe('v32 is jailed, 0/20 missed turns')
    expect(d['seat:v33:jailed']).toBe('v33 is jailed')
  })
})
