/**
 * XRPL-era API routes that have no meaning on Falcon PL 2300 answer 410 Gone there
 * (instead of 502 from a dead XRPL RPC). Other networks keep the old handlers.
 * Replacements: /api/pl2300 (status), /api/pl2300/rewards, /api/pl2300/defi, /api/pl2300/validators.
 */
import { NextResponse } from 'next/server'
import { getNetwork } from '@/lib/networks'
import { resolveNetworkKey } from '@/lib/network-server'

export const PL_RETIRED_MSG = 'retired on Falcon PL; use /api/pl2300/*'

export function retiredOnPl(req: Request): NextResponse | null {
  let param: string | null = null
  try {
    param = new URL(req.url).searchParams.get('network')
  } catch {
    param = null
  }
  if (getNetwork(resolveNetworkKey(param)).networkId !== 2300) return null
  return NextResponse.json(
    { error: PL_RETIRED_MSG, networkId: 2300 },
    { status: 410, headers: { 'cache-control': 'public, max-age=300' } },
  )
}
