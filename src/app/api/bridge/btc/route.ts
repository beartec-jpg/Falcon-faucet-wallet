import { NextResponse } from 'next/server'

/** Retired: legacy network 1001 custodial FBTC relay. */
export async function GET() {
  return NextResponse.json(
    {
      error: 'Legacy network 1001 custodial BTC bridge is shut down. Use Falcon PL 2300.',
      retired: true,
    },
    { status: 410 },
  )
}

export async function POST() {
  return GET()
}
