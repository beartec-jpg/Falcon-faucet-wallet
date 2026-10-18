// GET /api/feedback/admin/image?id=N — one feedback screenshot. Admin only
// (Authorization: Bearer $FIRST35_ADMIN_TOKEN). The admin UI fetches it as a blob; there is no public URL.
import { NextRequest, NextResponse } from 'next/server'
import { adminTokenOk } from '@/lib/first35-store'
import { feedbackStore } from '@/lib/feedback-store'
import { sniffImage, IMAGE_MIME } from '@/lib/feedback-image'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const h = { 'cache-control': 'no-store, private' }
  if (!adminTokenOk(req.headers.get('authorization'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: h })
  const id = Number(req.nextUrl.searchParams.get('id'))
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: h })
  const im = await feedbackStore().image(id)
  const kind = im && sniffImage(im.bytes)
  if (!im || !kind) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: h })
  return new NextResponse(Buffer.from(im.bytes), {
    headers: {
      ...h,
      'content-type': IMAGE_MIME[kind],
      'content-length': String(im.bytes.length),
      'x-content-type-options': 'nosniff',
      'content-disposition': `inline; filename="feedback-${im.feedback_id}-${id}.${kind === 'jpeg' ? 'jpg' : kind}"`,
      'content-security-policy': "default-src 'none'; sandbox",
    },
  })
}
