import { NextRequest, NextResponse } from 'next/server'
import { addressFromFalconSecret } from '@/lib/falcon-address'
import { isOriginAllowed } from '@/lib/origin'
import { isProductionRuntime } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FALCON512_PUB_HEX_LEN = 1796

/**
 * Prefer in-browser derivation. Disabled in production unless
 * ENABLE_SERVER_DERIVE=true. Always origin-gated when enabled.
 */
export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  if (
    isProductionRuntime() &&
    process.env.ENABLE_SERVER_DERIVE?.toLowerCase() !== 'true'
  ) {
    return NextResponse.json(
      {
        error:
          'Server-side secret derive is disabled. Derive addresses in-browser.',
        code: 'DERIVE_DISABLED',
      },
      { status: 410 },
    )
  }

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
  if (!/^[0-9A-Fa-f]{800,4358}$/.test(hex) || hex.length % 2 !== 0) {
    return NextResponse.json({ error: 'Invalid falcon_secret format' }, { status: 400 })
  }

  try {
    const address = addressFromFalconSecret(hex)
    return NextResponse.json({
      address,
      publicKey: hex.slice(0, FALCON512_PUB_HEX_LEN),
    })
  } catch {
    return NextResponse.json({ error: 'Derivation failed' }, { status: 400 })
  }
}
