import { existsSync } from 'fs'
import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { plAccount, plStatus } from '@/lib/pl-rpc'
import { ctlPay, PL_CTL } from '@/lib/pl-ctl'

const WALLET_API =
  process.env.FALCON_PL_WALLET_API?.trim() || 'http://192.241.247.158:19312'

async function payViaHttp(from: string, to: string, amount: number) {
  const r = await fetch(WALLET_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'pay', from, to, amount }),
  })
  const d = (await r.json()) as { error?: string; raw?: string }
  if (!r.ok) throw new Error(d.error ?? `wallet api ${r.status}`)
  const m = String(d.raw ?? '').match(/tx_id=([0-9a-fA-F]+)/)
  return { txId: m?.[1] ?? '', raw: d.raw ?? '' }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NAME_RE = /^[A-Za-z0-9._-]{2,64}$/
const TEST_HINTS = ['alice', 'bob', 'carol', 'dave'] as const

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

export async function GET(req: NextRequest) {
  const account = (req.nextUrl.searchParams.get('account') ?? '').trim()
  if (account && !NAME_RE.test(account)) {
    return NextResponse.json({ error: 'Invalid PL account name' }, { status: 400 })
  }
  try {
    const [st, acct] = await Promise.all([
      plStatus(false),
      account ? plAccount(account) : Promise.resolve(null),
    ])
    return NextResponse.json({
      online: true,
      product: st.product_version,
      networkId: st.network_id,
      tip: st.tip_height,
      epoch: st.epoch,
      firstClaimEpoch: st.first_claim_epoch,
      testAccounts: TEST_HINTS,
      account: account
        ? {
            name: account,
            exists: Boolean(acct?.exists),
            balance: num(acct?.balance),
            sequence: num(acct?.sequence),
            claimable: num(acct?.claimable),
          }
        : null,
    })
  } catch (e) {
    return NextResponse.json(
      { online: false, error: String(e instanceof Error ? e.message : e), testAccounts: TEST_HINTS },
      { status: 503 },
    )
  }
}

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }
  let body: { action?: string; from?: string; to?: string; amount?: number }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const action = String(body.action ?? 'pay')
  if (action !== 'pay') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
  const from = String(body.from ?? '').trim()
  const to = String(body.to ?? '').trim()
  const amount = Math.floor(Number(body.amount ?? 0))
  if (!NAME_RE.test(from) || !NAME_RE.test(to)) {
    return NextResponse.json({ error: 'from/to must be PL account names' }, { status: 400 })
  }
  if (from === to) {
    return NextResponse.json({ error: 'Destination must differ from sender' }, { status: 400 })
  }
  if (!Number.isFinite(amount) || amount < 1) {
    return NextResponse.json({ error: 'Amount must be at least 1 FPL' }, { status: 400 })
  }
  try {
    const paid = existsSync(PL_CTL)
      ? await ctlPay(from, to, amount)
      : await payViaHttp(from, to, amount)
    const acct = await plAccount(from)
    return NextResponse.json({
      ok: true,
      txId: paid.txId,
      from,
      to,
      amount,
      balance: num(acct.balance),
      sequence: num(acct.sequence),
    })
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e)
    return NextResponse.json({ error: msg }, { status: 503 })
  }
}
