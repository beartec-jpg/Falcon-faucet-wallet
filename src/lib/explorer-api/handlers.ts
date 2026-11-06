// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
//
// API v1 handlers. Route files under src/app/api/v1 are thin wrappers around these, so the
// same logic can be mounted by a gateway or exercised directly in tests.

import { apiError, apiJson, CACHE, nodeUnavailable } from './http'
import {
  accountFromNode,
  bridgeFromStatus,
  depthFromNode,
  networkFromStatus,
  normalizePair,
  ORDERBOOK_ACTIVATION_HEIGHT,
  ordersFromNode,
  tradesFromNode,
  txFromNode,
  validatorsFromStatus,
} from './mappers'
import { blockRing, bookCall, getAccount, getStatus, nodeCalls, startedAt, tipSeen, type BookResult } from './node'
import { paginate, pageParams } from './pagination'
import { decodeHistoryCursor, type RawFill } from './fill-history'
import { getFillHistoryStore, persistFillHistoryStore } from './fill-history-store'

type Obj = Record<string, unknown>
const ACCOUNT_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

const bad = (req: Request, m: string) => apiError(req, 400, 'bad_request', m)
const sp = (req: Request) => new URL(req.url).searchParams

function validAccount(req: Request, a: string): string | Response {
  const name = decodeURIComponent(a).trim()
  return ACCOUNT_RE.test(name) ? name : bad(req, 'invalid account name')
}

// ---- network / blocks ----------------------------------------------------

export async function getNetwork(req: Request): Promise<Response> {
  try {
    const { body } = await getStatus()
    return apiJson(req, networkFromStatus(body), { cache: CACHE.live })
  } catch (e) {
    return nodeUnavailable(req, 'explorer', e)
  }
}

export async function listBlocks(req: Request): Promise<Response> {
  const p = pageParams(sp(req))
  if (typeof p === 'string') return bad(req, p)
  try {
    await getStatus()
  } catch (e) {
    if (!blockRing.list().length) return nodeUnavailable(req, 'blocks', e)
  }
  const page = paginate(blockRing.list(), p)
  return apiJson(req, { ...page, retention: 'recent tips observed by this API instance' }, { cache: CACHE.live })
}

export async function latestBlock(req: Request): Promise<Response> {
  try {
    await getStatus()
    const b = blockRing.list()[0]
    if (!b) return apiError(req, 404, 'not_found', 'no block observed yet')
    return apiJson(req, b, { cache: CACHE.live })
  } catch (e) {
    return nodeUnavailable(req, 'blocks/latest', e)
  }
}

export async function blockByHeight(req: Request, heightParam: string): Promise<Response> {
  if (!/^\d{1,15}$/.test(heightParam)) return bad(req, 'height must be a non-negative integer')
  const h = Number(heightParam)
  let tip = 0
  try {
    tip = Number((await getStatus()).body.tip_height) || 0
  } catch (e) {
    if (!blockRing.get(h)) return nodeUnavailable(req, 'blocks/:height', e)
  }
  const b = blockRing.get(h)
  if (b) return apiJson(req, b, { cache: h < tip ? CACHE.static : CACHE.live })
  if (tip && h > tip) return apiError(req, 404, 'not_found', `block ${h} is above the tip (${tip})`)
  return apiError(req, 404, 'not_found', `block ${h} is not in the recent-block window; the node has no public block-by-height query`)
}

// ---- accounts / transactions --------------------------------------------

async function withAccount(req: Request, a: string, where: string, f: (name: string, body: Obj) => Response): Promise<Response> {
  const name = validAccount(req, a)
  if (typeof name !== 'string') return name
  try {
    const body = await getAccount(name)
    if (body.exists === false) return apiError(req, 404, 'not_found', `account ${name} not found`)
    return f(name, body)
  } catch (e) {
    return nodeUnavailable(req, where, e)
  }
}

export function getAccountV1(req: Request, a: string) {
  return withAccount(req, a, 'accounts/:account', (n, b) => apiJson(req, accountFromNode(n, b), { cache: CACHE.short }))
}

