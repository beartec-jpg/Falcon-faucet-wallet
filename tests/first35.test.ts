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
    expect(validateApplication({ ...ok, account: 'BAD NAME' })).toMatch(/account/)
    expect(validateApplication({ ...ok, telegram: '' })).toMatch(/Telegram/)
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
