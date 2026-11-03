import { describe, it, expect } from 'vitest'
import {
  generateKeyPair, sign, verify, encodeFalconSecret, keyPairFromFalconSecret,
  build, signTx, verifyTx, txPayload, txId, serializeBody, parseTxJson, keyHash,
  GatewayClient, GatewayError,
} from '../src/index.js'

describe('keys', () => {
  it('generates, signs, verifies, rejects tampering', async () => {
    const kp = await generateKeyPair()
    expect(kp.publicKey.length).toBe(897)
    expect(kp.address).toMatch(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/)
    const sig = await sign('hello', kp)
    expect(await verify('hello', sig, kp.publicKeyHex)).toBe(true)
    expect(await verify('hellp', sig, kp.publicKeyHex)).toBe(false)
    expect(await verify('hello', 'zz', kp.publicKeyHex)).toBe(false)
  })
  it('falcon_secret roundtrip', async () => {
    const kp = await generateKeyPair()
    const s = encodeFalconSecret(kp)
    expect(s.length).toBe((1 + 897 + 1281) * 2)
    expect(s.slice(0, 2)).toBe('fb')
    const back = keyPairFromFalconSecret(s)
    expect(back.publicKeyHex).toBe(kp.publicKeyHex)
    expect(back.address).toBe(kp.address)
  })
})

describe('tx format', () => {
  const c = { account: 'alice', sequence: 7, networkId: 2300 }
  it('payload layout and serde body encoding', () => {
    const t = build.transfer({ ...c, destination: 'bob', amount: 5 })
    expect(txPayload(t)).toBe('pl-tx:v2|alice|7|bob|5|2|2300|{"kind":"pay"}')
    expect(serializeBody({ kind: 'swap_route', token_in: 'FPL', token_out: 'ETH', amount_in: 20000000000000000n, min_out: '1' }))
      .toBe('{"kind":"swap_route","token_in":"FPL","token_out":"ETH","amount_in":20000000000000000,"min_out":1}')
    expect(serializeBody({ kind: 'rail_withdraw', asset: 'BTC', amount: 1, external_to: 'tb1q' }))
      .toBe('{"kind":"rail_withdraw","asset":"BTC","amount":1,"external_to":"tb1q"}')
    expect(serializeBody({ kind: 'place_limit_order', pair: 'FPL/USDC', side: 'buy', price: 1, amount: 2 }))
      .toBe('{"kind":"place_limit_order","pair":"FPL/USDC","side":"buy","price":1,"amount":2}')
    expect(() => build.transfer({ ...c, destination: 'b', amount: 1.5 })).not.toThrow()
    expect(() => txPayload(build.transfer({ ...c, destination: 'b', amount: 1.5 }))).toThrow()
    expect(() => txPayload(build.transfer({ ...c, destination: 'b', amount: (1n << 64n) }))).toThrow()
  })
  it('signs and verifies, u64-exact JSON', async () => {
    const kp = await generateKeyPair()
    const t = build.assetTransfer({ ...c, destination: 'bob', asset: 'ETH', amount: '20000000000000001' })
    const s = await signTx(t, kp)
    expect(s.txId).toBe(txId(t))
    expect(s.json).toContain('"amount":20000000000000001,')
    expect(parseTxJson(s.json).amount).toBe('20000000000000001')
    expect(await verifyTx(s)).toEqual({ ok: true, txId: s.txId })
    expect((await verifyTx(s.json)).ok).toBe(true)
    expect((await verifyTx(s.json.replace('"bob"', '"eve"'))).ok).toBe(false)
    const s2 = await signTx(build.transferToKey({ ...c, destination: 'bob', amount: 1, keyHash: keyHash(kp.publicKey) }), encodeFalconSecret(kp))
    expect((await verifyTx(s2.json)).ok).toBe(true)
  })
})

function mockFetch(responses: { status: number; body: unknown; headers?: Record<string, string> }[]) {
  const calls: { url: string; init: RequestInit }[] = []
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const r = responses.shift()!
    return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers })
  }) as unknown as typeof fetch
  return { f, calls }
}

describe('gateway client', () => {
  it('sends key header, retries 429 with Retry-After', async () => {
    const { f, calls } = mockFetch([
      { status: 429, body: { error: { code: -32005, message: 'rate' } }, headers: { 'retry-after': '1' } },
      { status: 200, body: { jsonrpc: '2.0', id: 1, result: { height: 9 } } },
    ])
    const slept: number[] = []
    const c = new GatewayClient({ apiKey: 'fplk_test', fetch: f, sleep: async (ms) => { slept.push(ms) } })
    expect(await c.status()).toEqual({ height: 9 })
    expect(slept).toEqual([1000])
    expect((calls[0].init.headers as Record<string, string>)['x-api-key']).toBe('fplk_test')
    expect(calls[0].url).toBe('https://rpc.falcon-fpl.com/v1/rpc')
    expect(JSON.stringify(c)).not.toContain('fplk_test')
  })
  it('does not retry a quota 429; maps JSON-RPC errors; bearer', async () => {
    const { f, calls } = mockFetch([
      { status: 429, body: { error: { code: -32005, message: 'quota' } } },
      { status: 200, body: { jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'unknown account' } } },
    ])
    const c = new GatewayClient({ apiKey: 'k', authHeader: 'bearer', fetch: f, sleep: async () => {} })
    await expect(c.status()).rejects.toMatchObject({ status: 429, code: -32005 })
    await expect(c.getAccount('x')).rejects.toBeInstanceOf(GatewayError)
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe('Bearer k')
    expect(String(calls[1].init.body)).toContain('"params":{"account":"x"}')
  })
  it('submitTx sends exact wire JSON', async () => {
    const { f, calls } = mockFetch([{ status: 200, body: { jsonrpc: '2.0', id: 1, result: { msg: 'ok' } } }])
    const c = new GatewayClient({ fetch: f })
    await c.submitTx('{"amount":18446744073709551615}')
    expect(String(calls[0].init.body)).toBe('{"jsonrpc":"2.0","id":1,"method":"fpl_submitTx","params":{"tx":{"amount":18446744073709551615}}}')
  })
})