export function getBalances(req: Request, a: string) {
  return withAccount(req, a, 'accounts/:account/balances', (n, b) => {
    const acct = accountFromNode(n, b)
    return apiJson(req, { account: acct.account, balances: acct.balances, claimable: acct.claimable }, { cache: CACHE.short })
  })
}

export function getAccountTxs(req: Request, a: string) {
  const p = pageParams(sp(req))
  if (typeof p === 'string') return Promise.resolve(bad(req, p))
  return withAccount(req, a, 'accounts/:account/transactions', (n, b) => {
    const all = (Array.isArray(b.recent_txs) ? (b.recent_txs as Obj[]) : []).map(txFromNode)
    return apiJson(req, { account: n, ...paginate(all, p) }, { cache: CACHE.short })
  })
}

export function listTransactions(req: Request) {
  const account = sp(req).get('account')
  if (!account) return Promise.resolve(bad(req, 'account query parameter is required (the node indexes history per account)'))
  return getAccountTxs(req, account)
}

// ---- validators / bridge -------------------------------------------------

export async function listValidators(req: Request): Promise<Response> {
  const q = sp(req)
  const p = pageParams(q, 200)
  if (typeof p === 'string') return bad(req, p)
  const status = q.get('status')
  try {
    const { body } = await getStatus()
    let all = validatorsFromStatus(body)
    if (status) all = all.filter((v) => v.status === status || (status === 'online' && v.online))
    return apiJson(req, paginate(all, p), { cache: CACHE.short })
  } catch (e) {
    return nodeUnavailable(req, 'validators', e)
  }
}

export async function getValidator(req: Request, id: string): Promise<Response> {
  try {
    const { body } = await getStatus()
    const v = validatorsFromStatus(body).find((x) => x.id === decodeURIComponent(id))
    return v ? apiJson(req, v, { cache: CACHE.short }) : apiError(req, 404, 'not_found', 'validator not found')
  } catch (e) {
    return nodeUnavailable(req, 'validators/:id', e)
  }
}

export async function getBridge(req: Request): Promise<Response> {
  try {
    const { body } = await getStatus()
    return apiJson(req, bridgeFromStatus(body), { cache: CACHE.short })
  } catch (e) {
    return nodeUnavailable(req, 'bridge', e)
  }
}

// ---- order book ------------------------------------------------------------

function bookUnavailable(req: Request, r: Exclude<BookResult, { kind: 'ok' }>, empty: Obj): Response {
  if (r.kind === 'inactive') {
    return apiJson(req, { ...empty, active: false, activation_height: ORDERBOOK_ACTIVATION_HEIGHT }, { cache: CACHE.medium })
  }
  return apiError(req, 501, 'not_implemented', 'order book RPC is not available on this node yet')
}

export async function getOrderBook(req: Request, pairParam: string): Promise<Response> {
  const pair = normalizePair(decodeURIComponent(pairParam))
  if (!pair) return bad(req, 'pair must look like <ASSET>-FPL')
  const lv = sp(req).get('levels')
  if (lv != null && !/^\d{1,3}$/.test(lv)) return bad(req, 'levels must be an integer 1-200')
  const levels = Math.min(200, Math.max(1, Number(lv ?? 50)))
  try {
    const r = await bookCall({ type: 'order_book_query', pair, levels })
    if (r.kind !== 'ok') return bookUnavailable(req, r, { pair, bids: [], asks: [] })
    if (r.body.error) return bad(req, String(r.body.error))
    return apiJson(req, { ...depthFromNode(pair, r.body, levels), active: true }, { cache: CACHE.live })
  } catch (e) {
    return nodeUnavailable(req, 'orderbook/:pair', e)
  }
}

async function trades(req: Request, pair: string | null, account: string | null): Promise<Response> {
  const p = pageParams(sp(req))
  if (typeof p === 'string') return bad(req, p)
  try {
    const r = await bookCall({ type: 'fills_query', pair, account, limit: 200 })
    if (r.kind !== 'ok') return bookUnavailable(req, r, { items: [], page: { limit: p.limit, next_cursor: null, total: 0 } })
    return apiJson(req, { ...paginate(tradesFromNode(r.body), p), active: true }, { cache: CACHE.live })
  } catch (e) {
    return nodeUnavailable(req, 'trades', e)
  }
}

