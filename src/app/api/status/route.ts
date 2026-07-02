import { NextRequest, NextResponse } from 'next/server'
import {
  resolveNetworkKey,
  serverNetworkConfig,
  serverRpcCall,
} from '@/lib/network-server'
import type { ServerInfo } from '@/lib/rpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const cfg = serverNetworkConfig(networkKey)

  try {
    const result = await serverRpcCall<{ info: ServerInfo }>(networkKey, 'server_info', {})
    const info = result.info
    return NextResponse.json({
      online: true,
      network: networkKey,
      networkName: cfg.name,
      networkLive: cfg.live,
      state: info.server_state,
      ledger: info.validated_ledger?.seq ?? 0,
      peers: info.peers,
      loadFactor: info.load_factor,
      completeLedgers: info.complete_ledgers,
      reserveBaseXrp: info.validated_ledger?.reserve_base_xrp ?? 0,
      dripAmountQxrp: cfg.dripAmountQxrp,
      networkId: cfg.networkId,
    })
  } catch (e) {
    return NextResponse.json(
      {
        online: false,
        network: networkKey,
        networkName: cfg.name,
        networkLive: cfg.live,
        dripAmountQxrp: cfg.dripAmountQxrp,
        networkId: cfg.networkId,
        error: String(e),
      },
      { status: 200 },
    )
  }
}