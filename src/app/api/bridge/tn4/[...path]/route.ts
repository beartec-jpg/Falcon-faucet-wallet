import { NextRequest, NextResponse } from 'next/server'
import { walletApiAuthHeaders } from '@/lib/walletd'

// Proxy to the lead operator's bridge intake (testnet4 design test). The intake holds no
// user keys or coins; it coordinates the operators' presigning ceremony.
const BASE = (process.env.FPL_BRIDGE_INTAKE_URL || '').replace(/\/$/, '')
const ALLOWED = /^v1\/(info|faucet|deposits|deposits\/[0-9a-f]{16}|deposits\/[0-9a-f]{16}\/signatures)$/

async function forward(req: NextRequest, path: string[], method: 'GET' | 'POST') {
  const p = path.join('/')
  if (!BASE) return NextResponse.json({ error: 'bridge intake not configured' }, { status: 503 })
  if (!ALLOWED.test(p)) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (method === 'POST' && !/^v1\/(faucet|deposits(\/[0-9a-f]{16}\/signatures)?)$/.test(p)) {
    return NextResponse.json({ error: 'method not allowed' }, { status: 405 })
  }
  const qs = req.nextUrl.search
  const body = method === 'POST' ? await req.text() : undefined
  if (body && body.length > 256_000) return NextResponse.json({ error: 'too large' }, { status: 413 })
  try {
    const r = await fetch(`${BASE}/${p}${qs}`, {
      method,
      headers: { 'content-type': 'application/json', ...walletApiAuthHeaders() },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    })
    return new NextResponse(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } })
  } catch {
    return NextResponse.json({ error: 'bridge intake unreachable' }, { status: 502 })
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path, 'GET')
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path, 'POST')
}
