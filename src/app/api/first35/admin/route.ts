// GET/POST /api/first35/admin — First 35 admin. Authorization: Bearer $FIRST35_ADMIN_TOKEN (env only; never in the URL).
// GET            → { applications } with tier + last active day (from the activity tracker). ?format=csv for a CSV file.
// POST {action}  → add | update | status | seat | delete
import { NextRequest, NextResponse } from 'next/server'
import {
  accountExists, adminTokenOk, applicationsCsv, first35Store, FIRST35_STATUSES, isIneligibleAccount, tierForSeat,
  validateAdminEntry, type First35Status, type StoreResult,
} from '@/lib/first35-store'
import { FIRST35_SEATS } from '@/config/first35'
import { plAccount } from '@/lib/pl-rpc'
import { trackerData } from '@/lib/tracker-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' }
const deny = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: NO_STORE })

/** Last active day per account (activity index + faucet claims). Empty when the tracker is unavailable. */
async function lastActive(): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  try {
    const { inp } = await trackerData()
    for (const d of [...inp.days, ...inp.faucet]) if (d.day > (m.get(d.account) ?? '')) m.set(d.account, d.day)
  } catch (e) {
    console.error('[first35/admin] tracker', e)
  }
  return m
}

/** Warning (not a block) when the account is not a registered testnet account or is a test/protocol account. */
async function accountWarning(account: string): Promise<string | null> {
  if (isIneligibleAccount(account)) return 'This is a test or protocol account; it would not pass the public form.'
  try {
    return accountExists(await plAccount(account)) ? null : 'No testnet account with this name yet. Saved anyway; check before paying.'
  } catch {
    return 'Could not reach the testnet to validate this account. Saved anyway.'
  }
}

function failed(r: StoreResult) {
  if (r.ok) return null
  if (r.reason === 'duplicate') return bad('That account already has an entry.', 409)
  if (r.reason === 'seat_taken') return bad('That seat is already assigned. Revoke or move the current holder first.', 409)
  return bad('Entry not found.', 404)
}

export async function GET(req: NextRequest) {
  if (!adminTokenOk(req.headers.get('authorization'))) return deny()
  const [rows, active] = await Promise.all([first35Store().list(), lastActive()])
  const applications = rows.map((r) => ({ ...r, tier_fpl: tierForSeat(r.seat), last_active: active.get(r.account) ?? null }))
  if (req.nextUrl.searchParams.get('format') === 'csv') {
    return new NextResponse(applicationsCsv(applications), {
      headers: { ...NO_STORE, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="first35.csv"' },
    })
  }
  return NextResponse.json({ applications, seats: FIRST35_SEATS }, { headers: NO_STORE })
}

export async function POST(req: NextRequest) {
  if (!adminTokenOk(req.headers.get('authorization'))) return deny()
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const store = first35Store()
  const id = Number(b.id)
  const action = String(b.action ?? (b.status ? 'status' : ''))
  try {
    if (action === 'add' || action === 'update') {
      const v = validateAdminEntry(b)
      if (typeof v === 'string') return bad(v)
      if (action === 'update' && !Number.isInteger(id)) return bad('Invalid request')
      const r = action === 'add' ? await store.adminInsert(v) : await store.update(id, v)
      return failed(r) ?? NextResponse.json({ ok: true, id: r.ok ? r.id ?? id : undefined, warning: await accountWarning(v.account) }, { headers: NO_STORE })
    }
    if (!Number.isInteger(id)) return bad('Invalid request')
    if (action === 'status') {
      const status = String(b.status) as First35Status
      if (!FIRST35_STATUSES.includes(status)) return bad('Invalid status')
      return (await store.setStatus(id, status)) ? NextResponse.json({ ok: true }) : bad('Entry not found.', 404)
    }
    if (action === 'seat') {
      const seat = b.seat === null || b.seat === '' ? null : Number(b.seat)
      if (seat !== null && (!Number.isInteger(seat) || seat < 1 || seat > FIRST35_SEATS)) return bad(`Seat must be 1–${FIRST35_SEATS}.`)
      return failed(await store.setSeat(id, seat)) ?? NextResponse.json({ ok: true })
    }
    if (action === 'delete') return (await store.remove(id)) ? NextResponse.json({ ok: true }) : bad('Entry not found.', 404)
    return bad('Unknown action')
  } catch (e) {
    console.error('[first35/admin]', e)
    return bad('Could not save. Try again shortly.', 503)
  }
}
