import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { parseExact } from '@/lib/pl-exact-json'
import { FEEDBACK_CONFIG } from '@/config/feedback'
import { TRACKER_CONFIG, TRACKER_MAX_SCORE } from '@/config/tracker'
import { isFeedbackIneligible, memoryFeedbackStore, parseBonus, toApproved, validateFeedback, type ApprovedFeedback } from '@/lib/feedback-store'
import { cleanImage, sniffImage } from '@/lib/feedback-image'
import { accountView, buildTracker, scoreAccount, trackerCsv, type TrackerInput } from '@/lib/tracker'

vi.mock('@/lib/pl-rpc', () => ({
  plAccount: vi.fn(async (name: string) => (name === 'ghost' ? { exists: false } : { exists: true, sequence: 3, balance: '100' })),
}))
vi.mock('@/lib/origin', () => ({ isOriginAllowed: () => true }))

const ok = { account: 'Dave', category: 'bug', area: '/swap', description: 'Swap button stays disabled after approving.', contact: '@dave' }

describe('feedback validation', () => {
  it('normalises a good submission', () => {
    expect(validateFeedback(ok)).toEqual({ ...ok, account: 'dave' })
    expect(validateFeedback({ ...ok, contact: '' })).toMatchObject({ contact: '' })
  })
  it('rejects bad fields and caps lengths', () => {
    expect(validateFeedback({ ...ok, account: 'BAD NAME' })).toMatch(/account name/)
    expect(validateFeedback({ ...ok, category: 'praise' })).toMatch(/Category/)
    expect(validateFeedback({ ...ok, area: '' })).toMatch(/page or area/)
    expect(validateFeedback({ ...ok, area: 'x'.repeat(FEEDBACK_CONFIG.areaMax + 1) })).toMatch(/under/)
    expect(validateFeedback({ ...ok, description: 'too short' })).toMatch(/at least/)
    expect(validateFeedback({ ...ok, description: 'x'.repeat(FEEDBACK_CONFIG.descriptionMax + 1) })).toMatch(/under/)
    expect(validateFeedback({ ...ok, contact: 'a b' })).toMatch(/contact/)
  })
  it('refuses test, protocol and load-test accounts', () => {
    for (const n of ['alice', 'bob', 'carol', 'faucet', 'w001', 'watcher-x', 'loadgen7']) expect(isFeedbackIneligible(n)).toBe(true)
    expect(isFeedbackIneligible('dave')).toBe(false)
  })
  it('parses bonuses with a default and bounds', () => {
    expect(parseBonus('')).toBe(FEEDBACK_CONFIG.defaultBonus)
    expect(parseBonus(undefined)).toBe(FEEDBACK_CONFIG.defaultBonus)
    expect(parseBonus('2.3')).toBe(2.5)
    expect(parseBonus(0)).toBe(0)
    expect(parseBonus(FEEDBACK_CONFIG.maxBonus + 1)).toMatch(/between/)
    expect(parseBonus('abc')).toMatch(/between/)
    expect(FEEDBACK_CONFIG.maxBonus).toBe(TRACKER_CONFIG.bonusCaps.feedback)
  })
})

