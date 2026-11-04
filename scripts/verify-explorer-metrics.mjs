/**
 * Offline checks for the explorer tx/s estimate and the 24h history ring buffer
 * (src/lib/net-metrics.ts, src/lib/metric-history.ts).
 * Run: node scripts/verify-explorer-metrics.mjs   (no network)
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'node_modules/.cache/verify-explorer-metrics')
fs.mkdirSync(dir, { recursive: true })
function load(name) {
  const src = fs
    .readFileSync(path.join(root, `src/lib/${name}.ts`), 'utf8')
    .replace(/from '@\/lib\/([\w-]+)'/g, "from './$1.mjs'")
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText
  fs.writeFileSync(path.join(dir, `${name}.mjs`), out)
}
load('net-metrics')
load('metric-history')
load('scan-types')
load('netmap-layout')
load('db')
load('scan-watchers')
load('pl-exact-json')
load('rails-pools')
{
  const src = fs.readFileSync(path.join(root, 'src/config/network-map.ts'), 'utf8')
  fs.writeFileSync(path.join(dir, 'network-map.mjs'), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText)
}

// Minimal localStorage for the ring buffer.
const mem = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
}

const nm = await import(pathToFileURL(path.join(dir, 'net-metrics.mjs')).href)
const mh = await import(pathToFileURL(path.join(dir, 'metric-history.mjs')).href)

const scan = (o) => ({
  height: o.h,
  validated_ledger: o.h,
  peers: 9,
  mempool: o.mp ?? 100,
  online_seats: ['v1', 'v3'],
  last_pack: { txs: 50, packer: 'v1', height: o.h },
  metrics: { txs_sealed: o.tx, ledgers_sealed: o.h },
  validators: [
    { account: 'v1', ledger_index: o.h - 2, pack_count: o.p1, jailed: false, perf: 0.99 },
    { account: 'v3', ledger_index: 0, pack_count: 10, jailed: false },
    { account: 'v2', ledger_index: 5, pack_count: 3, jailed: true },
  ],
})

// Rates from counter deltas (numbers from two real /api/scan polls 21.65s apart).
const a = nm.sampleFromScan(scan({ h: 525721, tx: 8969117, p1: 100 }), 1_000_000)
const b = nm.sampleFromScan(scan({ h: 525728, tx: 8969528, p1: 102 }), 1_021_650)
const r = nm.rateBetween(a, b)
assert.ok(Math.abs(r.tps - 411 / 21.65) < 1e-9, 'tps')
assert.ok(Math.abs(r.blocks_min - 7 / (21.65 / 60)) < 1e-9, 'blocks/min')
assert.ok(Math.abs(r.txs_per_block - 411 / 7) < 1e-9, 'txs/block')
assert.equal(nm.rateBetween(b, a), null, 'backwards interval rejected')
const reset = { ...b, t: b.t + 1000, txs_sealed: 5 }
assert.equal(nm.rateBetween(b, reset), null, 'counter reset rejected')

// Seat lag: tip minus advertised tip; null when not advertised.
assert.equal(nm.seatLag(b.height, b.seats[0]), 2)
assert.equal(nm.seatLag(b.height, b.seats[1]), null)
assert.equal(b.seats[2].online, false)
assert.equal(b.seats[2].jailed, true)

// Window rate uses the oldest sample inside the window.
const seq = Array.from({ length: 20 }, (_, i) =>
  nm.sampleFromScan(scan({ h: 1000 + i, tx: 10_000 + i * 80, p1: i }), 4000 * i),
)
const w = nm.windowRate(seq, 60_000)
assert.equal(w.span_ms, 60_000)
assert.ok(Math.abs(w.tps - 20) < 1e-9, '80 tx per 4s = 20 tx/s')
assert.equal(nm.windowRate(seq.slice(0, 1), 60_000), null)

// Series flattening.
const v = nm.seriesValues(a, b)
assert.equal(v.mempool, 100)
assert.equal(v['seat.v1.lag'], 2)
assert.equal(v['seat.v3.lag'], undefined)
assert.ok(Math.abs(v['seat.v1.packs_min'] - 2 / (21.65 / 60)) < 0.01)
assert.equal(nm.parseSeatKey('seat.scottspersonalnode.lag').id, 'scottspersonalnode')
assert.equal(v['seat.v1.tip'], b.height - 2)
assert.equal(v.height, b.height)
assert.equal(v.txs_sealed, b.txs_sealed)
assert.ok(Math.abs(v.mempool_in - v.tps) < 0.01, 'flat mempool: intake = sealed rate')
{
  const grow = { ...b, mempool: a.mempool + 216.5 }
  const g = nm.seriesValues(a, grow)
  assert.ok(Math.abs(g.mempool_in - (411 + 216.5) / 21.65) < 0.01, 'intake counts mempool growth')
}
// Every explorer tile key is a cron/series key.
for (const k of ['tps', 'blocks_min', 'txs_per_block', 'mempool', 'mempool_in', 'peers', 'height', 'txs_sealed', 'min_fee', 'fee_multiplier'])
  assert.ok(nm.NET_KEYS.includes(k) && k in nm.seriesValues(a, b), `series ${k} sampled`)
assert.equal(nm.seriesValues(null, b).tps, undefined, 'no rate without a base')

// Ring buffer: one commit per 60s bucket, rates across the bucket, 24h trim.
const now = Date.now()
const t0 = now - 25 * 3600_000
assert.equal(mh.recordSample({ ...a, t: t0 }), true)
assert.equal(mh.recordSample({ ...b, t: t0 + 30_000 }), false, 'within bucket')
for (let i = 1; i <= 5; i++) {
  const s = nm.sampleFromScan(scan({ h: 2000 + i * 20, tx: 50_000 + i * 1200, p1: i }), now - (6 - i) * 60_000)
  assert.equal(mh.recordSample(s), true)
}
const tps = mh.getClientSeries('tps', now)
// First recent point has no base (gap from t0 > 10 min), the other 4 do.
assert.equal(tps.length, 4)
assert.ok(tps.every((p) => Math.abs(p.v - 20) < 1e-9), '1200 tx / 60s')
assert.ok(mh.getClientSeries('mempool', now).every((p) => p.t >= now - 24 * 3600_000), '24h trim')
assert.equal(mh.getClientSeries('mempool', now).length, 5)

// Merge: sorted, dedupe within 5s.
const m = mh.mergeSeries([{ t: now - 10_000, v: 1 }], [{ t: now - 9_000, v: 2 }, { t: now - 100_000, v: 0 }])
assert.deepEqual(m.map((p) => p.v), [0, 2])

// Network map layout from config.
const lay = await import(pathToFileURL(path.join(dir, 'netmap-layout.mjs')).href)
const { NETWORK_MAP_CONFIG: cfg } = await import(pathToFileURL(path.join(dir, 'network-map.mjs')).href)
const status = ['v1', 'v3', 'v6', 'v10', 'v11', 'v12', 'v13', 'falcon-node', 'scottspersonalnode', 'v99']
  .map((id) => ({ id, online: true }))
  .concat([{ id: 'v2', online: false }])
const L = lay.layoutMap(cfg, status)
assert.equal(L.hub.id, 'v11')
assert.ok(!L.seats.some((s) => s.id === 'v11'), 'hub not duplicated in a group')
assert.equal(L.seats.find((s) => s.id === 'v1').locationId, 'england')
assert.equal(L.seats.find((s) => s.id === 'scottspersonalnode').locationId, 'helsinki')
assert.equal(L.seats.find((s) => s.id === 'v12').confirmed, false, 'Hillsboro still TODO')
assert.equal(L.seats.find((s) => s.id === 'v99').locationId, 'unplaced', 'unknown online seat shown')
assert.ok(!L.seats.some((s) => s.id === 'v2'), 'unknown offline seat hidden by default')
assert.equal(L.wallet.label, 'Wallet services')
assert.deepEqual([L.wallet.pos[0], L.wallet.pos[2]], [L.hub.pos[0], L.hub.pos[2]])
assert.ok(L.wallet.pos[1] > L.hub.pos[1] + 3, 'wallet services above the hub')
const ids = L.seats.map((s) => s.id)
assert.equal(new Set(ids).size, ids.length)
for (let i = 0; i < L.seats.length; i++)
  for (let j = i + 1; j < L.seats.length; j++) {
    const a = L.seats[i].pos, b = L.seats[j].pos
    assert.ok(Math.hypot(a[0] - b[0], a[2] - b[2]) > 1.2, `seats ${ids[i]} / ${ids[j]} overlap`)
  }
assert.equal(lay.bulgeCount(0, 10), 0)
assert.equal(lay.bulgeCount(3, 10), 1)
assert.equal(lay.bulgeCount(5000, 10), 10, 'bulges capped')
assert.equal(lay.ringFill(500, 100), 1)
assert.ok(lay.ringFill(50, 0) === 0.5)

// Watchers: node field preferred; otherwise "live" = watcher_slots rose in the current slot.
{
  const wm = await import(pathToFileURL(path.join(dir, 'scan-watchers.mjs')).href)
  const HOUR = 3600000
  // Shape from falcon2 status at 2026-10-14 09:10 UTC (slot 82, abs 1426).
  const st = (o = {}) => ({
    watcher_slots: { 'watcher-brain': 2, 'watcher-browser': 83, 'watcher-eth-lc': 64, 'watcher-falcon2': 2 },
    watcher_work: { 'watcher-browser': 778, 'watcher-eth-lc': 1188 },
    watcher_current_slot: 82,
    watcher_slot_ms: HOUR,
    watcher_slots_per_epoch: 168,
    genesis_ms: 1000,
    now_ms: 1000 + 1426 * HOUR + 60_000,
    watchers_active_slot: null,
    ...o,
  })
  assert.equal(wm.absoluteSlot(st()), 1426)
  const store = wm.memoryStore()
  wm._resetWatcherCache()
  // First sight: nothing proven live yet.
  const a = await wm.watcherSummary(st(), { store, now: 1, cacheMs: 0 })
  assert.deepEqual(a.epoch_accounts, ['watcher-brain', 'watcher-browser', 'watcher-eth-lc', 'watcher-falcon2'])
  assert.deepEqual(a.live, [])
  assert.equal(a.source, 'slot_counts')
  assert.equal(a.slots['watcher-brain'], 2)
  // Next slot: brain and falcon2 heartbeat (count +1), browser does not.
  const next = st({
    watcher_slots: { 'watcher-brain': 3, 'watcher-browser': 83, 'watcher-eth-lc': 64, 'watcher-falcon2': 3 },
    watcher_current_slot: 83,
    now_ms: 1000 + 1427 * HOUR + 120_000,
  })
  const b = await wm.watcherSummary(next, { store, now: 2, cacheMs: 0 })
  assert.deepEqual(b.live, ['watcher-brain', 'watcher-falcon2'])
  // Later in the same slot, no change: still live.
  const c = await wm.watcherSummary({ ...next, now_ms: next.now_ms + 1_800_000 }, { store, now: 3, cacheMs: 0 })
  assert.deepEqual(c.live, ['watcher-brain', 'watcher-falcon2'])
  // Following slot without a new heartbeat yet: not live; browser beats now.
  const d = await wm.watcherSummary(
    { ...next, watcher_slots: { ...next.watcher_slots, 'watcher-browser': 84 }, watcher_current_slot: 84, now_ms: 1000 + 1428 * HOUR + 5_000 },
    { store, now: 4, cacheMs: 0 },
  )
  assert.deepEqual(d.live, ['watcher-browser'])
  // Epoch reset (counts drop) is not a heartbeat.
  const r = wm.stepWatcherState({ x: { slots: 80, rose_in: 5 } }, { x: 0 }, 6)
  assert.deepEqual(r.live, [])
  // Cache: within 30s of the same slot no store reads.
  let loads = 0
  const counting = { load: async () => (loads++, store.load()), save: store.save }
  wm._resetWatcherCache()
  await wm.watcherSummary(next, { store: counting, now: 10_000 })
  await wm.watcherSummary(next, { store: counting, now: 20_000 })
  assert.equal(loads, 1, 'cached ~30s')
  // Node field (Falcon-PL #97) wins when present.
  const e = await wm.watcherSummary(st({ watchers_active_slot: ['watcher-brain'] }), { store: counting, now: 30_000 })
  assert.deepEqual(e.live, ['watcher-brain'])
  assert.equal(e.source, 'status')
  assert.deepEqual(wm.activeFromStatusField({ slot: 82, accounts: ['a'] }), ['a'])
  assert.deepEqual(wm.activeFromStatusField({ a: true, b: false }), ['a'])
  assert.deepEqual(wm.activeFromStatusField([]), [])
  assert.equal(wm.activeFromStatusField(null), null)
  const ws = nm.sampleFromScan({ ...scan({ h: 1, tx: 1, p1: 1 }), watchers: b }, 5)
  const wv = nm.seriesValues(null, ws)
  assert.equal(wv.watchers_live, 2)
  assert.equal(wv.watchers_epoch, 4)
  const av = nm.seriesValues(null, nm.sampleFromScan({ ...scan({ h: 1, tx: 1, p1: 1 }), wallets: { activated: 968, source: 'status.accounts_count' } }, 5))
  assert.equal(av.wallets_activated, 968)
  assert.equal(nm.seriesValues(null, nm.sampleFromScan(scan({ h: 1, tx: 1, p1: 1 }), 5)).wallets_activated, undefined)
}

// Rails / Pools: exact amounts from the real falcon2 status fixture.
{
  const px = await import(pathToFileURL(path.join(dir, 'pl-exact-json.mjs')).href)
  const rp = await import(pathToFileURL(path.join(dir, 'rails-pools.mjs')).href)
  const body = px.parseExact(fs.readFileSync(path.join(root, 'tests/fixtures/pl-status-rails-pools.json'), 'utf8')).body
  const rails = rp.buildRails(body, {})
  assert.deepEqual(rails.map((r) => r.asset), ['USDC', 'ETH', 'BTC'])
  for (const r of rails) {
    const src = body.rails.find((x) => x.asset === r.asset)
    assert.equal(r.minted, String(src.total_minted), `${r.asset} minted exact`)
    assert.equal(BigInt(r.outstanding), BigInt(r.minted) - BigInt(r.burned), `${r.asset} outstanding`)
  }
  assert.equal(px.formatUnits('330000000000000000', 18), '0.33')
  const pools = rp.buildPools(body, [])
  assert.equal(pools.length, body.defi_pools.length, 'every pool listed')
  for (const p of pools) assert.equal(p.tvl_fpl, Number(p.reserve_a) * 2)
  assert.equal(rp.inferSwaps([]).length, 0)
}

console.log('verify-explorer-metrics: ok')
