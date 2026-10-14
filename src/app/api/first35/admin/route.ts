// GET/POST /api/first35/admin — admin list and approve/reject. Authorization: Bearer $FIRST35_ADMIN_TOKEN (env only).
import { NextRequest, NextResponse } from 'next/server'
import { adminTokenOk, first35Store, type First35Status } from '@/lib/first35-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const deny = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

export async function GET(req: NextRequest) {
  if (!adminTokenOk(req.headers.get('authorization'))) return deny()
  return NextResponse.json({ applications: await first35Store().list() }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  if (!adminTokenOk(req.headers.get('authorization'))) return deny()
  const b = (await req.json().catch(() => ({}))) as { id?: number; status?: string }
  const status = b.status as First35Status
  if (!Number.isInteger(b.id) || !['pending', 'approved', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  return NextResponse.json({ ok: await first35Store().setStatus(b.id!, status) })
}
