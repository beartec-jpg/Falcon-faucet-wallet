import { NextRequest, NextResponse } from 'next/server'
import { scanChainLoanRisk } from '@/lib/lend-risk-scan'
import { brokerSecret } from '@/lib/lend-broker-server'
import { resolveNetworkKey } from '@/lib/network-server'

/** On-chain loan health scan for LPs, borrowers, and HF monitor daemon. */
export async function GET(req: NextRequest) {
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))

  try {
    const scan = await scanChainLoanRisk(networkKey)
    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      enforcementReady: networkKey === 'testnet' && !!brokerSecret(),
      ...scan,
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Risk scan failed' },
      { status: 502 },
    )
  }
}