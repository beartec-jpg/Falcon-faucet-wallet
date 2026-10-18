// GET/POST /api/feedback/admin — feedback review. Authorization: Bearer $FIRST35_ADMIN_TOKEN (same as First 35).
// GET ?status=pending|approved|rejected → { feedback, counts, default_bonus, max_bonus }
// POST {action: 'approve', id, bonus?} | {action: 'reject', id} | {action: 'pending', id} | {action: 'notes', id, admin_notes} | {action: 'bonus', id, bonus} | {action: 'delete', id}
import { NextRequest, NextResponse } from 'next/server'
import { adminTokenOk } from '@/lib/first35-store'
import { FEEDBACK_STATUSES, feedbackStore, parseBonus, type FeedbackStatus } from '@/lib/feedback-store'
import { FEEDBACK_CONFIG } from '@/config/feedback'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' }
const deny = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: NO_STORE })
const ok = () => NextResponse.json({ ok: true }, { headers: NO_STORE })

export async function GET(req: NextRequest) {
  if (!adminTokenOk(req.headers.get('authorization'))) return deny()
  const all = await feedbackStore().list()
  const counts = { all: all.length, pending: 0, approved: 0, rejected: 0 }
  for (const r of all) counts[r.status]++
  const st = req.nextUrl.searchParams.get('status') as FeedbackStatus | null
  const feedback = st && FEEDBACK_STATUSES.includes(st) ? all.filter((r) => r.status === st) : all
  return NextResponse.json({ feedback, counts, default_bonus: FEEDBACK_CONFIG.defaultBonus, max_bonus: FEEDBACK_CONFIG.maxBonus }, { headers: NO_STORE })
}

export async function POST(req: NextRequest) {
  if (!adminTokenOk(req.headers.get('authorization'))) return deny()
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const id = Number(b.id)
  if (!Number.isInteger(id)) return bad('Invalid request')
  const store = feedbackStore()
  const done = (found: boolean) => (found ? ok() : bad('Feedback not found.', 404))
  try {
    switch (String(b.action ?? '')) {
      case 'approve': {
        const bonus = parseBonus(b.bonus)
        if (typeof bonus === 'string') return bad(bonus)
        return done(await store.review(id, { status: 'approved', bonus }))
      }
      case 'bonus': {
        const bonus = parseBonus(b.bonus)
        if (typeof bonus === 'string') return bad(bonus)
        return done(await store.review(id, { bonus }))
      }
      case 'reject':
        return done(await store.review(id, { status: 'rejected' }))
      case 'pending':
        return done(await store.review(id, { status: 'pending' }))
      case 'notes': {
        const notes = String(b.admin_notes ?? '').trim()
        if (notes.length > FEEDBACK_CONFIG.adminNotesMax) return bad(`Keep notes under ${FEEDBACK_CONFIG.adminNotesMax} characters.`)
        return done(await store.review(id, { admin_notes: notes }))
      }
      case 'delete':
        return done(await store.remove(id))
      default:
        return bad('Unknown action')
    }
  } catch (e) {
    console.error('[feedback/admin]', e)
    return bad('Could not save. Try again shortly.', 503)
  }
}
