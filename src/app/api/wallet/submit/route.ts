import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'
import { peekSubmitRateLimit, consumeSubmitRateLimit } from '@/lib/rate-limit'

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  // Rate-limit this unauthenticated RPC-relay proxy to protect the node from abuse.
  const rlKey = `submit:ip:${clientIp(req)}`
  const rl = await peekSubmitRateLimit(rlKey)
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Too many submissions — please slow down', reset: rl.reset },
      { status: 429 },
    )
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
    await consumeSubmitRateLimit(rlKey)
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