import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { fullRepayAmount, isRepayableLoan, repayBlockedReason } from '@/lib/lend-borrow-errors'
import { filterActiveUserLoans } from '@/lib/lend-risk-scan'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'
import { loadStableToken } from '@/lib/swap/token-config'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  let body: { address?: string; loanId?: string; amount?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const address = body.address?.trim() ?? ''
  const loanId = body.loanId?.trim() ?? ''
  const amountStr = body.amount?.trim() ?? ''
  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'Valid Falcon address required' }, { status: 400 })
  }
  if (!loanId) {
    return NextResponse.json({ error: 'loanId required' }, { status: 400 })
  }

  const stable = await loadStableToken()
  const loanR = await serverRpcCall<{ account_objects?: Array<Record<string, unknown>> }>(
    networkKey,
    'account_objects',
    { account: address, type: 'loan', ledger_index: 'validated' },
    { allowError: true },
  )
  const active = filterActiveUserLoans(loanR.account_objects ?? [])
  const obj = active.find((o) => String(o.index ?? '') === loanId)
  if (!obj || !isRepayableLoan({
    principalFusdc: parseFloat(String(obj.PrincipalOutstanding ?? '0')),
    paymentDueRaw: typeof obj.PeriodicPayment === 'string' ? obj.PeriodicPayment : null,
    paymentDueFusdc: null,
    totalOutstandingFusdc: parseFloat(String(obj.TotalValueOutstanding ?? '0')) || null,
  })) {
    return NextResponse.json({ error: 'No active loan found for this account' }, { status: 400 })
  }

  const payAmount = amountStr || fullRepayAmount({
    paymentDueRaw: typeof obj.PeriodicPayment === 'string' ? obj.PeriodicPayment : null,
    paymentDueFusdc: null,
    totalOutstandingFusdc: parseFloat(String(obj.TotalValueOutstanding ?? '0')) || null,
    principalFusdc: parseFloat(String(obj.PrincipalOutstanding ?? '0')),
  })
  if (!payAmount) {
    return NextResponse.json({ error: 'Could not determine repayment amount' }, { status: 400 })
  }

  let fusdcBalance: number | null = null
  try {
    const lines = await serverRpcCall<{
      lines?: Array<{ currency: string; account: string; balance: string }>
    }>(networkKey, 'account_lines', { account: address, ledger_index: 'validated' })
    const line = (lines.lines ?? []).find(
      (l) => l.currency === stable.currency && l.account === stable.issuer,
    )
    if (line) fusdcBalance = parseFloat(line.balance)
  } catch {
    /* optional */
  }

  const blocked = repayBlockedReason(
    {
      loans: [{
        id: loanId,
        vaultId: '',
        principalFusdc: parseFloat(String(obj.PrincipalOutstanding ?? '0')),
        paymentDueRaw: typeof obj.PeriodicPayment === 'string' ? obj.PeriodicPayment : null,
        paymentDueFusdc: null,
        totalOutstandingFusdc: parseFloat(String(obj.TotalValueOutstanding ?? '0')) || null,
        collateralFalcon: 0,
        healthFactor: null,
      }],
      wallet: fusdcBalance != null ? {
        address,
        falconBalance: null,
        fusdcBalance,
        fusdcLimit: null,
        hasFusdcTrustLine: true,
      } : null,
    } as import('@/lib/lend-model').LendOverview,
    loanId,
    payAmount,
  )
  if (blocked) {
    return NextResponse.json({ error: blocked, amount: payAmount, fusdcBalance }, { status: 400 })
  }

  let sequence = 0
  let ledgerIndex = 0
  const info = await serverRpcCall<{ account_data: { Sequence: number } }>(
    networkKey,
    'account_info',
    { account: address, ledger_index: 'validated' },
  )
  sequence = info.account_data.Sequence
  const ledger = await serverRpcCall<{ ledger_index: number }>(networkKey, 'ledger', {
    ledger_index: 'validated',
  })
  ledgerIndex = ledger.ledger_index

  const sim = await serverRpcCall<{
    engine_result?: string
    engine_result_message?: string
  }>(networkKey, 'simulate', {
    tx_json: {
      TransactionType: 'LoanPay',
      Account: address,
      LoanID: loanId.toUpperCase(),
      Amount: { currency: stable.currency, issuer: stable.issuer, value: payAmount },
      Sequence: sequence,
      Fee: '12',
      LastLedgerSequence: ledgerIndex + 20,
    },
  })

  const ok = sim.engine_result === 'tesSUCCESS'
  if (!ok) {
    return NextResponse.json(
      {
        error: `Repay would fail on-chain (${sim.engine_result ?? 'simulate error'})`,
        amount: payAmount,
        simulateResult: sim.engine_result,
        simulateMessage: sim.engine_result_message,
      },
      { status: 400 },
    )
  }

  return NextResponse.json({
    ok: true,
    amount: payAmount,
    fusdcBalance,
    simulateResult: sim.engine_result,
  })
}