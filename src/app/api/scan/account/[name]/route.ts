// GET /api/scan/account/:name — one account's testnet activity profile.
import { NextResponse } from 'next/server'
import { accountPayload } from '@/lib/tracker-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params
  try {
    const p = await accountPayload(decodeURIComponent(name))
    if (!p) return NextResponse.json({ error: 'Invalid account name' }, { status: 400 })
    return NextResponse.json(p, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    console.error('[scan/account]', e)
    return NextResponse.json({ error: 'Node unavailable' }, { status: 503 })
  }
}
