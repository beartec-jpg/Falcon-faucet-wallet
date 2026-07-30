import { NextRequest, NextResponse } from 'next/server'
import {
  XRPL_CLASSIC_HTTP,
  type XrplClassicNetwork,
} from '@/lib/create-xrpl-classic-wallet'

/**
 * Same-origin XRPL JSON-RPC proxy (classic public networks).
 * Keys never touch this route — only allowlisted read methods + signed submit blob.
 */

const ALLOWED = new Set([
  'account_info',
  'account_tx',
  'fee',
  'ledger',
  'ledger_current',
  'server_info',
  'submit',
  'tx',
])

const FALLBACK_HTTP: Record<XrplClassicNetwork, string[]> = {
  testnet: [
    process.env.NEXT_PUBLIC_XRPL_CLASSIC_TESTNET_RPC?.trim() || '',
    'https://s.altnet.rippletest.net:51234',
    'https://testnet.xrpl-labs.com',
  ].filter(Boolean),
  mainnet: [
    process.env.NEXT_PUBLIC_XRPL_CLASSIC_MAINNET_RPC?.trim() || '',
    'https://xrplcluster.com',
    'https://s1.ripple.com:51234',
  ].filter(Boolean),
}

function parseNetwork(raw: string | null): XrplClassicNetwork {
  return raw === 'mainnet' ? 'mainnet' : 'testnet'
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const o = body as {
    method?: string
    params?: Record<string, unknown> | unknown[]
    network?: string
  }
  const method = o.method?.trim()
  if (!method || !ALLOWED.has(method)) {
    return NextResponse.json(
      { error: `Method not allowed: ${method ?? '(missing)'}` },
      { status: 400 },
    )
  }

  const network = parseNetwork(o.network ?? null)
  let paramsObj: Record<string, unknown> = {}
  if (Array.isArray(o.params)) {
    const first = o.params[0]
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      paramsObj = first as Record<string, unknown>
    }
  } else if (o.params && typeof o.params === 'object') {
    paramsObj = o.params
  }

  if (method === 'submit') {
    const blob = paramsObj.tx_blob
    if (typeof blob !== 'string' || !/^[0-9A-Fa-f]+$/.test(blob) || blob.length < 20) {
      return NextResponse.json({ error: 'Invalid signed tx_blob' }, { status: 400 })
    }
  }

  if (method === 'account_info' || method === 'account_tx') {
    const account = paramsObj.account
    if (typeof account !== 'string' || !/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account)) {
      return NextResponse.json({ error: 'Invalid account address' }, { status: 400 })
    }
  }

  const urls = [
    XRPL_CLASSIC_HTTP[network],
    ...FALLBACK_HTTP[network],
  ].filter((u, i, a) => u && a.indexOf(u) === i)

  let lastErr = 'XRPL classic RPC unavailable'
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'falcon-wallet-xrpl-rpc/1.0',
        },
        body: JSON.stringify({ method, params: [paramsObj] }),
        cache: 'no-store',
      })
      const text = await r.text()
      if (!r.ok) {
        lastErr = `${url}: HTTP ${r.status}`
        continue
      }
      let j: { result?: Record<string, unknown>; error?: unknown }
      try {
        j = JSON.parse(text) as { result?: Record<string, unknown>; error?: unknown }
      } catch {
        lastErr = `${url}: invalid JSON`
        continue
      }
      // Pass through XRPL result (includes actNotFound etc.)
      return NextResponse.json({
        result: j.result ?? null,
        error: j.error ?? null,
        network,
      })
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }

  return NextResponse.json({ error: lastErr }, { status: 502 })
}
