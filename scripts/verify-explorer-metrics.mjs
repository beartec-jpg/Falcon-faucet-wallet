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

console.log('verify-explorer-metrics: ok')
