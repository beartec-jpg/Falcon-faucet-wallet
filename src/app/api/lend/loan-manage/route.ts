import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { brokerSecret, signAndSubmitLoanManage } from '@/lib/lend-broker-server'
import type { LoanManageAction } from '@/lib/lend-loan-manage'
import { resolveNetworkKey } from '@/lib/network-server'

const ACTIONS = new Set<LoanManageAction>(['impair', 'unimpair', 'default'])

/**
 * Testnet broker owner submits LoanManage (impair / unimpair / default).
 * Used by the HF monitor daemon and ops tooling — not end-user borrowers.
 */
export async function POST(req: NextRequest) {
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const daemonToken = process.env.LEND_HF_MONITOR_TOKEN?.trim()
  const auth = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const isDaemon = !!daemonToken && auth === daemonToken

  if (!isDaemon && !isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  if (networkKey !== 'testnet') {
    return NextResponse.json({ error: 'LoanManage only available on testnet' }, { status: 400 })
  }
  if (!brokerSecret()) {
    return NextResponse.json(
      { error: 'Broker secret not configured (TESTNET_LENDING_BROKER_SECRET)' },
      { status: 503 },
    )
  }

  let body: { loanId?: string; action?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const loanId = body.loanId?.trim() ?? ''
  const action = body.action as LoanManageAction
  if (!loanId || !ACTIONS.has(action)) {
    return NextResponse.json(
      { error: 'loanId and action (impair|unimpair|default) required' },
      { status: 400 },
    )
  }

  try {
    const out = await signAndSubmitLoanManage(networkKey, loanId, action)
    return NextResponse.json(out, { status: out.success ? 200 : 422 })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'LoanManage failed' },
      { status: 502 },
    )
  }
}