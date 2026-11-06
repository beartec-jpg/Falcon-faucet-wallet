// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
//
// OpenAPI 3.1 description of the Falcon PL explorer API v1. Served at /v1/openapi.json and
// used by the contract tests to validate real handler responses.

import { API_VERSION } from './http'

const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` })
const str = { type: 'string' }
const int = { type: 'integer' }
const nullable = (t: string) => ({ type: [t, 'null'] })

const json = (schema: object) => ({ 'application/json': { schema } })
const ok = (schema: object, description = 'OK') => ({
  description,
  headers: { ETag: { $ref: '#/components/headers/ETag' }, 'Cache-Control': { $ref: '#/components/headers/CacheControl' } },
  content: json(schema),
})
const err = (description: string) => ({ description, content: json(ref('Error')) })
const common = {
  '304': { description: 'Not modified (If-None-Match matched the ETag)' },
  '400': err('Bad request'),
  '503': err('Node unavailable'),
}
const page = (item: object, extra: Record<string, object> = {}) => ({
  type: 'object',
  required: ['items', 'page'],
  properties: { items: { type: 'array', items: item }, page: ref('PageInfo'), ...extra },
})
const pageParams = [{ $ref: '#/components/parameters/limit' }, { $ref: '#/components/parameters/cursor' }]
const accountParam = { name: 'account', in: 'path', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$' } }
const pairParam = { name: 'pair', in: 'path', required: true, schema: { type: 'string', examples: ['BTC4-FPL'] } }
const op = (operationId: string, tags: string[], summary: string, responses: object, parameters: object[] = []) => ({
  get: { operationId, tags, summary, parameters, responses },
})

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Falcon PL Explorer API',
    version: API_VERSION,
    description:
      'Public read-only explorer/indexer API for Falcon PL (network 2300). Amounts are objects with a base-unit `raw` string, ' +
      '`decimals` and an exact decimal `value` string. List endpoints use opaque cursor pagination. Every 200 carries a weak ETag; ' +
      'send If-None-Match to get 304. Cache-Control / CDN-Cache-Control are tuned per endpoint.',
    license: { name: 'Proprietary (BEARTEC)', identifier: 'LicenseRef-BEARTEC-Proprietary' },
    contact: { name: 'BEARTEC', url: 'https://falcon-fpl.com' },
  },
  servers: [{ url: 'https://falcon-fpl.com', description: 'Production' }],
  tags: [{ name: 'explorer' }, { name: 'orderbook' }, { name: 'health' }],
  paths: {
    '/v1/health': {
      get: {
        operationId: 'getHealth', tags: ['health'], summary: 'Node health and lag (never cached)',
        responses: { '200': ok(ref('Health')), '503': { description: 'Node unreachable', content: json(ref('HealthDown')) } },
      },
    },
    '/v1/uptime': op('getUptime', ['health'], 'Network and API instance uptime', { '200': ok(ref('Uptime')), '304': common['304'] }),
    '/v1/explorer': op('getNetwork', ['explorer'], 'Network overview', { '200': ok(ref('Network')), '304': common['304'], '503': common['503'] }),
    '/v1/explorer/blocks': op('listBlocks', ['explorer'], 'Recent blocks (newest first)', { '200': ok(page(ref('Block'), { retention: str })), ...common }, pageParams),
    '/v1/explorer/blocks/latest': op('getLatestBlock', ['explorer'], 'Current tip block', { '200': ok(ref('Block')), '304': common['304'], '404': err('No block yet'), '503': common['503'] }),
    '/v1/explorer/blocks/{height}': op('getBlock', ['explorer'], 'Block by height (recent window)', { '200': ok(ref('Block')), ...common, '404': err('Not in window / above tip') }, [
      { name: 'height', in: 'path', required: true, schema: { type: 'string', pattern: '^\\d{1,15}$' } },
    ]),
    '/v1/explorer/transactions': op('listTransactions', ['explorer'], 'Transactions for an account', { '200': ok(ref('AccountTxPage')), ...common, '404': err('Account not found') }, [
      { name: 'account', in: 'query', required: true, schema: str }, ...pageParams,
    ]),
    '/v1/explorer/accounts/{account}': op('getAccount', ['explorer'], 'Account summary', { '200': ok(ref('Account')), ...common, '404': err('Account not found') }, [accountParam]),
    '/v1/explorer/accounts/{account}/balances': op('getBalances', ['explorer'], 'Account balances', { '200': ok(ref('Balances')), ...common, '404': err('Account not found') }, [accountParam]),
    '/v1/explorer/accounts/{account}/transactions': op('getAccountTransactions', ['explorer'], 'Account transactions (recent)', { '200': ok(ref('AccountTxPage')), ...common, '404': err('Account not found') }, [accountParam, ...pageParams]),
    '/v1/explorer/accounts/{account}/orders': op('getAccountOrders', ['orderbook'], 'Open orders for an account', { '200': ok(ref('AccountOrders')), ...common, '501': err('Order book RPC not available') }, [accountParam]),
    '/v1/explorer/validators': op('listValidators', ['explorer'], 'Validators', { '200': ok(page(ref('Validator'))), ...common }, [
      ...pageParams, { name: 'status', in: 'query', schema: { type: 'string', enum: ['bonded', 'jailed', 'unbonding', 'online'] } },
    ]),
    '/v1/explorer/validators/{id}': op('getValidator', ['explorer'], 'One validator', { '200': ok(ref('Validator')), '304': common['304'], '404': err('Not found'), '503': common['503'] }, [
      { name: 'id', in: 'path', required: true, schema: str },
    ]),
    '/v1/explorer/bridge': op('getBridge', ['explorer'], 'Bridge rail stats', { '200': ok(ref('Bridge')), '304': common['304'], '503': common['503'] }),
    '/v1/explorer/orderbook/{pair}': op('getOrderBook', ['orderbook'], 'Order book depth for a pair', { '200': ok(ref('OrderBook')), ...common, '501': err('Order book RPC not available') }, [
      pairParam, { name: 'levels', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
    ]),
    '/v1/explorer/orderbook/{pair}/trades': op('getPairTrades', ['orderbook'], 'Recent trades for a pair', { '200': ok(ref('TradePage')), ...common, '501': err('Order book RPC not available') }, [pairParam, ...pageParams]),
    '/v1/explorer/trades': op('listTrades', ['orderbook'], 'Recent trades (optionally filtered)', { '200': ok(ref('TradePage')), ...common, '501': err('Order book RPC not available') }, [
      { name: 'pair', in: 'query', schema: str }, { name: 'account', in: 'query', schema: str }, ...pageParams,
    ]),
    '/v1/openapi.json': op('getOpenApi', ['health'], 'This document', { '200': { description: 'OpenAPI 3.1 document', content: json({ type: 'object' }) } }),
  },
  components: {
    headers: {
      ETag: { description: 'Weak entity tag', schema: str },
      CacheControl: { description: 'Browser + shared cache policy', schema: str },
    },
    parameters: {
      limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
      cursor: { name: 'cursor', in: 'query', description: 'Opaque cursor from page.next_cursor', schema: str },
    },
    schemas: {
      Error: {
        type: 'object', required: ['error'],
        properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string', enum: ['bad_request', 'not_found', 'not_implemented', 'node_unavailable', 'internal'] }, message: str } } },
      },
      Amount: {
        type: 'object', required: ['asset', 'raw', 'decimals', 'value'], additionalProperties: false,
        properties: { asset: str, raw: { type: 'string', pattern: '^-?\\d+$' }, decimals: { type: 'integer', minimum: 0 }, value: { type: 'string', pattern: '^-?\\d+(\\.\\d+)?$' } },
      },
      PageInfo: { type: 'object', required: ['limit', 'next_cursor', 'total'], properties: { limit: int, next_cursor: nullable('string'), total: int } },
      Block: {
        type: 'object', required: ['height', 'hash', 'packer', 'tx_count', 'observed_at'],
        properties: {
          height: int, hash: str, state_root: nullable('string'), packer: str, tx_count: int,
          sealed_at: nullable('string'),
          sealed_at_ms: nullable('integer'),
          sealed_at_quality: { type: 'string', enum: ['chain_physics', 'unavailable'] },
          sealed_utc: nullable('string'),
          sealed_utc_ms: nullable('integer'),
          sealed_utc_quality: str,
          sealed_utc_source: { type: 'string', enum: ['signed_utc_v5', 'none'] },
          observed_at: { type: 'string', format: 'date-time' },
        },
      },
      Tx: {
        type: 'object', required: ['tx_id', 'height', 'kind', 'account', 'amount', 'fee'],
        properties: {
          tx_id: str, height: int, kind: str, account: str, destination: nullable('string'), amount: ref('Amount'), fee: ref('Amount'),
          sealed_at: nullable('string'), sealed_at_ms: nullable('integer'),
          sealed_at_quality: { type: 'string', enum: ['chain_physics', 'unavailable'] },
          sealed_utc: nullable('string'), sealed_utc_ms: nullable('integer'),
          sealed_utc_quality: str, sealed_utc_source: { type: 'string', enum: ['signed_utc_v5', 'none'] },
          chain: str, address: str,
        },
      },
      AccountTxPage: { ...page(ref('Tx'), { account: str }), required: ['account', 'items', 'page'] },
      Account: {
        type: 'object', required: ['account', 'exists', 'sequence', 'balances', 'claimable'],
        properties: {
          account: str, exists: { type: 'boolean' }, sequence: int, account_type: nullable('string'), name_status: nullable('string'), vault_locked: { type: 'boolean' },
          balances: { type: 'array', items: ref('Amount') }, claimable: ref('Amount'),
          lp_positions: { type: 'array', items: { type: 'object', properties: { pool_id: str, lp: str, asset_a: str, asset_b: str } } },
          lend_positions: { type: 'array', items: { type: 'object', properties: { market_id: str, asset: str, shares: str, debt: ref('Amount'), collateral: ref('Amount') } } },
        },
      },
      Balances: { type: 'object', required: ['account', 'balances', 'claimable'], properties: { account: str, balances: { type: 'array', items: ref('Amount') }, claimable: ref('Amount') } },
      Validator: {
        type: 'object', required: ['id', 'status', 'online', 'bond', 'pack_count'],
        properties: {
          id: str, status: { type: 'string', enum: ['bonded', 'jailed', 'unbonding'] }, online: { type: 'boolean' }, bond: ref('Amount'), pack_count: int,
          last_advertised_tip: int, lag_blocks: nullable('integer'), perf: nullable('number'), pong_age_ms: nullable('number'), lottery_ready: { type: 'boolean' },
        },
      },
      Bridge: {
        type: 'object', required: ['rails'],
        properties: {
          rails: {
            type: 'array',
            items: {
              type: 'object', required: ['asset', 'total_minted', 'total_burned', 'outstanding'],
              properties: { asset: str, tip_height: int, tip_hash: str, total_minted: ref('Amount'), total_burned: ref('Amount'), outstanding: ref('Amount'), min_confirmations: int, open_withdrawals: int },
            },
          },
        },
      },
      Network: {
        type: 'object', required: ['product', 'network_id', 'height', 'state', 'peers', 'treasury'],
        properties: {
          product: str, ticker: str, network_id: int, version: nullable('string'), height: int, tip_hash: str, state: { type: 'string', enum: ['live', 'degraded'] },
          peers: int, commit: str, online_seats: { type: 'array', items: str }, mempool: int, accounts: nullable('integer'), treasury: ref('Amount'), epoch: int,
          totals: { type: 'object', properties: { ledgers_sealed: int, txs_sealed: int, fees_burned: ref('Amount') } }, committee: { type: 'object' },
        },
      },
      BookLevel: { type: 'object', required: ['price', 'amount', 'total', 'orders'], properties: { price: ref('Amount'), amount: ref('Amount'), total: ref('Amount'), orders: int } },
      OrderBook: {
        type: 'object', required: ['pair', 'bids', 'asks', 'active'],
        properties: { pair: str, bids: { type: 'array', items: ref('BookLevel') }, asks: { type: 'array', items: ref('BookLevel') }, active: { type: 'boolean' }, activation_height: int },
      },
      Trade: {
        type: 'object', required: ['height', 'pair', 'side', 'price', 'amount', 'total', 'taker', 'maker'],
        properties: { height: int, pair: str, side: str, price: ref('Amount'), amount: ref('Amount'), total: ref('Amount'), taker: str, maker: str, maker_order: nullable('integer') },
      },
      TradePage: { ...page(ref('Trade'), { active: { type: 'boolean' }, activation_height: int }), required: ['items', 'page', 'active'] },
      Order: {
        type: 'object', required: ['id', 'pair', 'side', 'price', 'amount', 'remaining'],
        properties: { id: int, pair: str, side: str, owner: str, price: ref('Amount'), amount: ref('Amount'), remaining: ref('Amount'), placed_height: int, expiry_height: nullable('integer') },
      },
      AccountOrders: { type: 'object', required: ['account', 'orders', 'active'], properties: { account: str, orders: { type: 'array', items: ref('Order') }, active: { type: 'boolean' }, activation_height: int } },
      Health: {
        type: 'object', required: ['status', 'node', 'checks', 'time'],
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded'] },
          node: { type: 'object', required: ['reachable', 'height', 'lag_blocks'], properties: { reachable: { const: true }, height: int, lag_blocks: nullable('integer'), tip_age_seconds: nullable('integer'), online_seats: int, version: nullable('string'), status_age_ms: int } },
          checks: { type: 'object', properties: { lag_ok: { type: 'boolean' }, tip_advancing: { type: 'boolean' }, quorum_ok: { type: 'boolean' } } },
          thresholds: { type: 'object' }, latency_ms: int, time: str,
        },
      },
      HealthDown: { type: 'object', required: ['status', 'node'], properties: { status: { const: 'down' }, node: { type: 'object', properties: { reachable: { const: false } } }, time: str } },
      Uptime: {
        type: 'object', required: ['network', 'api', 'time'],
        properties: {
          network: { type: 'object', properties: { genesis: nullable('string'), uptime_seconds: nullable('integer'), height: nullable('integer') } },
          api: { type: 'object', required: ['instance_started', 'instance_uptime_seconds'], properties: { instance_started: str, instance_uptime_seconds: int, node_calls: { type: 'object' }, last_node_ok: nullable('string') } },
          time: str,
        },
      },
    },
  },
} as const
