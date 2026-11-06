// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { amount, toDecimalString } from '@/lib/explorer-api/amounts'
import * as h from '@/lib/explorer-api/handlers'
import { apiJson, etagOf } from '@/lib/explorer-api/http'
import { accountFromNode, BlockRing, bridgeFromStatus, honestSealTimes, normalizePair, tipBlockFromStatus, txFromNode, validatorsFromStatus } from '@/lib/explorer-api/mappers'
import { classifyBookReply, setStatusFetcher, setWire } from '@/lib/explorer-api/node'
import { decodeCursor, encodeCursor, pageParams, paginate } from '@/lib/explorer-api/pagination'
import { ACCOUNT, fakeWire, STATUS } from './explorer-api.fixtures'

const R = (path: string, init?: RequestInit) => new Request(`https://falcon-fpl.com${path}`, init)

describe('amounts', () => {
  it('formats exact decimal strings without float loss', () => {
    expect(toDecimalString('1234567890123456789', 18)).toBe('1.234567890123456789')
    expect(toDecimalString('1500000', 6)).toBe('1.5')
    expect(toDecimalString(42, 0)).toBe('42')
    expect(toDecimalString('-100', 2)).toBe('-1')
    expect(amount('USDC', 2500000)).toEqual({ asset: 'USDC', raw: '2500000', decimals: 6, value: '2.5' })
  })
})

describe('pagination', () => {
  it('round-trips cursors and pages', () => {
    expect(decodeCursor(encodeCursor(40))).toBe(40)
    expect(decodeCursor('garbage!')).toBeNull()
    const p = pageParams(new URLSearchParams('limit=2'))
    if (typeof p === 'string') throw new Error(p)
    const first = paginate([1, 2, 3, 4, 5], p)
    expect(first.items).toEqual([1, 2])
    const p2 = pageParams(new URLSearchParams(`limit=2&cursor=${first.page.next_cursor}`))
    if (typeof p2 === 'string') throw new Error(p2)
    expect(paginate([1, 2, 3, 4, 5], p2).items).toEqual([3, 4])
    expect(pageParams(new URLSearchParams('limit=0'))).toBeTypeOf('string')
    expect(pageParams(new URLSearchParams('limit=9999'))).toMatchObject({ limit: 100 })
  })
})

describe('http', () => {
  it('sets ETag + CDN headers and answers 304 on If-None-Match', async () => {
    const r1 = apiJson(R('/v1/x'), { a: 1 })
    const etag = r1.headers.get('etag')!
    expect(etag).toBe(etagOf(JSON.stringify({ a: 1 })))
    expect(r1.headers.get('cache-control')).toMatch(/s-maxage=\d+/)
    expect(r1.headers.get('cdn-cache-control')).toMatch(/s-maxage/)
    expect(r1.headers.get('access-control-allow-origin')).toBe('*')
    const r2 = apiJson(R('/v1/x', { headers: { 'if-none-match': etag } }), { a: 1 })
    expect(r2.status).toBe(304)
    expect(await r2.text()).toBe('')
  })
  it('errors are never cached', () => {
    expect(apiJson(null, {}, { status: 503 }).headers.get('cache-control')).toBe('no-store')
  })
})

describe('mappers', () => {
  it('maps accounts with string amounts', () => {
    const a = accountFromNode('alice', ACCOUNT)
    expect(a.balances.map((b) => [b.asset, b.value])).toEqual([['FPL', '1500'], ['ETH', '1.234567890123456789'], ['USDC', '2.5']])
    expect(a.lend_positions[0].debt.value).toBe('1.5')
  })
  it('maps validators with lag and status', () => {
    const v = validatorsFromStatus(STATUS)
    expect(v.map((x) => [x.id, x.status, x.online, x.lag_blocks])).toEqual([
      ['v1', 'bonded', true, 0], ['v2', 'jailed', true, 45], ['v6', 'unbonding', false, null],
    ])
  })
  it('maps bridge rails exactly (18 decimals)', () => {
    expect(bridgeFromStatus(STATUS).rails[0].outstanding.value).toBe('3.5')
  })
  it('normalizes pairs', () => {
    expect(normalizePair('btc4/fpl')).toBe('BTC4-FPL')
    expect(normalizePair('BTC4')).toBe('BTC4-FPL')
    expect(normalizePair('FPL')).toBeNull()
    expect(normalizePair('x;drop')).toBeNull()
  })
  it('block ring keeps newest first and bounded', () => {
    const r = new BlockRing(2)
    const blank = {
      hash: '', state_root: null as string | null, packer: '', tx_count: 0,
      sealed_at: null, sealed_at_ms: null, sealed_at_quality: 'unavailable' as const,
      sealed_utc: null, sealed_utc_ms: null, sealed_utc_quality: 'unavailable',
      sealed_utc_source: 'none' as const, observed_at: '',
    }
    for (const height of [1, 3, 2]) r.remember({ height, ...blank })
    expect(r.list().map((b) => b.height)).toEqual([3, 2])
  })
  it('never treats chain-physics ms as UTC ISO (1970 honesty)', () => {
    // Synthetic physics stamp ~1970-03-14 if wrongly passed to Date()
    const physics = 6_200_000_000
    const b = tipBlockFromStatus(
      { tip_height: 10, tip_hash: 'aa', tip_sealed_at_ms: physics, tip_sealed_utc_ms: 0, tip_sealed_utc_quality: 'unavailable' },
      1_762_000_000_000,
    )
    expect(b.sealed_at).toBeNull()
    expect(b.sealed_utc).toBeNull()
    expect(b.sealed_at_ms).toBe(physics)
    expect(b.sealed_at_quality).toBe('chain_physics')
    expect(b.sealed_utc_source).toBe('none')
    expect(b.observed_at).toBe(new Date(1_762_000_000_000).toISOString())
    // Must not equal Date(physics).toISOString() which is 1970-03-14...
    expect(b.sealed_at).not.toBe(new Date(physics).toISOString())
  })
  it('exposes signed UTC as UTC-quality only when utc_committed', () => {
    const utc = 1_762_000_123_000
    const b = tipBlockFromStatus(
      {
        tip_height: 10, tip_hash: 'aa', tip_sealed_at_ms: 6_200_000_000,
        tip_sealed_utc_ms: utc, tip_sealed_utc_quality: 'utc_committed',
      },
      1_762_000_200_000,
    )
    expect(b.sealed_utc).toBe(new Date(utc).toISOString())
    expect(b.sealed_at).toBe(b.sealed_utc)
    expect(b.sealed_utc_source).toBe('signed_utc_v5')
    expect(b.sealed_at_ms).toBe(6_200_000_000)
    expect(b.sealed_at_quality).toBe('chain_physics')
  })
  it('tx mapper keeps physics raw and omits Date(physics)', () => {
    const tx = txFromNode({ tx_id: 't', height: 1, kind: 'pay', account: 'a', destination: 'b', amount: 1, fee: 1, sealed_at_ms: 6_200_000_000 }, 1_762_000_000_000)
    expect(tx.sealed_at).toBeNull()
    expect(tx.sealed_at_ms).toBe(6_200_000_000)
    expect(tx.sealed_utc_source).toBe('none')
  })
  it('honestSealTimes helper separates observation', () => {
    const h = honestSealTimes({ physicsMs: 100, utcMs: 0, utcQuality: 'unavailable', observedAtMs: 1_700_000_000_000 })
    expect(h.observed_at).toBe(new Date(1_700_000_000_000).toISOString())
    expect(h.sealed_at).toBeNull()
  })
  it('classifies order book replies', () => {
    expect(classifyBookReply({ type: 'order_book', body: {} }).kind).toBe('ok')
    expect(classifyBookReply({ type: 'err', msg: 'order book not active yet' }).kind).toBe('inactive')
    expect(classifyBookReply({ type: 'err', msg: 'bad message' }).kind).toBe('unsupported')
  })
})

