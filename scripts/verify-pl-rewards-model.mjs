/**
 * Offline checks for src/lib/pl-rewards-model.ts (mirror of economy.rs settle_epoch).
 * Run: node scripts/verify-pl-rewards-model.mjs   (no network, no wallet)
 * Same vectors as Falcon-PL docs/ops/tools/test_pl_rewards_check.py.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = fs.readFileSync(path.join(root, 'src/lib/pl-rewards-model.ts'), 'utf8')
const out = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText
const dir = path.join(root, 'node_modules/.cache/verify-pl-rewards-model')
fs.mkdirSync(dir, { recursive: true })
const file = path.join(dir, 'pl-rewards-model.mjs')
fs.writeFileSync(file, out)
const m = await import(pathToFileURL(file).href)

const base = {
  treasury: 196_000_000_000n,
  emissionBps: 30n,
  epochClaimable: true,
  ammLp: { dave: 9n, sally: 1n },
  lendLp: {},
  watcherWork: { w1: 168n },
  watcherSlots: { w1: 168n },
  packTxs: { v1: 3n, v2: 1n },
  eligibleValidators: ['v1', 'v2'],
}

// Emission matrix: 0.30% of 196B, 55/5/20/20, caps 0.5% and 0.05%.
let p = m.projectSettle(base)
assert.equal(p.emit, 588_000_000n)
assert.equal(p.buckets.validators, 323_400_000n)
assert.equal(p.buckets.watchers, 29_400_000n)
assert.equal(p.buckets.amm, 117_600_000n)
assert.equal(p.buckets.lend, 117_600_000n)
assert.equal(p.lpCap, 2_940_000n)
assert.equal(p.watcherCap, 294_000n)
// Capped payouts; unpaid caps flow to the validator pot.
assert.equal(p.ammPays.dave, 2_940_000n)
assert.equal(p.ammPays.sally, 2_940_000n)
assert.equal(p.watcherPays.w1, 294_000n)
const pot = 323_400_000n + (117_600_000n - 5_880_000n) + 117_600_000n + (29_400_000n - 294_000n)
assert.equal(p.validatorPot, pot)
assert.equal(p.packHalf + p.checkHalf, pot)
assert.equal(p.validatorPays.v1, (p.packHalf * 3n) / 4n + p.checkHalf / 2n)

// Watcher dust: weight = work × slots / 168 floors to 0 → no pay.
p = m.projectSettle({ ...base, watcherWork: { w1: 1n }, watcherSlots: { w1: 100n } })
assert.deepEqual(p.watcherPays, {})

// Not claimable → nothing emitted.
p = m.projectSettle({ ...base, epochClaimable: false })
assert.equal(p.emit, 0n)

// Big u64 weights survive parsing.
const j = m.parseBigJson('{"lend_lp_weights":{"dave":20000000010020000},"x":[12345678901234567]}')
assert.equal(m.big(j.lend_lp_weights.dave), 20_000_000_010_020_000n)
assert.equal(m.big(j.x[0]), 12_345_678_901_234_567n)

// 30 bps per 7-day epoch ≈ 14.5% of the remaining treasury per year.
const y = m.emissionPctPerYear(30, 604_800_000)
assert.ok(y > 14.4 && y < 14.7, `yearly ${y}`)
assert.equal(m.settleEtaMs(8, 604_800_000, 1000, 4_715_450_800), 1000 + 8 * 604_800_000 - 4_715_450_800)

console.log('verify-pl-rewards-model: OK')
