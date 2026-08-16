import { NextResponse } from 'next/server'
import { plRpc } from '@/lib/pl-rpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ADDR = process.env.FALCON_PL_PUBLIC_RPC?.trim() || '127.0.0.1:19301'

export async function GET() {
  try {
    const r = await plRpc(
      { type: 'status_req', include_accounts: false },
      { addr: ADDR, timeoutMs: 8_000 },
    )
    if (r.type === 'err') {
      return NextResponse.json({ online: false, error: r.msg, addr: ADDR }, { status: 503 })
    }
    const b = (r.body ?? {}) as Record<string, unknown>
    return NextResponse.json({
      online: true,
      addr: ADDR,
      product: b.product_version,
      networkId: b.network_id,
      tip: b.tip_height,
      epochMs: b.epoch_ms,
      firstClaimEpoch: b.first_claim_epoch,
      unbondMs: b.unbond_cooldown_ms,
    })
  } catch (e) {
    return NextResponse.json(
      { online: false, addr: ADDR, error: String(e instanceof Error ? e.message : e) },
      { status: 503 },
    )
  }
}
