// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
// OpenAPI 3.1 contract tests: every documented path has a route, and real handler
// responses validate against the documented response schema for their status code.
import fs from 'node:fs'
import path from 'node:path'
import Ajv2020 from 'ajv/dist/2020'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as h from '@/lib/explorer-api/handlers'
import { setStatusFetcher, setWire } from '@/lib/explorer-api/node'
import { openapi } from '@/lib/explorer-api/openapi'
import { fakeWire, STATUS } from './explorer-api.fixtures'

type Spec = typeof openapi
const spec = JSON.parse(JSON.stringify(openapi)) as Spec & { paths: Record<string, { get: { responses: Record<string, { content?: Record<string, { schema: object }> }> } }> }
const ajv = new Ajv2020({ strict: false, allErrors: true })
ajv.addSchema({ $id: 'spec', components: spec.components })

function validate(pathKey: string, status: number, body: unknown) {
  const res = spec.paths[pathKey]?.get.responses[String(status)]
  expect(res, `${pathKey} documents ${status}`).toBeTruthy()
  const schema = res!.content?.['application/json']?.schema
  if (!schema) return
  const fixed = JSON.parse(JSON.stringify(schema).replaceAll('"#/components/', '"spec#/components/'))
  const v = ajv.compile(fixed)
  const okv = v(body)
  expect(okv, `${pathKey} ${status}: ${ajv.errorsText(v.errors)}`).toBe(true)
}

const R = (p: string) => new Request(`https://falcon-fpl.com${p}`)

describe('OpenAPI document', () => {
  it('is OpenAPI 3.1 with unique operationIds', () => {
    expect(spec.openapi).toBe('3.1.0')
    const ids = Object.values(spec.paths).map((p) => p.get && (p.get as { operationId: string }).operationId)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('every documented path has a route file under src/app/api', () => {
    for (const p of Object.keys(spec.paths)) {
      const rel = p.replace(/^\/v1/, 'v1').replace(/\{(\w+)\}/g, '[$1]')
      const f = path.join(__dirname, '..', 'src/app/api', rel, 'route.ts')
      expect(fs.existsSync(f), `${p} -> ${f}`).toBe(true)
    }
  })
  it('every v1 route file is documented', () => {
    const root = path.join(__dirname, '..', 'src/app/api/v1')
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name === 'route.ts' ? [d] : []))
    const documented = new Set(Object.keys(spec.paths))
    for (const d of walk(root)) {
      const p = '/v1/' + path.relative(root, d).split(path.sep).join('/').replace(/\[(\w+)\]/g, '{$1}')
      expect(documented.has(p.replace(/\/$/, '')), p).toBe(true)
    }
  })
})

describe('responses match the contract', () => {
  beforeAll(() => {
    setStatusFetcher(async () => STATUS)
    setWire(fakeWire('ok'))
  })
  afterAll(() => {
    setStatusFetcher(null)
    setWire(null)
  })

  const cases: [string, () => Promise<Response>][] = [
    ['/v1/health', () => h.health(R('/v1/health'))],
    ['/v1/uptime', () => h.uptime(R('/v1/uptime'))],
    ['/v1/explorer', () => h.getNetwork(R('/v1/explorer'))],
    ['/v1/explorer/blocks', () => h.listBlocks(R('/v1/explorer/blocks?limit=5'))],
    ['/v1/explorer/blocks/latest', () => h.latestBlock(R('/v1/explorer/blocks/latest'))],
    ['/v1/explorer/blocks/{height}', () => h.blockByHeight(R('/x'), '512345')],
    ['/v1/explorer/blocks/{height}', () => h.blockByHeight(R('/x'), '1')],
    ['/v1/explorer/blocks/{height}', () => h.blockByHeight(R('/x'), 'nope')],
    ['/v1/explorer/transactions', () => h.listTransactions(R('/v1/explorer/transactions?account=alice'))],
    ['/v1/explorer/transactions', () => h.listTransactions(R('/v1/explorer/transactions'))],
    ['/v1/explorer/accounts/{account}', () => h.getAccountV1(R('/x'), 'alice')],
    ['/v1/explorer/accounts/{account}', () => h.getAccountV1(R('/x'), 'ghost')],
    ['/v1/explorer/accounts/{account}/balances', () => h.getBalances(R('/x'), 'alice')],
    ['/v1/explorer/accounts/{account}/transactions', () => h.getAccountTxs(R('/x?limit=1'), 'alice')],
    ['/v1/explorer/accounts/{account}/orders', () => h.getAccountOrders(R('/x'), 'alice')],
    ['/v1/explorer/validators', () => h.listValidators(R('/v1/explorer/validators'))],
    ['/v1/explorer/validators/{id}', () => h.getValidator(R('/x'), 'v1')],
    ['/v1/explorer/validators/{id}', () => h.getValidator(R('/x'), 'nobody')],
    ['/v1/explorer/bridge', () => h.getBridge(R('/v1/explorer/bridge'))],
    ['/v1/explorer/orderbook/{pair}', () => h.getOrderBook(R('/x'), 'BTC4-FPL')],
    ['/v1/explorer/orderbook/{pair}/trades', () => h.getPairTrades(R('/x'), 'BTC4-FPL')],
    ['/v1/explorer/trades', () => h.listTrades(R('/v1/explorer/trades?account=alice'))],
  ]
  for (const [p, run] of cases) {
    it(`${p}`, async () => {
      const r = await run()
      validate(p, r.status, await r.json())
    })
  }

  it('inactive / unsupported order book also match the contract', async () => {
    setWire(fakeWire('inactive'))
    let r = await h.getOrderBook(R('/x'), 'BTC4-FPL')
    validate('/v1/explorer/orderbook/{pair}', r.status, await r.json())
    r = await h.listTrades(R('/v1/explorer/trades'))
    validate('/v1/explorer/trades', r.status, await r.json())
    r = await h.getAccountOrders(R('/x'), 'alice')
    validate('/v1/explorer/accounts/{account}/orders', r.status, await r.json())
    setWire(fakeWire('unsupported'))
    r = await h.getOrderBook(R('/x'), 'BTC4-FPL')
    expect(r.status).toBe(501)
    validate('/v1/explorer/orderbook/{pair}', r.status, await r.json())
    setWire(fakeWire('ok'))
  })

  it('node down → 503 matches the contract', async () => {
    setStatusFetcher(async () => { throw new Error('down') })
    const r = await h.getBridge(R('/v1/explorer/bridge'))
    validate('/v1/explorer/bridge', r.status, await r.json())
    const hr = await h.health(R('/v1/health'))
    validate('/v1/health', hr.status, await hr.json())
    setStatusFetcher(async () => STATUS)
  })
})
