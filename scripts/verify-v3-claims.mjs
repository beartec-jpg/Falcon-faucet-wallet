/**
 * Offline checks for src/lib/pl-v3-claims.ts (V2/V3 take() routing + V3 refund helpers).
 * Run: node scripts/verify-v3-claims.mjs   (no network, no wallet)
 *
 * The TS module is transpiled with the repo's own `typescript` into node_modules/.cache so
 * its `ethers` import resolves from this repo.
 * V2 address = this site's configured FalconQcBridgeV2. The V3 address below is SYNTHETIC:
 * FalconQcBridgeV3 is not deployed.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = fs.readFileSync(path.join(root, 'src/lib/pl-v3-claims.ts'), 'utf8')
const out = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText
const dir = path.join(root, 'node_modules/.cache/verify-v3-claims')
fs.mkdirSync(dir, { recursive: true })
const file = path.join(dir, 'pl-v3-claims.mjs')
fs.writeFileSync(file, out)
const m = await import(pathToFileURL(file).href)

const cfgJson = JSON.parse(fs.readFileSync(path.join(root, 'public/config/pl-2300-bridge.json'), 'utf8'))
const V2 = cfgJson.sepolia.legacy_qc_v2
assert.match(V2, /^0x[a-fA-F0-9]{40}$/)
const SYNTHETIC_V3 = '0x' + '3a'.repeat(20)
const OTHER = '0x' + 'cd'.repeat(20)

let n = 0
const t = (name, fn) => {
  fn()
  n++
  console.log('ok -', name)
}

t('walletd without routing fields = V2', () => {
  assert.deepEqual(m.resolveTakeBridge({}, V2, SYNTHETIC_V3), { bridge: V2, version: 'v2' })
})
t('v2 answer stays on V2 even when V3 is configured (no fallback)', () => {
  assert.deepEqual(m.resolveTakeBridge({ bridge: V2.toLowerCase(), bridgeVersion: 'v2' }, V2, SYNTHETIC_V3), {
    bridge: V2,
    version: 'v2',
  })
})
t('v2 with a different address is refused', () => {
  assert.throws(() => m.resolveTakeBridge({ bridge: OTHER, bridgeVersion: 'v2' }, V2, SYNTHETIC_V3), /V2 bridge/)
})
t('v3 answer uses the configured V3', () => {
  assert.deepEqual(m.resolveTakeBridge({ bridge: SYNTHETIC_V3, bridgeVersion: 'v3' }, V2, SYNTHETIC_V3), {
    bridge: SYNTHETIC_V3,
    version: 'v3',
  })
})
t('v3 while the site has no V3 address is refused', () => {
  assert.throws(() => m.resolveTakeBridge({ bridge: SYNTHETIC_V3, bridgeVersion: 'v3' }, V2, null), /not configured/)
})
t('v3 naming an unknown address is refused', () => {
  assert.throws(() => m.resolveTakeBridge({ bridge: OTHER, bridgeVersion: 'v3' }, V2, SYNTHETIC_V3), /V3 bridge/)
})
t('partial routing (only one of bridge / bridgeVersion) is refused', () => {
  assert.throws(() => m.resolveTakeBridge({ bridgeVersion: 'v2' }, V2, SYNTHETIC_V3), /partial/)
  assert.throws(() => m.resolveTakeBridge({ bridgeVersion: 'v3' }, V2, SYNTHETIC_V3), /partial/)
  assert.throws(() => m.resolveTakeBridge({ bridge: V2 }, V2, SYNTHETIC_V3), /partial/)
  assert.throws(() => m.resolveTakeBridge({ bridge: SYNTHETIC_V3 }, V2, SYNTHETIC_V3), /partial/)
})
t('unknown version / malformed address are refused', () => {
  assert.throws(() => m.resolveTakeBridge({ bridge: SYNTHETIC_V3, bridgeVersion: 'v4' }, V2, SYNTHETIC_V3), /unknown bridgeVersion/)
  assert.throws(() => m.resolveTakeBridge({ bridge: '0x1234', bridgeVersion: 'v2' }, V2, SYNTHETIC_V3), /malformed/)
})
t('openClaimDone: fresh tx or alreadyOpen, then take() on the returned bridge', () => {
  const tx = '0x' + '11'.repeat(32)
  assert.equal(m.openClaimDone(true, { ok: true, tx, bridge: V2, bridgeVersion: 'v2' }), true)
  // walletd (Falcon-PL #38): already open on that bridge, nothing sent.
  const already = { ok: true, tx: '', alreadyOpen: true, bridge: SYNTHETIC_V3, bridgeVersion: 'v3' }
  assert.equal(m.openClaimDone(true, already), true)
  assert.deepEqual(m.resolveTakeBridge(already, V2, SYNTHETIC_V3), { bridge: SYNTHETIC_V3, version: 'v3' })
  assert.equal(m.openClaimDone(true, { ok: true, tx: '' }), false)
  assert.equal(m.openClaimDone(false, { ok: false, waiting: true, alreadyOpen: true }), false)
  assert.equal(m.openClaimDone(true, { ok: false, alreadyOpen: true }), false)
  assert.equal(m.openClaimDone(true, { waiting: true, tx }), false)
})
t('alreadyOpen: taken → skip, not taken → take, unknown → read claims(note)', () => {
  assert.equal(m.takeActionAfterOpen({}), 'take') // fresh openClaim tx
  assert.equal(m.takeActionAfterOpen({ alreadyOpen: true, taken: true, dest: OTHER }), 'skip')
  assert.equal(m.takeActionAfterOpen({ alreadyOpen: true, taken: true }), 'read') // no dest: check on chain
  assert.equal(m.takeActionAfterOpen({ alreadyOpen: true, taken: false, dest: OTHER }), 'take')
  // No dest: re-read claims(note) so the on-chain dest is checked before take().
  assert.equal(m.takeActionAfterOpen({ alreadyOpen: true, taken: false }), 'read')
  assert.equal(m.takeActionAfterOpen({ alreadyOpen: true, taken: false, dest: ' ' }), 'read')
  assert.equal(m.takeActionAfterOpen({ alreadyOpen: true }), 'read')
  assert.equal(m.takeActionAfterOpen({ alreadyOpen: true, taken: 'yes' }), 'read')
})
t('taken:true from walletd is confirmed on chain before "already paid"', () => {
  // walletd says taken, but takeAfterOpen always reads claims(note) for 'skip' (and 'read').
  assert.equal(m.takeActionAfterOpen({ alreadyOpen: true, taken: true, dest: OTHER }), 'skip')
  // Chain agrees: already paid (only now may the resume record be cleared).
  assert.equal(m.checkClaimForTake({ dest: OTHER, open: false, taken: true }, OTHER), 'taken')
  // Bad walletd reply: chain says still open, not taken -> take() as normal.
  assert.equal(m.checkClaimForTake({ dest: OTHER, open: true, taken: false }, OTHER), 'take')
  // Chain says it pays someone else: refuse.
  assert.throws(() => m.checkClaimForTake({ dest: SYNTHETIC_V3, open: true, taken: false }, OTHER), /only that address/)
  // Recorded but neither open nor taken: refuse.
  assert.throws(() => m.checkClaimForTake({ dest: OTHER, open: false, taken: false }, OTHER), /Claim not open/)
})
t('missing claim (dest 0x0) is "claim not open", not "pays 0x000…"', () => {
  const zero = '0x' + '00'.repeat(20)
  assert.throws(() => m.checkClaimForTake({ dest: zero, open: false, taken: false }, OTHER), /Claim not open/)
  assert.throws(() => m.checkClaimForTake({ dest: '', open: false, taken: false }, OTHER), /Claim not open/)
  assert.throws(() => m.assertClaimDest(zero, OTHER), /Claim not open/)
  try {
    m.checkClaimForTake({ dest: zero, open: false, taken: false }, OTHER)
  } catch (e) {
    assert.doesNotMatch(String(e.message), /pays 0x0/)
  }
})
t('assertClaimDest: only the recorded dest may take()', () => {
  m.assertClaimDest(undefined, OTHER)
  m.assertClaimDest(OTHER.toUpperCase().replace('0X', '0x'), OTHER)
  assert.throws(() => m.assertClaimDest(SYNTHETIC_V3, OTHER), /only that address/)
  assert.throws(() => m.assertClaimDest('0x12', OTHER), /malformed/)
})
t('V2 must be the configured legacy_qc_v2: no fallback to sepolia.bridge', () => {
  const cfg = (legacy_qc_v2) => ({ sepolia: { bridge: OTHER, legacy_qc_v2 } })
  assert.equal(m.qcV2Bridge(cfg(V2)), V2)
  assert.equal(m.qcV2Bridge(cfg(undefined)), null)
  assert.equal(m.qcV2Bridge(cfg('0x1234')), null)
  assert.equal(m.qcV2Bridge(cfgJson), V2)
  for (const resp of [{}, { bridge: V2, bridgeVersion: 'v2' }, { bridge: OTHER, bridgeVersion: 'v2' }]) {
    assert.throws(() => m.resolveTakeBridge(resp, null, SYNTHETIC_V3), /legacy_qc_v2 is not configured/)
  }
  // V3 answers do not need V2.
  assert.deepEqual(m.resolveTakeBridge({ bridge: SYNTHETIC_V3, bridgeVersion: 'v3' }, null, SYNTHETIC_V3).bridge, SYNTHETIC_V3)
})
t('qcV3Bridge: config, env fallback, invalid', () => {
  const cfg = (qc_v3) => ({ sepolia: { qc_v3 } })
  assert.equal(m.qcV3Bridge(cfg(SYNTHETIC_V3), ''), SYNTHETIC_V3)
  assert.equal(m.qcV3Bridge(cfg(undefined), ''), null)
  assert.equal(m.qcV3Bridge(cfg(''), SYNTHETIC_V3), SYNTHETIC_V3)
  assert.equal(m.qcV3Bridge(cfg('0x12'), 'nope'), null)
  assert.equal(m.qcV3Bridge(cfgJson, ''), null, 'public config must not name a V3 bridge before deploy')
})
t('0x0 bridge address counts as unset, never as a configured bridge', () => {
  const ZERO = '0x' + '0'.repeat(40)
  assert.equal(m.qcV3Bridge({ sepolia: { qc_v3: ZERO } }, ''), null)
  assert.equal(m.qcV3Bridge({ sepolia: {} }, ZERO), null, 'zero NEXT_PUBLIC_QC_V3_BRIDGE keeps V3 off')
  assert.equal(m.qcV3Bridge({ sepolia: { qc_v3: ZERO } }, SYNTHETIC_V3), SYNTHETIC_V3)
  assert.equal(m.qcV2Bridge({ sepolia: { legacy_qc_v2: ZERO } }), null)
  assert.throws(() => m.resolveTakeBridge({ bridge: ZERO, bridgeVersion: 'v3' }, V2, ZERO), /malformed bridge/)
  assert.throws(() => m.resolveTakeBridge({ bridge: SYNTHETIC_V3, bridgeVersion: 'v3' }, V2, ZERO), /not configured/)
  assert.throws(() => m.resolveTakeBridge({}, ZERO, null), /legacy_qc_v2 is not configured/)
  assert.throws(() => m.assertRefundSigner(ZERO, OTHER), /no valid sender/)
})
t('refund note id = sha256("refund|" || depositId), pinned to Falcon-PL', () => {
  // Same constant Falcon-PL pins in eth_v3_deposit_tests.rs and test_pl_walletd_v3_claims.py.
  const want = '0xa988c126d89667b997adf6da27e96be12d314e3c0f4222bc06970bbade9af593'
  assert.equal(m.v3RefundNoteId('02'.repeat(32)), want)
  assert.equal(m.v3RefundNoteId('0x' + '02'.repeat(32)), want)
})
t('parseDepositId', () => {
  assert.equal(m.parseDepositId(' 0X' + 'AB'.repeat(32) + ' '), '0x' + 'ab'.repeat(32))
  assert.throws(() => m.parseDepositId('0x1234'), /32-byte/)
})
t('refund only to the deposit sender', () => {
  m.assertRefundSigner(SYNTHETIC_V3.toUpperCase().replace('0X', '0x'), SYNTHETIC_V3)
  assert.throws(() => m.assertRefundSigner(SYNTHETIC_V3, OTHER), /deposit sender/)
  assert.throws(() => m.assertRefundSigner('', OTHER), /no valid sender/)
})

console.log(`verify-v3-claims: ${n} checks passed`)
