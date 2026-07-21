import { NextRequest, NextResponse } from 'next/server'
import { brokerSecret, signAndSubmitLoanManage } from '@/lib/lend-broker-server'
import type { LoanManageAction } from '@/lib/lend-loan-manage'
import { resolveNetworkKey } from '@/lib/network-server'
import { bearerToken, timingSafeEqualString } from '@/lib/security'

const ACTIONS = new Set<LoanManageAction>(['impair', 'unimpair', 'default'])

/**
 * Testnet broker owner submits LoanManage (impair / unimpair / default).
 * Daemon-only: requires LEND_HF_MONITOR_TOKEN. Browser origin path removed.
 */
export async function POST(req: NextRequest) {
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const daemonToken = process.env.LEND_HF_MONITOR_TOKEN?.trim()
  if (!daemonToken) {
    return NextResponse.json(
      {
        error:
          'LoanManage disabled: set LEND_HF_MONITOR_TOKEN (daemon bearer required).',
        code: 'LOAN_MANAGE_TOKEN_REQUIRED',
      },
      { status: 503 },
    )
  }

  const auth = bearerToken(req)
  if (!auth || !timingSafeEqualString(auth, daemonToken)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (networkKey !== 'testnet') {
    return NextResponse.json(
      { error: 'LoanManage only available on testnet' },
      { status: 400 },
    )
  }
  if (!brokerSecret()) {
    return NextResponse.json(
      { error: 'Broker secret not configured' },
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
    console.error('[loan-manage]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'LoanManage failed' }, { status: 502 })
  }
}
