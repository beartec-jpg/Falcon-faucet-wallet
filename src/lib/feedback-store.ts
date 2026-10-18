// Testnet feedback (Neon). Public submit; admin review via FIRST35_ADMIN_TOKEN (same as First 35).
// Approved items carry a bonus that the activity tracker adds as the "feedback" category.

import { getSql, isDbConfigured } from '@/lib/db'
import { FEEDBACK_CONFIG as F, type FeedbackCategory } from '@/config/feedback'
import { ACCOUNT_RE } from '@/lib/first35-store'
import { TRACKER_CONFIG } from '@/config/tracker'

export type FeedbackStatus = 'pending' | 'approved' | 'rejected'
export const FEEDBACK_STATUSES: FeedbackStatus[] = ['pending', 'approved', 'rejected']

export interface FeedbackInput {
  account: string
  category: FeedbackCategory
  area: string
  description: string
  screenshot_url: string
  contact: string
}

export interface Feedback extends FeedbackInput {
  id: number
  status: FeedbackStatus
  bonus: number
  admin_notes: string
  created_at: string
  reviewed_at: string | null
}

/** Public, approved-only view used by the tracker and the scorecard (no description or contact). */
export interface ApprovedFeedback {
  id: number
  account: string
  category: FeedbackCategory
  area: string
  bonus: number
  day: string
}

const CONTACT_RE = /^@?[A-Za-z0-9_.#-]{2,64}$/

/** Test accounts (alice/bob/carol) and the same protocol/load-test names First 35 refuses. */
export function isFeedbackIneligible(name: string): boolean {
  return TRACKER_CONFIG.testAccounts.includes(name) || TRACKER_CONFIG.systemAccounts.includes(name) ||
    [...TRACKER_CONFIG.systemPatterns, ...TRACKER_CONFIG.harnessPatterns].some((re) => re.test(name))
}

/** Validate and normalise a public submission. Returns an error string or the clean input. */
export function validateFeedback(raw: Record<string, unknown>): FeedbackInput | string {
  const t = (k: string) => String(raw[k] ?? '').trim()
  const account = t('account').toLowerCase()
  const category = t('category').toLowerCase() as FeedbackCategory
  const area = t('area').replace(/\s+/g, ' ')
  const description = t('description').replace(/\r\n/g, '\n')
  const screenshot_url = t('screenshot_url')
  const contact = t('contact')
  if (!ACCOUNT_RE.test(account)) return 'Enter your Falcon PL testnet account name (lowercase, as shown in your wallet).'
  if (!F.categories.includes(category)) return `Category must be one of: ${F.categories.join(', ')}.`
  if (!area) return 'Say which page or area this is about.'
  if (area.length > F.areaMax) return `Keep the page/area under ${F.areaMax} characters.`
  if (description.length < F.descriptionMin) return `Describe it in at least ${F.descriptionMin} characters.`
  if (description.length > F.descriptionMax) return `Keep the description under ${F.descriptionMax} characters.`
  if (screenshot_url) {
    if (screenshot_url.length > F.screenshotMax) return 'That screenshot link is too long.'
    let u: URL
    try {
      u = new URL(screenshot_url)
    } catch {
      return 'The screenshot link must be a full https:// URL.'
    }
    if (u.protocol !== 'https:') return 'The screenshot link must be a full https:// URL.'
  }
  if (contact && (contact.length > F.contactMax || !CONTACT_RE.test(contact))) return 'That contact handle does not look right (letters, numbers, _ . # -).'
  return { account, category, area, description, screenshot_url, contact }
}

/** Bonus for approval: default when blank, else 0–maxBonus rounded to 0.5. */
export function parseBonus(v: unknown): number | string {
  if (v === undefined || v === null || v === '') return F.defaultBonus
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > F.maxBonus) return `Bonus must be between 0 and ${F.maxBonus}.`
  return Math.round(n * 2) / 2
}

export function toApproved(rows: Feedback[]): ApprovedFeedback[] {
  return rows
    .filter((r) => r.status === 'approved')
    .map((r) => ({ id: r.id, account: r.account, category: r.category, area: r.area, bonus: r.bonus, day: (r.reviewed_at ?? r.created_at).slice(0, 10) }))
}

export type InsertResult = { ok: true; id: number } | { ok: false; reason: 'rate_ip' | 'rate_account' }
export type ReviewPatch = { status?: FeedbackStatus; bonus?: number; admin_notes?: string }

export interface FeedbackStore {
  /** Inserts unless the IP hash or account is over the 24 h limit. */
  insert(x: FeedbackInput, ipHash: string | null): Promise<InsertResult>
  review(id: number, patch: ReviewPatch): Promise<boolean>
  remove(id: number): Promise<boolean>
  list(status?: FeedbackStatus): Promise<Feedback[]>
  approved(): Promise<ApprovedFeedback[]>
}

