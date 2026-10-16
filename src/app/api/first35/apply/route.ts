// POST /api/first35/apply — First 35 application. Requires a registered testnet account.
import { NextRequest, NextResponse } from 'next/server'
import { accountExists, first35Store, isIneligibleAccount, validateApplication } from '@/lib/first35-store'
import { hashIp } from '@/lib/faucet-quota'
import { isOriginAllowed } from '@/lib/origin'
import { plAccount } from '@/lib/pl-rpc'
import { clientIp } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const v = validateApplication(body)
  if (typeof v === 'string') return NextResponse.json({ error: v }, { status: 400 })
  if (isIneligibleAccount(v.account)) {
    return NextResponse.json({ error: 'That account cannot apply.' }, { status: 400 })
  }
  try {
    if (!accountExists(await plAccount(v.account))) return NextResponse.json({ error: 'No Falcon PL wallet with that name. Create one in the wallet first.' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'Cannot reach the testnet right now. Try again shortly.' }, { status: 503 })
  }
  // dry_run: validate everything (incl. on-chain lookup) without saving. Used for checks.
  if (body.dry_run === true) return NextResponse.json({ ok: true, dry_run: true })
  try {
    const r = await first35Store().insert(v, await hashIp(clientIp(req)))
    if (!r.ok) return NextResponse.json({ error: 'This account has already applied.' }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[first35/apply]', e)
    return NextResponse.json({ error: 'Could not save your application. Try again shortly.' }, { status: 503 })
  }
}
