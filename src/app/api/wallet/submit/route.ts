import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  let body: { tx_blob?: unknown; network?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body?.tx_blob || typeof body.tx_blob !== 'string') {
    return NextResponse.json({ error: 'Missing tx_blob' }, { status: 400 })
  }

  if (!/^[0-9A-Fa-f]{10,}$/.test(body.tx_blob)) {
    return NextResponse.json({ error: 'Malformed tx_blob' }, { status: 400 })
  }

  const networkKey = resolveNetworkKey(body.network)

  try {
    const result = await serverRpcCall<{
      engine_result: string
      engine_result_message: string
      tx_json?: { hash?: string }
    }>(networkKey, 'submit', { tx_blob: body.tx_blob })

    const success = result.engine_result === 'tesSUCCESS'

    return NextResponse.json(
      {
        success,
        hash:    result.tx_json?.hash,
        result:  result.engine_result,
        message: result.engine_result_message,
        network: networkKey,
      },
      { status: success ? 200 : 422 },
    )
  } catch (err: unknown) {
    console.error('[wallet/submit] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Transaction submission failed' },
      { status: 502 },
    )
  }
}