export function getPairTrades(req: Request, pairParam: string) {
  const pair = normalizePair(decodeURIComponent(pairParam))
  if (!pair) return Promise.resolve(bad(req, 'pair must look like <ASSET>-FPL'))
  return trades(req, pair, null)
}

export function listTrades(req: Request) {
  const q = sp(req)
  const rawPair = q.get('pair')
  const pair = rawPair ? normalizePair(rawPair) : null
  if (rawPair && !pair) return Promise.resolve(bad(req, 'pair must look like <ASSET>-FPL'))
  const account = q.get('account')
  if (account && !ACCOUNT_RE.test(account)) return Promise.resolve(bad(req, 'invalid account name'))
  return trades(req, pair, account)
}

export async function getAccountOrders(req: Request, a: string): Promise<Response> {
  const name = validAccount(req, a)
  if (typeof name !== 'string') return name
  try {
    const r = await bookCall({ type: 'open_orders_query', account: name })
    if (r.kind !== 'ok') return bookUnavailable(req, r, { account: name, orders: [] })
    return apiJson(req, { account: name, orders: ordersFromNode(r.body), active: true }, { cache: CACHE.short })
  } catch (e) {
    return nodeUnavailable(req, 'accounts/:account/orders', e)
  }
}

// ---- health / uptime -------------------------------------------------------

/** Node lag thresholds: blocks behind best peer, and seconds since the tip last moved. */
export const HEALTH = { maxLagBlocks: 20, maxTipAgeS: 180 }

export async function health(req: Request, now = Date.now()): Promise<Response> {
  const t0 = Date.now()
  try {
    const { body, fetchedAt } = await getStatus(now)
    const height = Number(body.tip_height) || 0
    const lag = Number.isFinite(Number(body.tip_lag)) ? Number(body.tip_lag) : null
    const tipAgeS = tipSeen.at ? Math.max(0, Math.round((now - tipSeen.at) / 1000)) : null
    const online = Array.isArray(body.online_seats) ? body.online_seats.length : 0
    const lagging = lag != null && lag > HEALTH.maxLagBlocks
    const stalled = tipAgeS != null && tipAgeS > HEALTH.maxTipAgeS
    const status = lagging || stalled || online < 4 ? 'degraded' : 'ok'
    return apiJson(
      req,
      {
        status,
        node: {
          reachable: true,
          height,
          lag_blocks: lag,
          tip_age_seconds: tipAgeS,
          online_seats: online,
          version: String(body.product_version ?? '') || null,
          status_age_ms: Math.max(0, now - fetchedAt),
        },
        checks: { lag_ok: !lagging, tip_advancing: !stalled, quorum_ok: online >= 4 },
        thresholds: HEALTH,
        latency_ms: Date.now() - t0,
        time: new Date(now).toISOString(),
      },
      { cache: 'no-store' },
    )
  } catch (e) {
    console.error('[v1/health]', e instanceof Error ? e.message : String(e))
    return apiJson(
      req,
      { status: 'down', node: { reachable: false }, time: new Date(now).toISOString() },
      { status: 503 },
    )
  }
}

export async function uptime(req: Request, now = Date.now()): Promise<Response> {
  let network: Obj = {}
  try {
    const { body } = await getStatus(now)
    const genesis = Number(body.genesis_ms) || 0
    const nodeNow = Number(body.now_ms) || now
    network = {
      genesis: genesis ? new Date(genesis).toISOString() : null,
      uptime_seconds: genesis ? Math.max(0, Math.floor((nodeNow - genesis) / 1000)) : null,
      height: Number(body.tip_height) || 0,
    }
  } catch {
    network = { genesis: null, uptime_seconds: null, height: null }
  }
  const total = nodeCalls.ok + nodeCalls.failed
  return apiJson(
    req,
    {
      network,
      api: {
        instance_started: new Date(startedAt).toISOString(),
        instance_uptime_seconds: Math.floor((now - startedAt) / 1000),
        node_calls: { ok: nodeCalls.ok, failed: nodeCalls.failed, success_ratio: total ? nodeCalls.ok / total : null },
        last_node_ok: nodeCalls.lastOkAt ? new Date(nodeCalls.lastOkAt).toISOString() : null,
      },
      time: new Date(now).toISOString(),
    },
    { cache: CACHE.short },
  )
}


