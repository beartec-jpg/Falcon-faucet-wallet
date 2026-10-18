// POST /api/feedback — public testnet feedback. The account must exist on testnet; test
// accounts are refused; rate-limited per hashed IP and per account (24 h, stored in Postgres).
import { NextRequest, NextResponse } from 'next/server'
import { accountExists } from '@/lib/first35-store'
import { feedbackStore, isFeedbackIneligible, validateFeedback } from '@/lib/feedback-store'
import { FEEDBACK_CONFIG } from '@/config/feedback'
import { hashIp } from '@/lib/faucet-quota'
import { isOriginAllowed } from '@/lib/origin'
import { plAccount } from '@/lib/pl-rpc'
import { clientIp } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY = 8_000

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  let body: Record<string, unknown>
  try {
    const text = await req.text()
    if (text.length > MAX_BODY) return NextResponse.json({ error: 'Submission too long.' }, { status: 413 })
    body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
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
    const r = await feedbackStore().insert(v, await hashIp(clientIp(req)))
    if (!r.ok) {
      return NextResponse.json(
        { error: `Limit reached (${r.reason === 'rate_ip' ? FEEDBACK_CONFIG.perIpPerDay : FEEDBACK_CONFIG.perAccountPerDay} per day). Try again tomorrow.` },
        { status: 429 },
      )
    }
    return NextResponse.json({ ok: true, id: r.id })
  } catch (e) {
    console.error('[feedback]', e)
    return NextResponse.json({ error: 'Could not save your feedback. Try again shortly.' }, { status: 503 })
  }
}
