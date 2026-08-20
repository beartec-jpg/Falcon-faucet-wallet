import { NextResponse } from 'next/server'

/** Retired: Falcon Ledger custodial FBTC relay (network 1001). */
export async function GET() {
  return NextResponse.json(
    {
      error: 'Falcon Ledger custodial BTC bridge is shut down. Use Falcon PL 2300.',
      retired: true,
    },
    { status: 410 },
  )
}

export async function POST() {
  return GET()
}
