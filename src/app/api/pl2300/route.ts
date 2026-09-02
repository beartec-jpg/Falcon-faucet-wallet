import { NextResponse } from 'next/server'
import { meshHeadFromStatus } from '@/lib/pl-mesh'
import { plRpc } from '@/lib/pl-rpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const r = await plRpc(
      { type: 'status_req', include_accounts: false },
      { timeoutMs: 8_000 },
    )
    if (r.type === 'err') {
      return NextResponse.json({ online: false, error: r.msg }, { status: 503 })
    }
    const b = (r.body ?? {}) as Record<string, unknown>
    const head = meshHeadFromStatus(b)
    return NextResponse.json({
      online: true,
      product: head.product_version,
      networkId: b.network_id,
      tip: head.height,
      height: head.height,
      peers: head.peers,
      commit: head.commit,
      commit_need: head.commit_need,
      committee_size: head.committee_size,
      epoch: b.epoch,
      epochMs: b.epoch_ms,
      lastSettledEpoch: b.last_settled_epoch,
      firstClaimEpoch: b.first_claim_epoch,
      unbondMs: b.unbond_cooldown_ms,
      watcherSlot: b.watcher_current_slot,
      watcherSlotMs: b.watcher_slot_ms,
    })
  } catch (e) {
    return NextResponse.json(
      { online: false, error: String(e instanceof Error ? e.message : e) },
      { status: 503 },
    )
  }
}
