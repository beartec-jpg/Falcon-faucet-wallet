import { NextRequest, NextResponse } from 'next/server'
import { addressFromFalconSecret } from '@/lib/falcon-address'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FALCON512_PUB_HEX_LEN = 1796

export async function POST(req: NextRequest) {
  let body: { falcon_secret?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const falcon_secret = body.falcon_secret
  if (!falcon_secret || typeof falcon_secret !== 'string') {
    return NextResponse.json({ error: 'falcon_secret required' }, { status: 400 })
  }

  const hex = falcon_secret.trim()
  if (!/^[0-9A-Fa-f]{800,}$/.test(hex)) {
    return NextResponse.json({ error: 'Invalid falcon_secret format' }, { status: 400 })
  }

  try {
    const address = addressFromFalconSecret(hex)
    return NextResponse.json({
      address,
      publicKey: hex.slice(0, FALCON512_PUB_HEX_LEN),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Derivation failed'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}