import { NextRequest, NextResponse } from 'next/server'

/**
 * Same-origin JSON-RPC proxy for BSC testnet (ethers-compatible response shape).
 * Never accepts private keys — only allowlisted methods + raw signed txs.
 */

const BSC_TESTNET_RPCS = [
  'https://bsc-testnet-rpc.publicnode.com',
  'https://data-seed-prebsc-1-s1.binance.org:8545',
  'https://bsc-testnet.drpc.org',
] as const

const ALLOWED = new Set([
  'eth_chainId',
  'net_version',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getTransactionCount',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_estimateGas',
  'eth_call',
  'eth_getLogs',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_sendRawTransaction',
])

type RpcReq = { method?: string; params?: unknown[]; id?: number | string; jsonrpc?: string }

async function forwardOne(req: RpcReq): Promise<Record<string, unknown>> {
  const id = req.id ?? 1
  const method = req.method?.trim()
  if (!method || !ALLOWED.has(method)) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not allowed: ${method ?? '(missing)'}` },
    }
  }

  if (method === 'eth_sendRawTransaction') {
    const raw = Array.isArray(req.params) ? req.params[0] : null
    if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]+$/.test(raw) || raw.length < 20) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Invalid raw transaction' },
      }
    }
  }

  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    params: req.params ?? [],
  })

  let lastErr = 'BSC testnet RPC unavailable'
  for (const url of BSC_TESTNET_RPCS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'falcon-wallet-bnb-rpc/1.1',
        },
        body: payload,
        cache: 'no-store',
      })
      const text = await r.text()
      if (!r.ok) {
        lastErr = `${url}: HTTP ${r.status}`
        continue
      }
      const j = JSON.parse(text) as {
        result?: unknown
        error?: { message?: string; code?: number }
        id?: unknown
      }
      if (j.error) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: j.error.code ?? -32000, message: j.error.message || 'RPC error' },
        }
      }
      return { jsonrpc: '2.0', id, result: j.result }
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32000, message: lastErr },
  }
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON body' } },
      { status: 400 },
    )
  }

  // ethers may send a batch array
  if (Array.isArray(body)) {
    const out = await Promise.all(body.map((item) => forwardOne(item as RpcReq)))
    return NextResponse.json(out)
  }

  const single = await forwardOne(body as RpcReq)
  // HTTP 200 even for RPC-level errors (ethers expects that)
  return NextResponse.json(single)
}
