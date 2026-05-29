import { NextRequest, NextResponse } from 'next/server'
import { DEFAULT_RPC_URL } from '@/lib/rpc'

// Public RPC only (Node 1 full-history recommended)
const RPC = process.env.XRPLD_RPC_URL ?? DEFAULT_RPC_URL

export async function POST(req: NextRequest) {
  let body: { tx_blob?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body?.tx_blob || typeof body.tx_blob !== 'string') {
    return NextResponse.json({ error: 'Missing tx_blob' }, { status: 400 })
  }

  // Basic sanity: tx_blob must be a non-empty hex string
  if (!/^[0-9A-Fa-f]{10,}$/.test(body.tx_blob)) {
    return NextResponse.json({ error: 'Malformed tx_blob' }, { status: 400 })
  }

  try {
    const res = await fetch(RPC, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ method: 'submit', params: [{ tx_blob: body.tx_blob }] }),
      cache:   'no-store',
    })

    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`)

    const data   = await res.json()
    const result = data.result as {
      engine_result:         string
      engine_result_message: string
      tx_json?:              { hash?: string }
    }

    const success =
      result.engine_result === 'tesSUCCESS' ||
      result.engine_result?.startsWith('ter')   // queued / held

    return NextResponse.json(
      {
        success,
        hash:    result.tx_json?.hash,
        result:  result.engine_result,
        message: result.engine_result_message,
      },
      { status: success ? 200 : 422 }
    )
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Submit failed' },
      { status: 502 }
    )
  }
}
