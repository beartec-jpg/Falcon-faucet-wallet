// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// Developer portal content. Gateway facts mirror Falcon-PL `falcon-pl-rs/tools/fpl-gateway`
// (PR #17, not deployed). Explorer endpoints are read from the live OpenAPI spec.
import { openapi } from '@/lib/explorer-api/openapi'

/** Live public gateway URL. */
export const GATEWAY_URL = 'https://rpc.falcon-fpl.com'
/** Origins allowed to call the gateway from a browser. */
export const GATEWAY_CORS_ORIGINS = ['https://falcon-fpl.com', 'https://www.beartec.uk']

export const EXPLORER_URL = 'https://falcon-fpl.com'

export const TESTNET_NOTICE =
  'Falcon PL is a testnet. FPL testnet tokens have no monetary value and cannot be bought or sold. ' +
  'Paid plans pay for RPC capacity and support only.'

/** Feature flag for the "get an API key" flow. Off unless explicitly set to "1". */
export function apiKeysEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_DEV_PORTAL_KEYS === '1'
}

export type Tier = {
  id: 'free' | 'builder' | 'scale'
  name: string
  priceGbpMonthly: number
  rps: number
  burst: number
  monthlyUnits: number
  txPerMin: number
  blurb: string
}

/** Prices and limits confirmed by Scott (match the live fpl-gateway config). */
export const TIERS: Tier[] = [
  { id: 'free', name: 'Free', priceGbpMonthly: 0, rps: 5, burst: 10, monthlyUnits: 300_000, txPerMin: 10, blurb: 'Prototypes, hackathons, learning.' },
  { id: 'builder', name: 'Builder', priceGbpMonthly: 29, rps: 25, burst: 50, monthlyUnits: 5_000_000, txPerMin: 120, blurb: 'Apps and bots in active development.' },
  { id: 'scale', name: 'Scale', priceGbpMonthly: 199, rps: 100, burst: 200, monthlyUnits: 50_000_000, txPerMin: 600, blurb: 'Indexers, wallets and higher traffic.' },
]

export function formatGbp(n: number): string {
  return n === 0 ? '£0' : `£${n}`
}

export type GatewayMethod = { name: string; params: string; returns: string; units: number }

export const GATEWAY_METHODS: GatewayMethod[] = [
  { name: 'fpl_status', params: '—', returns: 'Brief chain status (tip height, rails). Never includes the account dump.', units: 1 },
  { name: 'fpl_health', params: 'warnings? (0–64)', returns: 'Node health snapshot (falcon.health.v1).', units: 1 },
  { name: 'fpl_getAccount', params: 'account', returns: 'Sequence, balance, claimable, assets.', units: 1 },
  { name: 'fpl_orderBook', params: 'pair, levels? (≤200)', returns: 'Order book depth and pool spot.', units: 1 },
  { name: 'fpl_openOrders', params: 'account', returns: "An account's open orders.", units: 1 },
  { name: 'fpl_fills', params: 'pair?, account?, limit? (≤200)', returns: 'Recent fills, newest first.', units: 1 },
  { name: 'fpl_submitTx', params: 'tx (signed transaction object)', returns: '{ msg } on acceptance into the mempool.', units: 5 },
]

export const GATEWAY_ERRORS: { http: number; code: number; meaning: string; action: string }[] = [
  { http: 401, code: -32001, meaning: 'Missing or invalid API key', action: 'Send Authorization: Bearer fplk_… or X-API-Key.' },
  { http: 429, code: -32005, meaning: 'Rate limit, tx-submit limit or monthly quota reached', action: 'Wait Retry-After seconds. Quota errors reset on the 1st (00:00 UTC).' },
  { http: 200, code: -32601, meaning: 'Method not allowed', action: 'Only the methods listed above are available.' },
  { http: 200, code: -32602, meaning: 'Invalid params', action: 'Check the params object.' },
  { http: 200, code: -32000, meaning: 'Node rejected the request', action: 'Read error.message (e.g. unknown account, bad tx).' },
  { http: 400, code: -32700, meaning: 'Body is not valid JSON', action: 'Send one JSON-RPC 2.0 object.' },
  { http: 400, code: -32600, meaning: 'Batch requests are not supported yet', action: 'Send one request per call.' },
  { http: 413, code: 0, meaning: 'Body larger than 64 KiB', action: 'Transactions are far smaller; check what you send.' },
  { http: 502, code: -32002, meaning: 'Node unavailable', action: 'Retry with backoff.' },
  { http: 503, code: -32003, meaning: 'Gateway busy', action: 'Retry with backoff.' },
]

