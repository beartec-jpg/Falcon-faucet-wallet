import { NextRequest, NextResponse } from 'next/server'
import { meshHeadFromStatus } from '@/lib/pl-mesh'
import { plStatus } from '@/lib/pl-rpc'
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
  const drip = cfg.dripAmountFpl

  try {
    if (networkKey === 'testnet') {
      const st = await plStatus(false)
      const head = meshHeadFromStatus(st)
      const reserve = 0
      return NextResponse.json({
        online: true,
        network: networkKey,
        networkName: cfg.name,
        networkLive: cfg.live,
        state: head.server_state,
        ledger: head.height,
        height: head.height,
        peers: head.peers,
        commit: head.commit,
        commit_need: head.commit_need,
        committee_size: head.committee_size,
        product_version: head.product_version,
        loadFactor: 1,
        completeLedgers: String(head.height),
        dripAmountFpl: drip,
        reserveBaseFpl: reserve,
        dripAmountQxrp: drip,
        reserveBaseXrp: reserve,
        networkId: cfg.networkId,
      })
    }

    const result = await serverRpcCall<{ info: ServerInfo }>(networkKey, 'server_info', {})
    const info = result.info
    const reserve = info.validated_ledger?.reserve_base_xrp ?? 0
    const height = info.validated_ledger?.seq ?? 0
    return NextResponse.json({
      online: true,
      network: networkKey,
      networkName: cfg.name,
      networkLive: cfg.live,
      state: info.server_state,
      ledger: height,
      height,
      peers: info.peers,
      loadFactor: info.load_factor,
      completeLedgers: info.complete_ledgers,
      dripAmountFpl: drip,
      reserveBaseFpl: reserve,
      dripAmountQxrp: drip,
      reserveBaseXrp: reserve,
      networkId: cfg.networkId,
    })
  } catch (e) {
    return NextResponse.json(
      {
        online: false,
        network: networkKey,
        networkName: cfg.name,
        networkLive: cfg.live,
        dripAmountFpl: drip,
        dripAmountQxrp: drip,
        networkId: cfg.networkId,
        error: String(e),
      },
      { status: 200 },
    )
  }
}
