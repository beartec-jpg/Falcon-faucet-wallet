import { NextRequest, NextResponse } from 'next/server'

/**
 * Same-origin JSON-RPC proxy for BSC testnet.
 * Used when the browser cannot reach public RPCs (CSP / CORS / flaky endpoints).
 * Only allowlisted methods — never accepts private keys.
 */

const BSC_TESTNET_RPCS = [
  'https://bsc-testnet-rpc.publicnode.com',
  'https://data-seed-prebsc-1-s1.binance.org:8545',
  'https://bsc-testnet.drpc.org',
] as const

const ALLOWED = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_getTransactionCount',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_estimateGas',
  'eth_call',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_sendRawTransaction',
])

export async function POST(req: NextRequest) {
  let body: { method?: string; params?: unknown[]; id?: number | string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const method = body.method?.trim()
  if (!method || !ALLOWED.has(method)) {
    return NextResponse.json(
      { error: `Method not allowed: ${method ?? '(missing)'}` },
      { status: 400 },
    )
  }

  // Basic raw-tx shape check (no key material)
  if (method === 'eth_sendRawTransaction') {
    const raw = Array.isArray(body.params) ? body.params[0] : null
    if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]+$/.test(raw) || raw.length < 20) {
      return NextResponse.json({ error: 'Invalid raw transaction' }, { status: 400 })
    }
  }

  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id: body.id ?? 1,
    method,
    params: body.params ?? [],
  })

  let lastErr = 'BSC testnet RPC unavailable'
  for (const url of BSC_TESTNET_RPCS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'falcon-wallet-bnb-rpc/1.0',
        },
        body: payload,
        cache: 'no-store',
      })
      const text = await r.text()
      if (!r.ok) {
        lastErr = `${url}: HTTP ${r.status}`
        continue
      }
      let j: { result?: unknown; error?: { message?: string; code?: number } }
      try {
        j = JSON.parse(text) as typeof j
      } catch {
        lastErr = 'invalid JSON from RPC'
        continue
      }
      if (j.error) {
        return NextResponse.json(
          { error: j.error.message || 'RPC error', code: j.error.code },
          { status: 502 },
        )
      }
      return NextResponse.json({ result: j.result })
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }

  return NextResponse.json({ error: lastErr }, { status: 502 })
}
