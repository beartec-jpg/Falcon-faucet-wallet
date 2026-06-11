// GET /api/status
// Returns live network info from the configured xrpld node

import { NextResponse } from 'next/server'
import { getServerInfo } from '@/lib/rpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const info = await getServerInfo()
    return NextResponse.json({
      online: true,
      state: info.server_state,
      ledger: info.validated_ledger?.seq ?? 0,
      peers: info.peers,
      loadFactor: info.load_factor,
      completeLedgers: info.complete_ledgers,
      reserveBaseXrp: info.validated_ledger?.reserve_base_xrp ?? 0,
      dripAmountQxrp: parseFloat(process.env.DRIP_AMOUNT_QXRP ?? '2000'),
      networkId: parseInt(process.env.NEXT_PUBLIC_NETWORK_ID ?? '1001', 10),
    })
  } catch (e) {
    // Return 200 with online:false so the UI doesn't break / show network errors
    // The detailed error is still available for debugging
    return NextResponse.json(
      { online: false, error: String(e) },
      { status: 200 }
    )
  }
}