describe('feedback store', () => {
  it('rate-limits per hashed IP and per account over 24 h', async () => {
    let t = Date.parse('2026-10-14T00:00:00Z')
    const s = memoryFeedbackStore(() => t)
    const v = validateFeedback(ok) as Exclude<ReturnType<typeof validateFeedback>, string>
    for (let i = 0; i < FEEDBACK_CONFIG.perIpPerDay; i++) expect((await s.insert({ ...v, account: `u${i}x` }, 'ip1')).ok).toBe(true)
    expect(await s.insert({ ...v, account: 'other' }, 'ip1')).toEqual({ ok: false, reason: 'rate_ip' })
    for (let i = 0; i < FEEDBACK_CONFIG.perAccountPerDay; i++) await s.insert(v, `ip-${i}`)
    expect(await s.insert(v, 'fresh')).toEqual({ ok: false, reason: 'rate_account' })
    t += 86_400_001
    expect((await s.insert(v, 'ip1')).ok).toBe(true)
  })
  it('approves with a bonus, edits notes, rejects (bonus cleared) and lists approved only', async () => {
    const s = memoryFeedbackStore()
    const v = validateFeedback(ok) as Exclude<ReturnType<typeof validateFeedback>, string>
    const a = await s.insert(v, null)
    const b = await s.insert(v, null)
    if (!a.ok || !b.ok) throw new Error('insert')
    expect(await s.review(a.id, { status: 'approved', bonus: 1 })).toBe(true)
    await s.review(a.id, { admin_notes: 'good catch' })
    await s.review(b.id, { status: 'rejected' })
    expect(await s.review(999, { status: 'approved' })).toBe(false)
    expect((await s.list('pending')).length).toBe(0)
    const ap = await s.approved()
    expect(ap).toHaveLength(1)
    expect(ap[0]).toMatchObject({ account: 'dave', bonus: 1, category: 'bug' })
    expect(ap[0]).not.toHaveProperty('description')
    expect(ap[0]).not.toHaveProperty('contact')
    await s.review(a.id, { status: 'rejected' })
    expect(await s.approved()).toHaveLength(0)
    expect((await s.list('rejected'))[0].bonus).toBe(0)
    expect(toApproved([])).toEqual([])
  })
})

// ── Tracker integration ────────────────────────────────────────────────────
const st = {
  ...(parseExact(readFileSync('tests/fixtures/pl-status-rails-pools.json', 'utf8')) as { body: Record<string, unknown> }).body,
  ...(parseExact(readFileSync('tests/fixtures/pl-status-operators.json', 'utf8')) as { body: Record<string, unknown> }).body,
}
const NOW = Date.parse('2026-10-14T12:00:00Z')
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString().slice(0, 10)
const fb = (id: number, account: string, bonus: number): ApprovedFeedback => ({ id, account, category: 'bug', area: '/swap', bonus, day: day(1) })
const input = (over: Partial<TrackerInput> = {}): TrackerInput => ({ st, activity: [], events: [], days: [], faucet: [], links: [], now: NOW, ...over })

describe('feedback in the tracker', () => {
  it('adds approved bonuses as a capped feedback category', () => {
    const none = scoreAccount('dave', input())
    expect(none.categories.feedback).toMatchObject({ points: 0, cap: TRACKER_CONFIG.bonusCaps.feedback, tracked: true })
    const one = scoreAccount('dave', input({ feedback: [fb(1, 'dave', 1), fb(2, 'sally', 3)] }))
    expect(one.categories.feedback.points).toBe(1)
    expect(one.score).toBe(none.score + 1)
    const many = scoreAccount('dave', input({ feedback: [1, 2, 3, 4, 5, 6, 7].map((i) => fb(i, 'dave', 2)) }))
    expect(many.categories.feedback.points).toBe(TRACKER_CONFIG.bonusCaps.feedback)
    expect(TRACKER_MAX_SCORE).toBe(105)
  })
  it('shows approved feedback on the account view and in the CSV', () => {
    const faucet = [day(1), day(2)].map((d) => ({ account: 'dave', day: d, claims: 1 }))
    const inp = input({ faucet, feedback: [fb(1, 'dave', 1)] })
    const res = buildTracker(inp)
    const v = accountView('dave', inp, res)
    expect(v.feedback).toEqual([fb(1, 'dave', 1)])
    expect(res.board.find((r) => r.account === 'dave')?.categories.feedback.points).toBe(1)
    expect(trackerCsv(res.board).split('\n')[0]).toMatch(/,feedback$/)
  })
})

