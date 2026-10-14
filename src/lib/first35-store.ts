// First 35 applications (Neon). Admin access is via FIRST35_ADMIN_TOKEN (env only).

import { createHash, timingSafeEqual } from 'crypto'
import { getSql, isDbConfigured } from '@/lib/db'

export type First35Status = 'pending' | 'approved' | 'rejected'

export interface First35Application {
  id: number
  account: string
  telegram: string
  discord: string
  x_handle: string
  note: string
  status: First35Status
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
  if (!ACCOUNT_RE.test(account)) return 'Enter your testnet account name (lowercase, as shown in your wallet).'
  if (!HANDLE_RE.test(telegram)) return 'Enter your Telegram handle.'
  if (!HANDLE_RE.test(discord)) return 'Enter your Discord handle.'
  if (!HANDLE_RE.test(x_handle)) return 'Enter your X handle.'
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

// ── Store ──────────────────────────────────────────────────────────────────

export interface First35Store {
  insert(x: First35Input, ipHash: string | null): Promise<{ ok: true } | { ok: false; reason: 'duplicate' }>
  list(): Promise<First35Application[]>
  setStatus(id: number, status: First35Status): Promise<boolean>
  approvedCount(): Promise<number>
}

export function memoryFirst35Store(): First35Store {
  const rows: First35Application[] = []
  return {
    async insert(x) {
      if (rows.some((r) => r.account === x.account)) return { ok: false, reason: 'duplicate' }
      rows.push({ ...x, id: rows.length + 1, status: 'pending', created_at: new Date().toISOString() })
      return { ok: true }
    },
    async list() {
      return [...rows]
    },
    async setStatus(id, status) {
      const r = rows.find((x) => x.id === id)
      if (!r) return false
      r.status = status
      return true
    },
    async approvedCount() {
      return rows.filter((r) => r.status === 'approved').length
    },
  }
}

let ready = false
async function ensure() {
  if (ready) return
  await getSql()`CREATE TABLE IF NOT EXISTS first35_applications (
    id BIGSERIAL PRIMARY KEY, account TEXT NOT NULL UNIQUE, telegram TEXT NOT NULL, discord TEXT NOT NULL,
    x_handle TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', ip_hash TEXT, status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  ready = true
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
    async list() {
      await ensure()
      const rows = (await sql`SELECT id, account, telegram, discord, x_handle, note, status, created_at::text AS created_at
        FROM first35_applications ORDER BY created_at`) as Record<string, unknown>[]
      return rows.map((r) => ({
        id: Number(r.id), account: String(r.account), telegram: String(r.telegram), discord: String(r.discord),
        x_handle: String(r.x_handle), note: String(r.note), status: String(r.status) as First35Status, created_at: String(r.created_at),
      }))
    },
    async setStatus(id, status) {
      await ensure()
      const r = (await sql`UPDATE first35_applications SET status = ${status}, updated_at = NOW() WHERE id = ${id} RETURNING id`) as unknown[]
      return r.length > 0
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
