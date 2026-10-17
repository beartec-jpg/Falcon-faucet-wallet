// First 35 applications (Neon). Admin access is via FIRST35_ADMIN_TOKEN (env only).

import { createHash, timingSafeEqual } from 'crypto'
import { getSql, isDbConfigured } from '@/lib/db'
import { FIRST35_SEATS, FIRST35_TIERS } from '@/config/first35'

export type First35Status = 'pending' | 'approved' | 'revoked'
export const FIRST35_STATUSES: First35Status[] = ['pending', 'approved', 'revoked']

export interface First35Application {
  id: number
  account: string
  telegram: string
  discord: string
  x_handle: string
  note: string
  status: First35Status
  seat: number | null
  /** Added by an admin (true) or via the public form (false). */
  manual: boolean
  created_at: string
}

export interface First35Input {
  account: string
  telegram: string
  discord: string
  x_handle: string
  note: string
}

const HANDLE_RE = /^@?[A-Za-z0-9_.#-]{2,40}$/
export const ACCOUNT_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/

/** Validate and normalise an application. Returns an error string or the clean input. */
export function validateApplication(raw: Record<string, unknown>): First35Input | string {
  const t = (k: string) => String(raw[k] ?? '').trim()
  const account = t('account').toLowerCase()
  const telegram = t('telegram').replace(/^@/, '')
  const discord = t('discord').replace(/^@/, '')
  const x_handle = t('x_handle').replace(/^@/, '')
  const note = t('note')
  if (!ACCOUNT_RE.test(account)) return 'Enter your Falcon PL wallet name (lowercase, as shown in your wallet).'
  // At least one of Telegram / Discord / X; any that is given must be valid. Missing ones are stored as ''.
  if (!telegram && !discord && !x_handle) return 'Enter at least one of your Telegram, Discord or X handles.'
  if (telegram && !HANDLE_RE.test(telegram)) return 'That Telegram handle does not look right.'
  if (discord && !HANDLE_RE.test(discord)) return 'That Discord handle does not look right.'
  if (x_handle && !HANDLE_RE.test(x_handle)) return 'That X handle does not look right.'
  if (note.length > 500) return 'Keep the note under 500 characters.'
  return { account, telegram, discord, x_handle, note }
}

/** Test, load-test and protocol accounts cannot apply (same rules as the activity tracker). */
export function isIneligibleAccount(name: string): boolean {
  return (
    ['alice', 'bob', 'carol', 'faucet', 'admission', 'btc-headers', 'treasury', 'community', 'builder', 'genesis', 'root', 'operator', 'admin'].includes(name) ||
    [/^w\d{2,4}$/, /^loadgen/, /-smoke-/, /^(lg|bench|load|stress)[-_.]/, /^watcher-/, /-bond$/, /^v\d+$/].some((re) => re.test(name))
  )
}

/** account_query body for a registered account (exists flag, or any balance / sequence). */
export function accountExists(body: Record<string, unknown>): boolean {
  if (body.exists === false) return false
  if (body.exists === true) return true
  return Number(body.sequence) > 0 || Number(body.balance) > 0
}

export function adminTokenOk(header: string | null): boolean {
  const want = process.env.FIRST35_ADMIN_TOKEN?.trim()
  if (!want || want.length < 16) return false
  const got = (header ?? '').replace(/^Bearer\s+/i, '').trim()
  const a = createHash('sha256').update(got).digest()
  const b = createHash('sha256').update(want).digest()
  return timingSafeEqual(a, b)
}

// ── Admin helpers ──────────────────────────────────────────────────────────

/** Tier amount (FPL) for a seat number, or null when the seat is out of range. */
export function tierForSeat(seat: number | null | undefined): number | null {
  if (!Number.isInteger(seat)) return null
  return FIRST35_TIERS.find((t) => seat! >= t.from && seat! <= t.to)?.fpl ?? null
}

export interface First35AdminInput extends First35Input {
  status: First35Status
  seat: number | null
}

/** Admin add/edit: same field rules as the public form, plus status and an optional seat 1–35. */
export function validateAdminEntry(raw: Record<string, unknown>): First35AdminInput | string {
  const base = validateApplication(raw)
  if (typeof base === 'string') return base
  const status = String(raw.status ?? 'pending') as First35Status
  if (!FIRST35_STATUSES.includes(status)) return 'Status must be pending, approved or revoked.'
  const s = raw.seat === '' || raw.seat === null || raw.seat === undefined ? null : Number(raw.seat)
  if (s !== null && (!Number.isInteger(s) || s < 1 || s > FIRST35_SEATS)) return `Seat must be a whole number from 1 to ${FIRST35_SEATS}.`
  return { ...base, status, seat: status === 'revoked' ? null : s }
}

export interface PublicHolder { seat: number | null; account: string; tier_fpl: number | null }

/** Approved entries only, by seat; exposes nothing but seat, tier and account name. */
export function publicHolders(rows: First35Application[]): PublicHolder[] {
  return rows
    .filter((r) => r.status === 'approved')
    .map((r) => ({ seat: r.seat, account: r.account, tier_fpl: tierForSeat(r.seat) }))
    .sort((a, b) => (a.seat ?? 999) - (b.seat ?? 999) || a.account.localeCompare(b.account))
}

export function csvCell(v: unknown): string {
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}` // no spreadsheet formulas
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function applicationsCsv(rows: (First35Application & { last_active?: string | null })[]): string {
  const head = ['id', 'account', 'status', 'seat', 'tier_fpl', 'telegram', 'discord', 'x', 'note', 'source', 'last_active', 'created_at']
  const lines = rows.map((r) =>
    [r.id, r.account, r.status, r.seat ?? '', tierForSeat(r.seat) ?? '', r.telegram, r.discord, r.x_handle, r.note, r.manual ? 'manual' : 'form', r.last_active ?? '', r.created_at]
      .map(csvCell)
      .join(','),
  )
  return [head.join(','), ...lines].join('\n') + '\n'
}

export type StoreResult = { ok: true; id?: number } | { ok: false; reason: 'duplicate' | 'seat_taken' | 'not_found' }

// ── Store ──────────────────────────────────────────────────────────────────

export interface First35Store {
  insert(x: First35Input, ipHash: string | null): Promise<{ ok: true } | { ok: false; reason: 'duplicate' }>
  adminInsert(x: First35AdminInput): Promise<StoreResult>
  update(id: number, x: First35AdminInput): Promise<StoreResult>
  /** Status change. Revoking frees the seat so it can be reassigned. */
  setStatus(id: number, status: First35Status): Promise<boolean>
  setSeat(id: number, seat: number | null): Promise<StoreResult>
  remove(id: number): Promise<boolean>
  list(): Promise<First35Application[]>
  approvedCount(): Promise<number>
}

export function memoryFirst35Store(): First35Store {
  const rows: First35Application[] = []
  let next = 1
  const seatTaken = (seat: number | null, id?: number) => seat !== null && rows.some((r) => r.seat === seat && r.id !== id)
  return {
    async insert(x) {
      if (rows.some((r) => r.account === x.account)) return { ok: false, reason: 'duplicate' }
      rows.push({ ...x, id: next++, status: 'pending', seat: null, manual: false, created_at: new Date().toISOString() })
      return { ok: true }
    },
    async adminInsert(x) {
      if (rows.some((r) => r.account === x.account)) return { ok: false, reason: 'duplicate' }
      if (seatTaken(x.seat)) return { ok: false, reason: 'seat_taken' }
      const id = next++
      rows.push({ ...x, id, manual: true, created_at: new Date().toISOString() })
      return { ok: true, id }
    },
    async update(id, x) {
      const r = rows.find((y) => y.id === id)
      if (!r) return { ok: false, reason: 'not_found' }
      if (rows.some((y) => y.account === x.account && y.id !== id)) return { ok: false, reason: 'duplicate' }
      if (seatTaken(x.seat, id)) return { ok: false, reason: 'seat_taken' }
      Object.assign(r, x)
      return { ok: true }
    },
    async setStatus(id, status) {
      const r = rows.find((x) => x.id === id)
      if (!r) return false
      r.status = status
      if (status === 'revoked') r.seat = null
      return true
    },
    async setSeat(id, seat) {
      const r = rows.find((x) => x.id === id)
      if (!r) return { ok: false, reason: 'not_found' }
      if (seatTaken(seat, id)) return { ok: false, reason: 'seat_taken' }
      r.seat = seat
      return { ok: true }
    },
    async remove(id) {
      const i = rows.findIndex((x) => x.id === id)
      if (i < 0) return false
      rows.splice(i, 1)
      return true
    },
    async list() {
      return rows.map((r) => ({ ...r }))
    },
    async approvedCount() {
      return rows.filter((r) => r.status === 'approved').length
    },
  }
}

let ready = false
async function ensure() {
  if (ready) return
  const sql = getSql()
  await sql`CREATE TABLE IF NOT EXISTS first35_applications (
    id BIGSERIAL PRIMARY KEY, account TEXT NOT NULL UNIQUE, telegram TEXT NOT NULL, discord TEXT NOT NULL,
    x_handle TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', ip_hash TEXT, status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  await sql`ALTER TABLE first35_applications ADD COLUMN IF NOT EXISTS seat INT`
  await sql`ALTER TABLE first35_applications ADD COLUMN IF NOT EXISTS manual BOOLEAN NOT NULL DEFAULT FALSE`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS first35_applications_seat_uq ON first35_applications (seat) WHERE seat IS NOT NULL`
  await sql`UPDATE first35_applications SET status = 'revoked', seat = NULL WHERE status = 'rejected'`
  ready = true
}

function pgErr(e: unknown): StoreResult {
  const m = String((e as { message?: string })?.message ?? e)
  if (/seat_uq/.test(m)) return { ok: false, reason: 'seat_taken' }
  if (/duplicate key|unique/i.test(m)) return { ok: false, reason: 'duplicate' }
  throw e
}

export function pgFirst35Store(): First35Store {
  const sql = getSql()
  return {
    async insert(x, ipHash) {
      await ensure()
      const r = (await sql`INSERT INTO first35_applications (account, telegram, discord, x_handle, note, ip_hash)
        VALUES (${x.account}, ${x.telegram}, ${x.discord}, ${x.x_handle}, ${x.note}, ${ipHash})
        ON CONFLICT (account) DO NOTHING RETURNING id`) as unknown[]
      return r.length ? { ok: true } : { ok: false, reason: 'duplicate' }
    },
    async adminInsert(x) {
      await ensure()
      try {
        const r = (await sql`INSERT INTO first35_applications (account, telegram, discord, x_handle, note, status, seat, manual)
          VALUES (${x.account}, ${x.telegram}, ${x.discord}, ${x.x_handle}, ${x.note}, ${x.status}, ${x.seat}, TRUE) RETURNING id`) as { id: number }[]
        return { ok: true, id: Number(r[0].id) }
      } catch (e) {
        return pgErr(e)
      }
    },
    async update(id, x) {
      await ensure()
      try {
        const r = (await sql`UPDATE first35_applications SET account = ${x.account}, telegram = ${x.telegram}, discord = ${x.discord},
          x_handle = ${x.x_handle}, note = ${x.note}, status = ${x.status}, seat = ${x.seat}, updated_at = NOW()
          WHERE id = ${id} RETURNING id`) as unknown[]
        return r.length ? { ok: true } : { ok: false, reason: 'not_found' }
      } catch (e) {
        return pgErr(e)
      }
    },
    async setStatus(id, status) {
      await ensure()
      const r = (await sql`UPDATE first35_applications SET status = ${status},
        seat = CASE WHEN ${status} = 'revoked' THEN NULL ELSE seat END, updated_at = NOW() WHERE id = ${id} RETURNING id`) as unknown[]
      return r.length > 0
    },
    async setSeat(id, seat) {
      await ensure()
      try {
        const r = (await sql`UPDATE first35_applications SET seat = ${seat}, updated_at = NOW() WHERE id = ${id} RETURNING id`) as unknown[]
        return r.length ? { ok: true } : { ok: false, reason: 'not_found' }
      } catch (e) {
        return pgErr(e)
      }
    },
    async remove(id) {
      await ensure()
      const r = (await sql`DELETE FROM first35_applications WHERE id = ${id} RETURNING id`) as unknown[]
      return r.length > 0
    },
    async list() {
      await ensure()
      const rows = (await sql`SELECT id, account, telegram, discord, x_handle, note, status, seat, manual, created_at::text AS created_at
        FROM first35_applications ORDER BY seat NULLS LAST, created_at`) as Record<string, unknown>[]
      return rows.map((r) => ({
        id: Number(r.id), account: String(r.account), telegram: String(r.telegram), discord: String(r.discord),
        x_handle: String(r.x_handle), note: String(r.note), status: String(r.status) as First35Status,
        seat: r.seat === null || r.seat === undefined ? null : Number(r.seat), manual: Boolean(r.manual), created_at: String(r.created_at),
      }))
    },
    async approvedCount() {
      await ensure()
      const r = (await sql`SELECT count(*)::int AS n FROM first35_applications WHERE status = 'approved'`) as { n: number }[]
      return Number(r[0]?.n ?? 0)
    },
  }
}

let store: First35Store | null = null
export function first35Store(): First35Store {
  if (!store) store = isDbConfigured() ? pgFirst35Store() : memoryFirst35Store()
  return store
}