export const GATEWAY_ROUTES: { method: string; path: string; auth: boolean; note: string }[] = [
  { method: 'POST', path: '/v1/rpc', auth: true, note: 'JSON-RPC 2.0, one request per call' },
  { method: 'GET', path: '/v1/usage', auth: true, note: 'Your key’s month-to-date usage and limits' },
  { method: 'GET', path: '/v1/health', auth: false, note: 'Gateway and node liveness' },
  { method: 'GET', path: '/v1/tiers', auth: false, note: 'Current tier table' },
]

export const EXAMPLES = {
  curl: `curl -s ${GATEWAY_URL}/v1/rpc \\
  -H "Authorization: Bearer $FPL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"fpl_getAccount","params":{"account":"alice"}}'`,
  js: `// Node 18+ / browsers. Keep the key server-side.
async function fpl(method, params = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch('${GATEWAY_URL}/v1/rpc', {
      method: 'POST',
      headers: { Authorization: \`Bearer \${process.env.FPL_API_KEY}\`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    if (r.status === 429) {
      const wait = Number(r.headers.get('retry-after') ?? 1)
      await new Promise((ok) => setTimeout(ok, wait * 1000))
      continue
    }
    const body = await r.json()
    if (body.error) throw new Error(\`\${body.error.code}: \${body.error.message}\`)
    return body.result
  }
  throw new Error('rate limited')
}

const status = await fpl('fpl_status')`,
  python: `import os, time, requests

def fpl(method, params=None, tries=4):
    for _ in range(tries):
        r = requests.post(
            "${GATEWAY_URL}/v1/rpc",
            headers={"Authorization": f"Bearer {os.environ['FPL_API_KEY']}"},
            json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
            timeout=10,
        )
        if r.status_code == 429:
            time.sleep(int(r.headers.get("Retry-After", "1")))
            continue
        body = r.json()
        if "error" in body:
            raise RuntimeError(f"{body['error']['code']}: {body['error']['message']}")
        return body["result"]
    raise RuntimeError("rate limited")

print(fpl("fpl_orderBook", {"pair": "BTC4-FPL", "levels": 10}))`,
}

export type ExplorerEndpoint = { path: string; summary: string; params: string[]; statuses: string[]; tag: string }

/** Every GET in the Explorer API OpenAPI document (source of truth: src/lib/explorer-api/openapi.ts). */
export function explorerEndpoints(): ExplorerEndpoint[] {
  type P = { name: string; in: string; required?: boolean }
  const comps = (openapi as unknown as { components?: { parameters?: Record<string, P> } }).components?.parameters ?? {}
  return Object.entries(openapi.paths as unknown as Record<string, { get: { summary: string; tags: readonly string[]; parameters?: unknown[]; responses: Record<string, unknown> } }>).map(
    ([path, item]) => {
      const params = (item.get.parameters ?? []).map((p) => {
        const ref = (p as { $ref?: string }).$ref
        const r: P | undefined = ref ? comps[ref.split('/').pop() as string] : (p as P)
        if (!r) return '?'
        return `${r.name}${r.in === 'query' ? (r.required ? ' (query)' : '? (query)') : ''}`
      })
      return { path, summary: item.get.summary, params, statuses: Object.keys(item.get.responses), tag: item.get.tags[0] }
    },
  )
}

export const EXPLORER_ERROR_CODES = ['bad_request', 'not_found', 'not_implemented', 'node_unavailable', 'internal'] as const

export const DEV_PAGES: { href: string; title: string; desc: string }[] = [
  { href: '/developers/gateway', title: 'Falcon Cloud RPC gateway', desc: 'API keys, JSON-RPC methods, examples, errors and 429 handling.' },
  { href: '/developers/explorer-api', title: 'Explorer API', desc: 'Public read-only REST API for blocks, accounts, validators and the order book.' },
  { href: '/developers/pricing', title: 'Pricing', desc: 'Free, Builder and Scale. Testnet only.' },
  { href: '/developers/api-keys', title: 'Get an API key', desc: 'Keys are issued on request through BEARTEC.' },
  { href: '/developers/sdk', title: 'Falcon Sign SDK', desc: 'Coming soon, Apache-2.0.' },
]
