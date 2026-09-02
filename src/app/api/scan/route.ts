// GET /api/scan — explorer snapshot (height / peers / commit from one PL status)

import { NextRequest, NextResponse } from 'next/server'
import { plAccount } from '@/lib/pl-rpc'
import { buildScanSnapshot } from '@/lib/scan-snapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export type {
  LedgerSummary,
  RailRow,
  ScanData,
  TxSummary,
  ValidatorEntry,
} from '@/lib/scan-types'

export async function GET(req: NextRequest) {
  const accountQ = req.nextUrl.searchParams.get('account')?.trim()
  if (accountQ) {
    try {
      const acct = await plAccount(accountQ)
      return NextResponse.json({ type: 'account', found: Boolean(acct.exists), ...acct })
    } catch (e) {
      return NextResponse.json({ type: 'account', found: false, error: String(e) }, { status: 200 })
    }
  }

  try {
    const payload = await buildScanSnapshot()
    return NextResponse.json(payload)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 })
  }
}
