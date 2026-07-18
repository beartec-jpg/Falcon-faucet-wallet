import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { fullRepayAmount, isRepayableLoan, repayBlockedReason } from '@/lib/lend-borrow-errors'
import { iouAmount, loanOutstandingFusdc } from '@/lib/lend-pool-stats'
import { filterActiveUserLoans } from '@/lib/lend-risk-scan'
import { getNetwork, networkIdForTx } from '@/lib/networks'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'
import { loadStableToken } from '@/lib/swap/token-config'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/

function loanObjectId(obj: Record<string, unknown>): string {
  return String(obj.index ?? obj.Index ?? obj.LoanID ?? obj.loan_id ?? '').toUpperCase()
}

function paymentDueFromLoanObj(obj: Record<string, unknown>): {
  paymentDueRaw: string | null
  paymentDueFusdc: number | null
  principalFusdc: number
  totalOutstandingFusdc: number | null
} {
  const principalFusdc = iouAmount(obj.PrincipalOutstanding) ?? 0
  const totalOutstandingFusdc = iouAmount(obj.TotalValueOutstanding)
  const paymentDueFusdc = iouAmount(obj.PeriodicPayment)
  let paymentDueRaw: string | null = null
  const pp = obj.PeriodicPayment
  if (typeof pp === 'string' || typeof pp === 'number') {
    paymentDueRaw = String(pp)
  } else if (pp && typeof pp === 'object' && 'value' in (pp as object)) {
    paymentDueRaw = String((pp as { value: unknown }).value)
  } else if (paymentDueFusdc != null) {
    paymentDueRaw = String(paymentDueFusdc)
  }
  return { paymentDueRaw, paymentDueFusdc, principalFusdc, totalOutstandingFusdc }
}

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const network = getNetwork(networkKey)
  let body: { address?: string; loanId?: string; amount?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', stage: 'parse' }, { status: 400 })
  }

  const address = body.address?.trim() ?? ''
  const loanId = body.loanId?.trim() ?? ''
  const amountStr = body.amount?.trim() ?? ''
  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'Valid Falcon address required', stage: 'parse' }, { status: 400 })
  }
  if (!loanId) {
    return NextResponse.json({ error: 'loanId required', stage: 'parse' }, { status: 400 })
  }

  const stable = await loadStableToken()
  if (!stable.issuer) {
    return NextResponse.json(
      { error: 'F-USDC token config missing on server (testnet-stables.json).', stage: 'config' },
      { status: 400 },
    )
  }

  const loanR = await serverRpcCall<{ account_objects?: Array<Record<string, unknown>> }>(
    networkKey,
    'account_objects',
    { account: address, type: 'loan', ledger_index: 'validated' },
    { allowError: true },
  )
  const objects = loanR.account_objects ?? []
  const active = filterActiveUserLoans(objects)
  const wantId = loanId.toUpperCase()
  let obj =
    active.find((o) => loanObjectId(o) === wantId) ??
    objects.find((o) => loanObjectId(o) === wantId && loanOutstandingFusdc(o) > 0)

  if (!obj) {
    return NextResponse.json(
      {
        error: `No active loan found for this account (loanId ${loanId.slice(0, 16)}…). Refresh Positions and try again.`,
        stage: 'lookup',
        loanCount: objects.length,
        activeCount: active.length,
      },
      { status: 400 },
    )
  }

  const fields = paymentDueFromLoanObj(obj)
  if (
    !isRepayableLoan({
      principalFusdc: fields.principalFusdc,
      paymentDueRaw: fields.paymentDueRaw,
      paymentDueFusdc: fields.paymentDueFusdc,
      totalOutstandingFusdc: fields.totalOutstandingFusdc,
    })
  ) {
    return NextResponse.json(
      { error: 'Loan is not repayable (already paid or defaulted).', stage: 'lookup' },
      { status: 400 },
    )
  }

  const payAmount =
    amountStr ||
    fullRepayAmount({
      paymentDueRaw: fields.paymentDueRaw,
      paymentDueFusdc: fields.paymentDueFusdc,
      totalOutstandingFusdc: fields.totalOutstandingFusdc,
      principalFusdc: fields.principalFusdc,
    })
  if (!payAmount) {
    return NextResponse.json(
      { error: 'Could not determine repayment amount from loan fields.', stage: 'amount' },
      { status: 400 },
    )
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
      loans: [
        {
          id: wantId,
          vaultId: '',
          principalFusdc: fields.principalFusdc,
          paymentDueRaw: fields.paymentDueRaw,
          paymentDueFusdc: fields.paymentDueFusdc,
          totalOutstandingFusdc: fields.totalOutstandingFusdc,
          collateralFalcon: 0,
          healthFactor: null,
        },
      ],
      wallet:
        fusdcBalance != null
          ? {
              address,
              falconBalance: null,
              fusdcBalance,
              fusdcLimit: null,
              hasFusdcTrustLine: true,
            }
          : null,
    } as import('@/lib/lend-model').LendOverview,
    wantId,
    payAmount,
  )
  if (blocked) {
    return NextResponse.json(
      { error: blocked, amount: payAmount, fusdcBalance, stage: 'blocked' },
      { status: 400 },
    )
  }

  let sequence = 0
  let ledgerIndex = 0
  try {
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
  } catch (e: unknown) {
    return NextResponse.json(
      {
        error: `Could not load account sequence: ${e instanceof Error ? e.message : 'rpc error'}`,
        stage: 'rpc',
        amount: payAmount,
      },
      { status: 400 },
    )
  }

  const tx_json: Record<string, unknown> = {
    TransactionType: 'LoanPay',
    Account: address,
    LoanID: wantId,
    Amount: { currency: stable.currency, issuer: stable.issuer, value: payAmount },
    Sequence: sequence,
    Fee: '24',
    LastLedgerSequence: ledgerIndex + 30,
  }
  // Only include NetworkID when required (networkId > 1024). Falcon testnet is
  // 1001 and rejects NetworkID with telNETWORK_ID_MAKES_TX_NON_CANONICAL.
  const nid = networkIdForTx(network.networkId)
  if (nid !== undefined) {
    tx_json.NetworkID = nid
  }

  try {
    const sim = await serverRpcCall<{
      engine_result?: string
      engine_result_message?: string
    }>(networkKey, 'simulate', { tx_json })

    const ok = sim.engine_result === 'tesSUCCESS'
    if (!ok) {
      // Soft-pass tec-class failures that are only about simulate context; still
      // block clear insufficient payment / funds so the user sees a real reason.
      const code = sim.engine_result ?? ''
      const msg = sim.engine_result_message ?? ''
      return NextResponse.json(
        {
          error: `Repay would fail on-chain (${code}${msg ? `: ${msg}` : ''}). Amount tried: ${payAmount} F-USDC.`,
          amount: payAmount,
          simulateResult: code,
          simulateMessage: msg,
          stage: 'simulate',
          fusdcBalance,
        },
        { status: 400 },
      )
    }
  } catch (e: unknown) {
    // Simulate RPC flaky — allow client to attempt sign if amount/balance checks passed.
    return NextResponse.json({
      ok: true,
      amount: payAmount,
      fusdcBalance,
      simulateSkipped: true,
      simulateSkipReason: e instanceof Error ? e.message : 'simulate rpc failed',
    })
  }

  return NextResponse.json({
    ok: true,
    amount: payAmount,
    fusdcBalance,
    simulateResult: 'tesSUCCESS',
  })
}