// ---- fill history (P2 durable index; latest200 trades endpoint unchanged) ----

/** GET history page over ingested fills. Does not claim full-chain archive. */
export async function listFillHistory(req: Request): Promise<Response> {
  const q = sp(req)
  const limRaw = q.get('limit')
  if (limRaw != null && !/^\d{1,3}$/.test(limRaw)) return bad(req, 'limit must be 1-100')
  const limit = Math.min(100, Math.max(1, Number(limRaw ?? 50)))
  const cursorRaw = q.get('cursor')
  const cursor = decodeHistoryCursor(cursorRaw)
  if (cursorRaw && !cursor) return bad(req, 'invalid history cursor')
  const rawPair = q.get('pair')
  const pair = rawPair ? normalizePair(rawPair) : null
  if (rawPair && !pair) return bad(req, 'pair must look like <ASSET>-FPL')
  const store = getFillHistoryStore()
  const page = store.page({ limit, cursor, pair })
  return apiJson(
    req,
    {
      items: page.items,
      page: { limit, next_cursor: page.next_cursor, total: page.coverage.fill_count },
      coverage: page.coverage,
      retention: 'ingested fills retained in this API instance (optional dump path); not a chain archive',
      latest200_compat: '/v1/explorer/trades remains the live node RECENT_FILLS ring (≤200)',
    },
    { cache: CACHE.short },
  )
}

/** POST backfill: pull node fills_query (≤200) into the durable index. Idempotent by fill_id. */
export async function backfillFillHistory(req: Request): Promise<Response> {
  const q = sp(req)
  const rawPair = q.get('pair')
  const pair = rawPair ? normalizePair(rawPair) : null
  if (rawPair && !pair) return bad(req, 'pair must look like <ASSET>-FPL')
  try {
    const r = await bookCall({ type: 'fills_query', pair, account: null, limit: 200 })
    if (r.kind !== 'ok') return bookUnavailable(req, r, { added: 0, coverage: getFillHistoryStore().coverage() })
    const fills = Array.isArray(r.body.fills) ? (r.body.fills as RawFill[]) : Array.isArray(r.body.items) ? (r.body.items as RawFill[]) : []
    // Normalize height from node trade shape if needed
    const raws: RawFill[] = fills.map((f: any) => ({
      height: Number(f.height ?? f.ledger_height ?? 0),
      asset: String(f.asset ?? f.base_asset ?? 'FPL'),
      side: String(f.side ?? ''),
      price: f.price,
      base: f.base ?? f.amount,
      quote: f.quote ?? f.total,
      taker: String(f.taker ?? ''),
      maker: String(f.maker ?? ''),
      maker_order: f.maker_order,
      taker_order: f.taker_order,
      sealed_at_ms: f.sealed_at_ms,
      sealed_utc_ms: f.sealed_utc_ms,
      sealed_utc_quality: f.sealed_utc_quality,
      tip_hash: f.tip_hash ?? f.block_hash,
    }))
    const store = getFillHistoryStore()
    const added = store.ingest(raws)
    persistFillHistoryStore()
    return apiJson(
      req,
      {
        added,
        pulled: raws.length,
        coverage: store.coverage(),
        note: 'Backfill sources node RECENT_FILLS ring (≤200). Gaps outside the ring are honest unknowns, not archive holes.',
      },
      { cache: 'no-store' },
    )
  } catch (e) {
    return nodeUnavailable(req, 'fills/history/backfill', e)
  }
}

export async function getFillHistoryCoverage(req: Request): Promise<Response> {
  return apiJson(req, getFillHistoryStore().coverage(), { cache: CACHE.short })
}