// ── Routes ─────────────────────────────────────────────────────────────────
describe('feedback routes', () => {
  const TOKEN = 'test-admin-token-0123456789'
  beforeEach(() => {
    vi.stubEnv('FIRST35_ADMIN_TOKEN', TOKEN)
    vi.stubEnv('DATABASE_URL', '')
    vi.stubEnv('POSTGRES_URL', '')
  })
  afterEach(() => vi.unstubAllEnvs())
  const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...headers } })

  it('public submit validates account existence and test accounts, then admin approves', async () => {
    const pub = await import('@/app/api/feedback/route')
    const adm = await import('@/app/api/feedback/admin/route')
    expect((await pub.POST(post('http://x/api/feedback', { ...ok, account: 'alice' }))).status).toBe(400)
    const ghost = await pub.POST(post('http://x/api/feedback', { ...ok, account: 'ghost' }))
    expect(ghost.status).toBe(400)
    expect((await ghost.json()).error).toMatch(/No Falcon PL testnet account/)
    expect((await pub.POST(post('http://x/api/feedback', { ...ok, description: 'x'.repeat(9000) }))).status).toBe(413)
    const r = await pub.POST(post('http://x/api/feedback', ok))
    expect(r.status).toBe(200)
    const { id } = await r.json()

    expect((await adm.GET(new NextRequest('http://x/api/feedback/admin'))).status).toBe(401)
    expect((await adm.GET(new NextRequest('http://x/api/feedback/admin', { headers: { authorization: 'Bearer wrong-token-xxxxxxxx' } }))).status).toBe(401)
    const auth = { authorization: `Bearer ${TOKEN}` }
    const list = await (await adm.GET(new NextRequest('http://x/api/feedback/admin?status=pending', { headers: auth }))).json()
    expect(list.feedback.map((f: { id: number }) => f.id)).toContain(id)
    expect(list.default_bonus).toBe(FEEDBACK_CONFIG.defaultBonus)
    expect((await adm.POST(post('http://x/api/feedback/admin', { action: 'approve', id, bonus: 99 }, auth))).status).toBe(400)
    expect((await adm.POST(post('http://x/api/feedback/admin', { action: 'approve', id }, auth))).status).toBe(200)
    expect((await adm.POST(post('http://x/api/feedback/admin', { action: 'notes', id, admin_notes: 'dup of #3?' }, auth))).status).toBe(200)
    const after = await (await adm.GET(new NextRequest('http://x/api/feedback/admin?status=approved', { headers: auth }))).json()
    expect(after.feedback.find((f: { id: number }) => f.id === id)).toMatchObject({ status: 'approved', bonus: FEEDBACK_CONFIG.defaultBonus, admin_notes: 'dup of #3?' })
    expect((await adm.POST(post('http://x/api/feedback/admin', { action: 'nope', id }, auth))).status).toBe(400)
  })

  it('multipart upload: images are verified, stripped, private, and deleted with the feedback', async () => {
    const pub = await import('@/app/api/feedback/route')
    const adm = await import('@/app/api/feedback/admin/route')
    const img = await import('@/app/api/feedback/admin/image/route')
    const form = (files: [Uint8Array, string, string][]) => {
      const fd = new FormData()
      for (const [k, v] of Object.entries({ ...ok, account: 'erin' })) fd.append(k, v)
      for (const [b, name, type] of files) fd.append('images', new Blob([Buffer.from(b)], { type }), name)
      return new NextRequest('http://x/api/feedback', { method: 'POST', body: fd, headers: { 'x-forwarded-for': '198.51.100.7' } })
    }
    // Declared image/png but really HTML: refused by magic bytes.
    const fake = await pub.POST(form([[new TextEncoder().encode('<script>alert(1)</script>'), 'x.png', 'image/png']]))
    expect(fake.status).toBe(400)
    const four = Array.from({ length: FEEDBACK_CONFIG.maxImages + 1 }, () => [fx('feedback-exif.jpg'), 'a.jpg', 'image/jpeg'] as [Uint8Array, string, string])
    expect((await pub.POST(form(four))).status).toBe(400)
    const r = await pub.POST(form([[fx('feedback-exif.jpg'), 'a.jpg', 'image/jpeg'], [fx('feedback-text.png'), 'b.png', 'image/png']]))
    expect(r.status).toBe(200)
    const { id } = await r.json()
    const auth = { authorization: `Bearer ${TOKEN}` }
    const list = await (await adm.GET(new NextRequest('http://x/api/feedback/admin', { headers: auth }))).json()
    const row = list.feedback.find((f: { id: number }) => f.id === id)
    expect(row.image_ids).toHaveLength(2)
    const iid = row.image_ids[0]
    expect((await img.GET(new NextRequest(`http://x/api/feedback/admin/image?id=${iid}`))).status).toBe(401)
    const got = await img.GET(new NextRequest(`http://x/api/feedback/admin/image?id=${iid}`, { headers: auth }))
    expect(got.status).toBe(200)
    expect(got.headers.get('content-type')).toBe('image/jpeg')
    expect(got.headers.get('cache-control')).toMatch(/no-store/)
    expect(got.headers.get('x-content-type-options')).toBe('nosniff')
    const bytes = new Uint8Array(await got.arrayBuffer())
    expect(sniffImage(bytes)).toBe('jpeg')
    expect(has(bytes, 'SECRET')).toBe(false)
    expect((await adm.POST(post('http://x/api/feedback/admin', { action: 'delete', id }, auth))).status).toBe(200)
    expect((await img.GET(new NextRequest(`http://x/api/feedback/admin/image?id=${iid}`, { headers: auth }))).status).toBe(404)
  })
})

