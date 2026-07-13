import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { setLoanCollateral } from '@/lib/lend-collateral-store'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/
const LOAN_ID_RE = /^[A-F0-9]{64}$/i

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  let body: { loanId?: string; borrower?: string; collateralFalcon?: number | string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const loanId = body.loanId?.trim().toUpperCase() ?? ''
  const borrower = body.borrower?.trim() ?? ''
  const collateral = parseFloat(String(body.collateralFalcon ?? ''))

  if (!LOAN_ID_RE.test(loanId)) {
    return NextResponse.json({ error: 'Valid loan ID required' }, { status: 400 })
  }
  if (!ADDRESS_RE.test(borrower)) {
    return NextResponse.json({ error: 'Valid borrower address required' }, { status: 400 })
  }
  if (!Number.isFinite(collateral) || collateral <= 0) {
    return NextResponse.json({ error: 'Positive collateral amount required' }, { status: 400 })
  }

  await setLoanCollateral(loanId, borrower, collateral)
  return NextResponse.json({ ok: true, loanId, collateralFalcon: collateral })
}