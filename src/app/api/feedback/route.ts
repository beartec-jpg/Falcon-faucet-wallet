// POST /api/feedback — public testnet feedback. The account must exist on testnet; test
// accounts are refused; rate-limited per hashed IP and per account (24 h, stored in Postgres).
// Accepts JSON (no images) or multipart/form-data with up to FEEDBACK_CONFIG.maxImages files in "images".
// Images are sniffed by magic bytes, metadata-stripped and stored privately (admin route only).
import { NextRequest, NextResponse } from 'next/server'
import { accountExists } from '@/lib/first35-store'
import { feedbackStore, isFeedbackIneligible, validateFeedback, type FeedbackImageInput } from '@/lib/feedback-store'
import { cleanImage, IMAGE_MIME } from '@/lib/feedback-image'
import { FEEDBACK_CONFIG } from '@/config/feedback'
import { hashIp } from '@/lib/faucet-quota'
import { isOriginAllowed } from '@/lib/origin'
import { plAccount } from '@/lib/pl-rpc'
import { clientIp } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_JSON = 8_000

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  let body: Record<string, unknown>
  let files: File[] = []
  const declared = Number(req.headers.get('content-length') ?? 0)
  const multipart = (req.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')
  if (declared > (multipart ? FEEDBACK_CONFIG.requestMaxBytes : MAX_JSON)) return NextResponse.json({ error: 'Submission too large.' }, { status: 413 })
  try {
    if (multipart) {
      const fd = await req.formData()
      body = {}
      for (const [k, val] of fd.entries()) {
        if (typeof val === 'string') body[k] = k === 'dry_run' ? val === 'true' : val
        else if (k === 'images') files.push(val)
      }
    } else {
      const text = await req.text()
      if (text.length > MAX_JSON) return NextResponse.json({ error: 'Submission too long.' }, { status: 413 })
      body = JSON.parse(text)
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  files = files.filter((f) => f.size > 0)
  if (files.length > FEEDBACK_CONFIG.maxImages) return NextResponse.json({ error: `Attach at most ${FEEDBACK_CONFIG.maxImages} screenshots.` }, { status: 400 })
  if (files.reduce((t, f) => t + f.size, 0) > FEEDBACK_CONFIG.requestMaxBytes) return NextResponse.json({ error: 'Screenshots are too large in total.' }, { status: 413 })
  const images: FeedbackImageInput[] = []
  for (const f of files) {
    const c = cleanImage(new Uint8Array(await f.arrayBuffer()), FEEDBACK_CONFIG.imageMaxBytes)
    if (typeof c === 'string') return NextResponse.json({ error: c }, { status: 400 })
    images.push({ mime: IMAGE_MIME[c.kind], bytes: c.bytes })
  }
  const v = validateFeedback(body)
  if (typeof v === 'string') return NextResponse.json({ error: v }, { status: 400 })
  if (isFeedbackIneligible(v.account)) return NextResponse.json({ error: 'Test and protocol accounts cannot submit feedback. Use your own testnet account.' }, { status: 400 })
  try {
    if (!accountExists(await plAccount(v.account))) return NextResponse.json({ error: 'No Falcon PL testnet account with that name. Create one in the wallet first.' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'Cannot reach the testnet right now. Try again shortly.' }, { status: 503 })
  }
  if (body.dry_run === true) return NextResponse.json({ ok: true, dry_run: true })
  try {
    const r = await feedbackStore().insert(v, await hashIp(clientIp(req)), images)
    if (!r.ok) {
      return NextResponse.json(
        { error: `Limit reached (${r.reason === 'rate_ip' ? FEEDBACK_CONFIG.perIpPerDay : FEEDBACK_CONFIG.perAccountPerDay} per day). Try again tomorrow.` },
        { status: 429 },
      )
    }
    return NextResponse.json({ ok: true, id: r.id })
  } catch (e) {
    console.error('[feedback]', e)
    // Surface the Postgres SQLSTATE (no message/SQL) so users can quote it in a bug report.
    const code = typeof (e as { code?: unknown })?.code === 'string' ? String((e as { code: string }).code).slice(0, 8) : 'unknown'
    return NextResponse.json({ error: `Could not save your feedback (server error ${code}). Try again shortly.`, code }, { status: 503 })
  }
}