// ── Screenshots ────────────────────────────────────────────────────────────
const fx = (f: string) => new Uint8Array(readFileSync(`tests/fixtures/${f}`))
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s))
const MB5 = FEEDBACK_CONFIG.imageMaxBytes

describe('feedback images', () => {
  it('sniffs magic bytes, not names or declared types', () => {
    expect(sniffImage(fx('feedback-exif.jpg'))).toBe('jpeg')
    expect(sniffImage(fx('feedback-text.png'))).toBe('png')
    expect(sniffImage(fx('feedback-exif.webp'))).toBe('webp')
    expect(sniffImage(new TextEncoder().encode('GIF89a......'))).toBeNull()
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(cleanImage(new TextEncoder().encode('<html>not an image</html>'), MB5)).toMatch(/PNG, JPEG or WebP/)
  })
  it('strips EXIF, comments and text metadata', () => {
    for (const f of ['feedback-exif.jpg', 'feedback-text.png', 'feedback-exif.webp']) {
      const raw = fx(f)
      expect(has(raw, 'SECRET')).toBe(true)
      const c = cleanImage(raw, MB5)
      if (typeof c === 'string') throw new Error(c)
      expect(has(c.bytes, 'SECRET')).toBe(false)
      expect(sniffImage(c.bytes)).toBe(c.kind)
      expect(c.bytes.length).toBeLessThan(raw.length)
    }
    const w = cleanImage(fx('feedback-exif.webp'), MB5) as { bytes: Uint8Array }
    const riff = Buffer.from(w.bytes)
    expect(riff.readUInt32LE(4)).toBe(riff.length - 8)
  })
  it('rejects oversize, empty and truncated files', () => {
    expect(cleanImage(fx('feedback-exif.jpg'), 100)).toMatch(/under/)
    expect(cleanImage(new Uint8Array(), MB5)).toMatch(/Empty/)
    const png = fx('feedback-text.png')
    expect(cleanImage(png.subarray(0, 40), MB5)).toMatch(/damaged/)
  })
  it('stores images with the feedback and deletes them with it', async () => {
    const s = memoryFeedbackStore()
    const v = validateFeedback(ok) as Exclude<ReturnType<typeof validateFeedback>, string>
    const r = await s.insert(v, null, [{ mime: 'image/jpeg', bytes: fx('feedback-exif.jpg') }, { mime: 'image/png', bytes: fx('feedback-text.png') }])
    if (!r.ok) throw new Error('insert')
    const [row] = await s.list()
    expect(row.image_ids).toHaveLength(2)
    expect((await s.image(row.image_ids[0]))?.feedback_id).toBe(r.id)
    expect((await s.approved())[0]).toBeUndefined()
    await s.remove(r.id)
    for (const iid of row.image_ids) expect(await s.image(iid)).toBeNull()
  })
})