describe('handlers', () => {
  beforeEach(() => {
    setStatusFetcher(async () => STATUS)
    setWire(fakeWire('ok'))
  })
  afterEach(() => {
    setStatusFetcher(null)
    setWire(null)
  })

  it('health reports lag and ok', async () => {
    const r = await h.health(R('/v1/health'))
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(j.status).toBe('ok')
    expect(j.node.lag_blocks).toBe(1)
    expect(r.headers.get('cache-control')).toBe('no-store')
  })
  it('health is down (503) when the node is unreachable, without leaking the error', async () => {
    setStatusFetcher(async () => { throw new Error('connect ECONNREFUSED secret-host:1') })
    const r = await h.health(R('/v1/health'))
    expect(r.status).toBe(503)
    expect(await r.text()).not.toMatch(/secret-host/)
  })
  it('blocks/latest and by height', async () => {
    const latest = await (await h.latestBlock(R('/v1/explorer/blocks/latest'))).json()
    expect(latest.height).toBe(512_345)
    expect((await h.blockByHeight(R('/x'), '512345')).status).toBe(200)
    expect((await h.blockByHeight(R('/x'), '999999999')).status).toBe(404)
    expect((await h.blockByHeight(R('/x'), 'abc')).status).toBe(400)
  })
  it('account 404s and validates names', async () => {
    expect((await h.getAccountV1(R('/x'), 'ghost')).status).toBe(404)
    expect((await h.getAccountV1(R('/x'), '../etc')).status).toBe(400)
  })
  it('account transactions paginate', async () => {
    const j = await (await h.getAccountTxs(R('/x?limit=2'), 'alice')).json()
    expect(j.items).toHaveLength(2)
    expect(j.items[0].amount).toMatchObject({ asset: 'ETH', value: '1' })
    expect(j.page.next_cursor).toBeTruthy()
    expect((await h.listTransactions(R('/v1/explorer/transactions'))).status).toBe(400)
  })
  it('order book: active, inactive (empty 200), unsupported (501)', async () => {
    const ok = await (await h.getOrderBook(R('/x'), 'btc4-fpl')).json()
    expect(ok.active).toBe(true)
    expect(ok.asks[0].amount.value).toBe('0.5')
    setWire(fakeWire('inactive'))
    const inactive = await h.getOrderBook(R('/x'), 'BTC4-FPL')
    expect(inactive.status).toBe(200)
    expect(await inactive.json()).toMatchObject({ active: false, activation_height: 800_000, bids: [], asks: [] })
    setWire(fakeWire('unsupported'))
    const r = await h.getPairTrades(R('/x'), 'BTC4-FPL')
    expect(r.status).toBe(501)
    expect((await r.json()).error.code).toBe('not_implemented')
  })
  it('validators filter by status', async () => {
    const j = await (await h.listValidators(R('/x?status=jailed'))).json()
    expect(j.items.map((v: { id: string }) => v.id)).toEqual(['v2'])
  })
  it('cached reads p95 < 200 ms', async () => {
    await h.getNetwork(R('/v1/explorer'))
    const t: number[] = []
    for (let i = 0; i < 200; i++) {
      const s = performance.now()
      await h.listValidators(R('/v1/explorer/validators'))
      t.push(performance.now() - s)
    }
    t.sort((a, b) => a - b)
    expect(t[Math.floor(t.length * 0.95)]).toBeLessThan(200)
  })
})
