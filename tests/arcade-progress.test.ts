import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('arcade claim progress (accumulating runs)', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.DATABASE_URL
    delete process.env.POSTGRES_URL
  })

  it('applyRunScore credits only the rise within a run, sums across runs, caps per run', async () => {
    const { applyRunScore, EMPTY_RUN_STATE } = await import('@/lib/arcade-store')
    const caps = { maxRunCredit: 500, maxRuns: 3 }
    let s = EMPTY_RUN_STATE
    for (const v of [10, 120, 300, 490]) s = applyRunScore(s, v, 'a', caps)
    expect(s.progress).toBe(490)
    s = applyRunScore(s, 490, 'a', caps) // repeat post, same run
    expect(s.progress).toBe(490)
    s = applyRunScore(s, 40, 'b', caps) // new run adds
    expect(s.progress).toBe(530)
    s = applyRunScore(s, 2000, 'b', caps) // per-run sanity cap
    expect(s.progress).toBe(990)
    s = applyRunScore(s, 500, 'c', caps) // 3rd run, still counted
    expect(s.progress).toBe(1490)
    s = applyRunScore(s, 500, 'd', caps) // over run cap: not counted
    expect(s.progress).toBe(1490)
    expect(s.runs).toBe(4)
  })

  it('legacy clients without run ids: a score drop starts a new run', async () => {
    const { applyRunScore, EMPTY_RUN_STATE } = await import('@/lib/arcade-store')
    let s = applyRunScore(EMPTY_RUN_STATE, 490, '')
    s = applyRunScore(s, 0, '')
    s = applyRunScore(s, 30, '')
    expect(s.progress).toBe(520)
    expect(s.runs).toBe(2)
  })

  it('store: 490 + 30 unlocks; claim consumes 500 and keeps the remainder; best stays single-run', async () => {
    const st = await import('@/lib/arcade-store')
    const who = { network: 't', address: 'scott', game: 'falcon-flight' }
    await st.upsertArcadeScore({ ...who, score: 490, runId: 'r1' })
    expect((await st.getClaimProgress(who)).progress).toBe(490)
    expect((await st.consumeClaimProgress(who)).ok).toBe(false)
    const r = await st.upsertArcadeScore({ ...who, score: 30, runId: 'r2' })
    expect(r.progress).toBe(520)
    expect(r.best).toBe(490)
    const c = await st.consumeClaimProgress(who)
    expect(c).toEqual({ ok: true, progress: 20 })
    expect((await st.consumeClaimProgress(who)).ok).toBe(false)
    await st.refundClaimProgress(who)
    expect((await st.getClaimProgress(who)).progress).toBe(520)
    const lb = await st.getLeaderboard({ network: 't', game: 'falcon-flight' })
    expect(lb[0].score).toBe(490)
  })

  it('progress is per game and per day', async () => {
    const st = await import('@/lib/arcade-store')
    const who = { network: 't', address: 'a', game: 'epoch-rise' }
    await st.upsertArcadeScore({ ...who, score: 400, runId: 'x', dayUtc: '2026-10-17' })
    await st.upsertArcadeScore({ ...who, score: 200, runId: 'y', dayUtc: '2026-10-18' })
    expect((await st.getClaimProgress({ ...who, dayUtc: '2026-10-18' })).progress).toBe(200)
    expect((await st.getClaimProgress({ ...who, game: 'ledger-runner', dayUtc: '2026-10-18' })).progress).toBe(0)
  })

  it('normalizeRunId rejects junk', async () => {
    const { normalizeRunId } = await import('@/lib/arcade-store')
    expect(normalizeRunId('abc-123_X')).toBe('abc-123_X')
    expect(normalizeRunId('a b')).toBe('')
    expect(normalizeRunId(5)).toBe('')
    expect(normalizeRunId('x'.repeat(65))).toBe('')
  })
})

describe('POST /api/arcade/score + /api/arcade/claim (server authoritative)', () => {
  const pay = vi.fn()
  beforeEach(() => {
    vi.resetModules()
    delete process.env.DATABASE_URL
    delete process.env.POSTGRES_URL
    pay.mockReset()
    vi.doMock('@/lib/origin', () => ({ isOriginAllowed: () => true }))
    vi.doMock('@/lib/faucet-pay', () => ({ sendFaucetDrip: pay }))
    vi.doMock('@/lib/faucet-quota', () => ({
      faucetUtcDay: () => '2026-10-18',
      hashIp: async () => 'h',
      logFaucetClaim: async () => {},
      peekFaucetQuota: async () => ({ success: true }),
      consumeFaucetQuota: async () => {},
    }))
  })

  async function call(route: 'score' | 'claim', body: Record<string, unknown>) {
    const { NextRequest } = await import('next/server')
    const mod = route === 'score'
      ? await import('@/app/api/arcade/score/route')
      : await import('@/app/api/arcade/claim/route')
    const res = await mod.POST(new NextRequest(`http://localhost/api/arcade/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))
    return { status: res.status, data: await res.json() }
  }

  it('490 then 30 → claim pays, consumes 500; client claim score ignored; failed pay refunds', async () => {
    const base = { account: 'scott', game: 'falcon-flight' }
    await call('score', { ...base, score: 490, run_id: 'r1' })
    let c = await call('claim', { ...base, score: 99999 })
    expect(c.status).toBe(403)
    expect(c.data.progress).toBe(490)

    const s = await call('score', { ...base, score: 30, run_id: 'r2' })
    expect(s.data.progress).toBe(520)
    expect(s.data.score).toBe(490) // best single run unchanged

    pay.mockResolvedValueOnce({ ok: false, status: 502, error: 'x' })
    c = await call('claim', base)
    expect(c.status).toBe(502)

    pay.mockResolvedValueOnce({ ok: true, amount: 10, txHash: 'T1' })
    c = await call('claim', base)
    expect(c.status).toBe(200)
    expect(c.data.progress).toBe(20)

    c = await call('claim', base)
    expect(c.status).toBe(403)
    expect(pay).toHaveBeenCalledTimes(2)
  })
})
