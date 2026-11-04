import { afterEach, describe, expect, it } from 'vitest'
import { FIRST35_SEATS, FIRST35_TIERS, FIRST35_TOTAL_FPL } from '@/config/first35'
import { accountExists, adminTokenOk, isIneligibleAccount, memoryFirst35Store, validateApplication } from '@/lib/first35-store'
import { AIRDROP_POOL_FALCON, AIRDROP_WINDOW_DAYS, COMMUNITY_BUCKET_FPL, FIRST35_SEATS_FPL, PRE_MAINNET_AIRDROP_FPL, RELEASE_PHASE_GIVEAWAY_FPL } from '@/lib/airdrop-score'

describe('First 35 tiers and allocation model', () => {
  it('has 35 seats worth 12M FPL, matching the airdrop model constants', () => {
    expect(FIRST35_TIERS.reduce((t, x) => t + x.to - x.from + 1, 0)).toBe(FIRST35_SEATS)
    expect(FIRST35_TOTAL_FPL).toBe(12_000_000)
    expect(FIRST35_SEATS_FPL).toBe(FIRST35_TOTAL_FPL)
    expect(PRE_MAINNET_AIRDROP_FPL + RELEASE_PHASE_GIVEAWAY_FPL).toBe(COMMUNITY_BUCKET_FPL)
    expect(AIRDROP_POOL_FALCON).toBe(1_000_000_000)
    expect(AIRDROP_WINDOW_DAYS).toBe(49)
  })
})

describe('applications', () => {
  const ok = { account: 'Dave', telegram: '@dave_t', discord: 'dave#1', x_handle: '@dave', note: 'testing swaps' }
  it('validates and normalises', () => {
    expect(validateApplication(ok)).toEqual({ account: 'dave', telegram: 'dave_t', discord: 'dave#1', x_handle: 'dave', note: 'testing swaps' })
    expect(validateApplication({ ...ok, account: 'BAD NAME' })).toMatch(/wallet name/)
    // At least one handle; the rest optional (stored as '').
    expect(validateApplication({ ...ok, telegram: '' })).toEqual({ account: 'dave', telegram: '', discord: 'dave#1', x_handle: 'dave', note: 'testing swaps' })
    expect(validateApplication({ ...ok, telegram: '', discord: '' })).toEqual({ account: 'dave', telegram: '', discord: '', x_handle: 'dave', note: 'testing swaps' })
    expect(validateApplication({ ...ok, telegram: '', discord: '', x_handle: '' })).toMatch(/at least one/)
    expect(validateApplication({ ...ok, telegram: '@', discord: '', x_handle: '' })).toMatch(/at least one/)
    expect(validateApplication({ ...ok, telegram: 'a b c' })).toMatch(/Telegram/)
    expect(validateApplication({ ...ok, note: 'x'.repeat(501) })).toMatch(/500/)
  })
  it('refuses test, load-test and protocol accounts', () => {
    for (const a of ['alice', 'bob', 'carol', 'w001', 'loadgen7', 'v3', 'watcher-brain', 'faucet', 'x-bond']) expect(isIneligibleAccount(a)).toBe(true)
    for (const a of ['dave', 'sally', 'scott.reynolds.123']) expect(isIneligibleAccount(a)).toBe(false)
  })
  it('requires a registered account', () => {
    expect(accountExists({ exists: false, sequence: 5 })).toBe(false)
    expect(accountExists({ sequence: 0, balance: 0 })).toBe(false)
    expect(accountExists({ sequence: 3 })).toBe(true)
    expect(accountExists({ exists: true })).toBe(true)
  })
  it('stores one application per account and counts approved seats', async () => {
    const s = memoryFirst35Store()
    expect(await s.insert(validateApplication(ok) as never, null)).toEqual({ ok: true })
    expect(await s.insert(validateApplication(ok) as never, null)).toEqual({ ok: false, reason: 'duplicate' })
    expect(await s.approvedCount()).toBe(0)
    const [r] = await s.list()
    expect(await s.setStatus(r.id, 'approved')).toBe(true)
    expect(await s.approvedCount()).toBe(1)
  })
})

describe('admin token', () => {
  const prev = process.env.FIRST35_ADMIN_TOKEN
  afterEach(() => {
    process.env.FIRST35_ADMIN_TOKEN = prev
  })
  it('denies when unset or short, accepts only the exact token', () => {
    delete process.env.FIRST35_ADMIN_TOKEN
    expect(adminTokenOk('Bearer anything')).toBe(false)
    process.env.FIRST35_ADMIN_TOKEN = 'short'
    expect(adminTokenOk('Bearer short')).toBe(false)
    process.env.FIRST35_ADMIN_TOKEN = 'a-test-token-0123456789'
    expect(adminTokenOk('Bearer a-test-token-0123456789')).toBe(true)
    expect(adminTokenOk('Bearer a-test-token-012345678')).toBe(false)
    expect(adminTokenOk(null)).toBe(false)
  })
})