export function memoryFeedbackStore(now = () => Date.now()): FeedbackStore {
  const rows: (Feedback & { ip_hash: string | null; at: number })[] = []
  let next = 1
  const strip = ({ ip_hash: _i, at: _a, ...r }: Feedback & { ip_hash: string | null; at: number }): Feedback => r
  return {
    async insert(x, ipHash) {
      const since = now() - 86_400_000
      if (ipHash && rows.filter((r) => r.ip_hash === ipHash && r.at > since).length >= F.perIpPerDay) return { ok: false, reason: 'rate_ip' }
      if (rows.filter((r) => r.account === x.account && r.at > since).length >= F.perAccountPerDay) return { ok: false, reason: 'rate_account' }
      const id = next++
      rows.push({ ...x, id, status: 'pending', bonus: 0, admin_notes: '', created_at: new Date(now()).toISOString(), reviewed_at: null, ip_hash: ipHash, at: now() })
      return { ok: true, id }
    },
    async review(id, p) {
      const r = rows.find((x) => x.id === id)
      if (!r) return false
      if (p.status) {
        r.status = p.status
        r.reviewed_at = p.status === 'pending' ? null : new Date(now()).toISOString()
        if (p.status !== 'approved') r.bonus = 0
      }
      if (p.bonus !== undefined && r.status === 'approved') r.bonus = p.bonus
      if (p.admin_notes !== undefined) r.admin_notes = p.admin_notes
      return true
    },
    async remove(id) {
      const i = rows.findIndex((x) => x.id === id)
      if (i < 0) return false
      rows.splice(i, 1)
      return true
    },
    async list(status) {
      return rows.filter((r) => !status || r.status === status).map(strip).reverse()
    },
    async approved() {
      return toApproved(rows.map(strip))
    },
  }
}

let ready = false
async function ensure() {
  if (ready) return
  const sql = getSql()
  await sql`CREATE TABLE IF NOT EXISTS testnet_feedback (
    id BIGSERIAL PRIMARY KEY, account TEXT NOT NULL, category TEXT NOT NULL, area TEXT NOT NULL,
    description TEXT NOT NULL, screenshot_url TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '',
    ip_hash TEXT, status TEXT NOT NULL DEFAULT 'pending', bonus NUMERIC(6,1) NOT NULL DEFAULT 0,
    admin_notes TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ)`
  await sql`CREATE INDEX IF NOT EXISTS testnet_feedback_status_idx ON testnet_feedback (status, created_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS testnet_feedback_ip_idx ON testnet_feedback (ip_hash, created_at)`
  await sql`CREATE INDEX IF NOT EXISTS testnet_feedback_account_idx ON testnet_feedback (account, created_at)`
  ready = true
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v))
function rowOf(r: Record<string, unknown>): Feedback {
  return {
    id: Number(r.id), account: String(r.account), category: String(r.category) as FeedbackCategory, area: String(r.area),
    description: String(r.description), screenshot_url: String(r.screenshot_url ?? ''), contact: String(r.contact ?? ''),
    status: String(r.status) as FeedbackStatus, bonus: Number(r.bonus) || 0, admin_notes: String(r.admin_notes ?? ''),
    created_at: iso(r.created_at), reviewed_at: r.reviewed_at == null ? null : iso(r.reviewed_at),
  }
}

export function pgFeedbackStore(): FeedbackStore {
  const sql = getSql()
  return {
    async insert(x, ipHash) {
      await ensure()
      const [c] = (await sql`SELECT
          (SELECT count(*)::int FROM testnet_feedback WHERE ip_hash = ${ipHash} AND created_at > NOW() - INTERVAL '24 hours') AS ip,
          (SELECT count(*)::int FROM testnet_feedback WHERE account = ${x.account} AND created_at > NOW() - INTERVAL '24 hours') AS acct`) as { ip: number; acct: number }[]
      if (ipHash && Number(c?.ip) >= F.perIpPerDay) return { ok: false, reason: 'rate_ip' }
      if (Number(c?.acct) >= F.perAccountPerDay) return { ok: false, reason: 'rate_account' }
      const r = (await sql`INSERT INTO testnet_feedback (account, category, area, description, screenshot_url, contact, ip_hash)
        VALUES (${x.account}, ${x.category}, ${x.area}, ${x.description}, ${x.screenshot_url}, ${x.contact}, ${ipHash}) RETURNING id`) as { id: number }[]
      return { ok: true, id: Number(r[0].id) }
    },
    async review(id, p) {
      await ensure()
      const cur = (await sql`SELECT status, bonus, admin_notes FROM testnet_feedback WHERE id = ${id}`) as Record<string, unknown>[]
      if (!cur.length) return false
      const status = p.status ?? (String(cur[0].status) as FeedbackStatus)
      const bonus = status === 'approved' ? p.bonus ?? Number(cur[0].bonus) : 0
      const notes = p.admin_notes ?? String(cur[0].admin_notes)
      await sql`UPDATE testnet_feedback SET status = ${status}, bonus = ${bonus}, admin_notes = ${notes},
        reviewed_at = CASE WHEN ${status} = 'pending' THEN NULL WHEN ${p.status ?? null}::text IS NOT NULL THEN NOW() ELSE reviewed_at END
        WHERE id = ${id}`
      return true
    },
    async remove(id) {
      await ensure()
      const r = (await sql`DELETE FROM testnet_feedback WHERE id = ${id} RETURNING id`) as unknown[]
      return r.length > 0
    },
    async list(status) {
      await ensure()
      const rows = (status
        ? await sql`SELECT * FROM testnet_feedback WHERE status = ${status} ORDER BY created_at DESC LIMIT 1000`
        : await sql`SELECT * FROM testnet_feedback ORDER BY created_at DESC LIMIT 1000`) as Record<string, unknown>[]
      return rows.map(rowOf)
    },
    async approved() {
      await ensure()
      const rows = (await sql`SELECT * FROM testnet_feedback WHERE status = 'approved' ORDER BY reviewed_at`) as Record<string, unknown>[]
      return toApproved(rows.map(rowOf))
    },
  }
}

let store: FeedbackStore | null = null
export function feedbackStore(): FeedbackStore {
  if (!store) store = isDbConfigured() ? pgFeedbackStore() : memoryFeedbackStore()
  return store
}
