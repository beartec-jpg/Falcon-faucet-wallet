import { describe, expect, it, vi, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'

beforeAll(() => {
  process.env.VERCEL = '1'
  delete process.env.KV_REST_API_URL
  delete process.env.UPSTASH_REDIS_REST_URL
})

const SITE = 'https://falcon-fpl.com'
function req(path: string, body: unknown, headers: Record<string, string> = {}, ip = '203.0.113.9') {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return new NextRequest(SITE + path, {
    method: 'POST',
    body: text,
    headers: { host: 'falcon-fpl.com', 'x-forwarded-proto': 'https', 'content-type': 'application/json', 'x-real-ip': ip, ...headers },
  })
}

describe('api-guard', () => {
  it('memory window allows `limit` hits then refuses', async () => {
    const { memHit } = await import('@/lib/api-guard')
    const b = { name: 't', limit: 3, windowSec: 60 }
    expect([1, 2, 3, 4].map(() => memHit(b, 'k', 1000))).toEqual([true, true, true, false])
    expect(memHit(b, 'k', 1000 + 61_000)).toBe(true)
  })
  it('readBodyCapped refuses oversized bodies even without Content-Length', async () => {
    const { readBodyCapped, BodyTooLarge } = await import('@/lib/api-guard')
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(600)); c.enqueue(new Uint8Array(600)); c.close() } })
    const r = new Request('https://x/', { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
    await expect(readBodyCapped(r, 1000)).rejects.toBeInstanceOf(BodyTooLarge)
    expect(await readBodyCapped(new Request('https://x/', { method: 'POST', body: 'abc' }), 1000)).toBe('abc')
  })
})

describe('RPC proxies', () => {
  it('bnb-rpc refuses cross-origin browser requests', async () => {
    // Requests with no Origin/Referer (non-browser clients) pass the shared origin policy;
    // the per-IP rate limit is what bounds those.
    const { POST } = await import('@/app/api/wallet/bnb-rpc/route')
    expect((await POST(req('/api/wallet/bnb-rpc', { method: 'eth_chainId' }, { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await POST(req('/api/wallet/bnb-rpc', { method: 'eth_chainId' }, { referer: 'https://evil.example/x' }))).status).toBe(403)
  })
  it('bnb-rpc caps batch size', async () => {
    const { POST } = await import('@/app/api/wallet/bnb-rpc/route')
    const batch = Array.from({ length: 21 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_chainId' }))
    const r = await POST(req('/api/wallet/bnb-rpc', batch, { origin: SITE }, '203.0.113.20'))
    expect(r.status).toBe(400)
    expect((await POST(req('/api/wallet/bnb-rpc', [], { origin: SITE }, '203.0.113.20'))).status).toBe(400)
  })
  it('xrpl-rpc and btc-proxy refuse cross-origin and oversized bodies', async () => {
    const x = await import('@/app/api/wallet/xrpl-rpc/route')
    const b = await import('@/app/api/wallet/btc-proxy/route')
    expect((await x.POST(req('/api/wallet/xrpl-rpc', { method: 'fee' }, { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await x.POST(req('/api/wallet/xrpl-rpc', 'x'.repeat(130_000), { origin: SITE }, '203.0.113.30'))).status).toBe(413)
    expect((await b.POST(req('/api/wallet/btc-proxy', { op: 'broadcast' }, { origin: 'https://evil.example' }))).status).toBe(403)
    const g = new NextRequest(SITE + '/api/wallet/btc-proxy?op=tx&txid=00', { headers: { host: 'falcon-fpl.com', origin: 'https://evil.example' } })
    expect((await b.GET(g)).status).toBe(403)
  })
  it('rate limits per IP', async () => {
    const { POST } = await import('@/app/api/wallet/xrpl-rpc/route')
    let last = 0
    for (let i = 0; i < 301; i++) {
      // invalid method → 400 without any upstream fetch, but still counts against the bucket
      last = (await POST(req('/api/wallet/xrpl-rpc', { method: 'nope' }, { origin: SITE }, '198.51.100.7'))).status
    }
    expect(last).toBe(429)
  })
})

describe('/api/wallet/submit', () => {
  it('refuses bodies over 64 KiB with 413', async () => {
    const { POST } = await import('@/app/api/wallet/submit/route')
    const r = await POST(req('/api/wallet/submit', { tx_blob: 'A'.repeat(70_000) }, { origin: SITE }, '203.0.113.40'))
    expect(r.status).toBe(413)
  })
})

describe('board', () => {
  it('consumes challenges atomically in one statement', () => {
    const src = readFileSync('src/app/api/board/posts/route.ts', 'utf8')
    expect(src).toMatch(/WITH c AS \(\s*UPDATE board_challenges[\s\S]*consumed_at IS NULL AND expires_at > now\(\)[\s\S]*INSERT INTO board_posts[\s\S]*FROM c/)
    expect(src).not.toMatch(/\n\s*await sql`\s*UPDATE board_challenges/)
  })
  it('rate limits challenge creation per IP', async () => {
    vi.doMock('@/lib/db', () => ({
      isDbConfigured: () => true,
      getSql: () => async () => [{ count: 0, id: '00000000-0000-0000-0000-000000000000', nonce: 'n', expires_at: new Date().toISOString() }],
    }))
    vi.resetModules()
    const { POST } = await import('@/app/api/board/challenge/route')
    const { BUCKETS } = await import('@/lib/api-guard')
    let last = 0
    for (let i = 0; i <= BUCKETS.boardChallengeIp.limit; i++) {
      const addr = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
      last = (await POST(req('/api/board/challenge', { address: addr, body: 'hi ' + i }, { origin: SITE }, '192.0.2.50'))).status
    }
    expect(last).toBe(429)
  })
})