describe('admin store and helpers', () => {
  it('maps seats to tiers', async () => {
    const { tierForSeat } = await import('@/lib/first35-store')
    expect([1, 5, 6, 15, 16, 35].map(tierForSeat)).toEqual([1_000_000, 1_000_000, 500_000, 500_000, 100_000, 100_000])
    expect(tierForSeat(0)).toBeNull()
    expect(tierForSeat(36)).toBeNull()
    expect(tierForSeat(null)).toBeNull()
  })
  it('validates admin entries', async () => {
    const { validateAdminEntry } = await import('@/lib/first35-store')
    const base = { account: 'newbie', telegram: 't1', discord: 'd1', x_handle: 'x1', note: '' }
    expect(validateAdminEntry({ ...base, status: 'approved', seat: '3' })).toMatchObject({ status: 'approved', seat: 3 })
    expect(validateAdminEntry({ ...base, seat: 40 })).toMatch(/Seat/)
    expect(validateAdminEntry({ ...base, status: 'bogus' })).toMatch(/Status/)
    expect(validateAdminEntry({ ...base, status: 'revoked', seat: 4 })).toMatchObject({ seat: null })
  })
  it('adds, seats, revokes (freeing the seat), edits and deletes', async () => {
    const { memoryFirst35Store } = await import('@/lib/first35-store')
    const s = memoryFirst35Store()
    const e = { account: 'a1', telegram: 't', discord: 'd', x_handle: 'x', note: '', status: 'approved' as const, seat: 1 }
    const r1 = await s.adminInsert(e)
    expect(r1.ok).toBe(true)
    expect(await s.adminInsert({ ...e, account: 'a2' })).toEqual({ ok: false, reason: 'seat_taken' })
    expect(await s.adminInsert({ ...e, seat: 2 })).toEqual({ ok: false, reason: 'duplicate' })
    const r2 = await s.adminInsert({ ...e, account: 'a2', seat: null })
    const id1 = (r1 as { id: number }).id, id2 = (r2 as { id: number }).id
    expect(await s.setSeat(id2, 1)).toEqual({ ok: false, reason: 'seat_taken' })
    expect(await s.setStatus(id1, 'revoked')).toBe(true)
    expect((await s.list()).find((x) => x.id === id1)?.seat).toBeNull()
    expect(await s.setSeat(id2, 1)).toEqual({ ok: true })
    expect(await s.update(id2, { ...e, account: 'a2', note: 'edited', seat: 1 })).toEqual({ ok: true })
    expect((await s.list()).find((x) => x.id === id2)).toMatchObject({ note: 'edited', manual: true })
    expect(await s.approvedCount()).toBe(1)
    expect(await s.remove(id1)).toBe(true)
    expect(await s.remove(id1)).toBe(false)
    expect((await s.list()).length).toBe(1)
  })
  it('exports CSV safely', async () => {
    const { applicationsCsv } = await import('@/lib/first35-store')
    const csv = applicationsCsv([{ id: 1, account: 'a', telegram: '=cmd', discord: 'd,1', x_handle: 'x', note: 'say "hi"', status: 'approved', seat: 7, manual: true, created_at: '2026-10-14', last_active: '2026-10-13' }])
    const line = csv.trim().split('\n')[1]
    expect(line).toContain("'=cmd")
    expect(line).toContain('"d,1"')
    expect(line).toContain('"say ""hi"""')
    expect(line).toContain('500000')
  })
})

describe('public seat holders', () => {
  it('lists approved only, by seat, with no handles or notes', async () => {
    const { publicHolders } = await import('@/lib/first35-store')
    const base = { telegram: 't1', discord: 'd1', x_handle: 'x1', note: 'secret', manual: false, created_at: '' }
    const out = publicHolders([
      { ...base, id: 1, account: 'b', status: 'approved', seat: 7 },
      { ...base, id: 2, account: 'a', status: 'approved', seat: 2 },
      { ...base, id: 3, account: 'c', status: 'pending', seat: null },
      { ...base, id: 4, account: 'd', status: 'revoked', seat: null },
    ])
    expect(out).toEqual([{ seat: 2, account: 'a', tier_fpl: 1_000_000 }, { seat: 7, account: 'b', tier_fpl: 500_000 }])
    expect(JSON.stringify(out)).not.toMatch(/t1|d1|x1|secret/)
  })
})
