/**
 * Offline checks for the btc_withdrawals_enabled flag (no network, no node).
 * Run: node scripts/verify-btc-withdrawals-off.mjs
 *
 * - config: public/config/btc-spv-bridge.json has a boolean btc_withdrawals_enabled
 * - API: with the flag off, /api/wallet/submit refuses a BTC rail_withdraw (FBTC burn)
 *   and /api/wallet + /api/wallet/pl refuse btc-kickoff / btc-take before walletd
 *   is called; ETH/USDC and read-only actions still go through. With the flag on,
 *   the same requests are forwarded again.
 * - UI: BridgeDepositPanel gates the FBTC Bridge out handler, button and input.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ts = require('typescript')

const CONFIG = path.join(root, 'public/config/btc-spv-bridge.json')
// Placeholder only: fetch is stubbed below, nothing is ever contacted.
process.env.FALCON_PL_WALLET_API = 'http://walletd.invalid'
const MSG = 'BTC withdrawals are in final testing'

let failures = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (e) {
    failures++
    console.error(`FAIL ${name}\n     ${e instanceof Error ? e.message : e}`)
  }
}

/** Compile a TS module to CJS and run it with mocked imports. */
function loadTs(file, { mocks = {}, config }) {
  const cache = new Map()
  const load = (abs) => {
    if (cache.has(abs)) return cache.get(abs).exports
    if (abs.endsWith('.json')) {
      const json = abs === CONFIG && config ? config : JSON.parse(readFileSync(abs, 'utf8'))
      return json
    }
    const src = readFileSync(abs, 'utf8')
    const out = ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        resolveJsonModule: true,
      },
    }).outputText
    const mod = { exports: {} }
    cache.set(abs, mod)
    const req = (spec) => {
      if (spec in mocks) return mocks[spec]
      let target
      if (spec.startsWith('@/')) target = path.join(root, 'src', spec.slice(2))
      else if (spec.startsWith('.')) target = path.resolve(path.dirname(abs), spec)
      else throw new Error(`unmocked import ${spec} in ${path.relative(root, abs)}`)
      if (!target.endsWith('.json') && !target.endsWith('.ts')) target += '.ts'
      return load(target)
    }
    new Function('require', 'module', 'exports', out)(req, mod, mod.exports)
    return mod.exports
  }
  return load(path.join(root, file))
}

function makeEnv() {
  const calls = { fetch: [], plSubmit: [], plSubmitRaw: [] }
  globalThis.fetch = async (url, init) => {
    calls.fetch.push({ url: String(url), body: init?.body })
    return { ok: true, status: 200, json: async () => ({ ok: true, signed_btc_tx: '00' }) }
  }
  const mocks = {
    'next/server': {
      NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) },
    },
    '@/lib/origin': { isOriginAllowed: () => true },
    '@/lib/pl-rpc': {
      plAccount: async () => ({}),
      plStatus: async () => ({}),
      plSubmit: async (tx) => (calls.plSubmit.push(tx), { ok: true, msg: 'accepted' }),
      plSubmitRaw: async (tx) => (calls.plSubmitRaw.push(tx), { ok: true, msg: 'accepted' }),
    },
    '@/lib/pl-ctl': { PL_CTL: '/nonexistent', ctlPay: async () => ({}), ctlVaultOpen: async () => ({}), ctlVaultLock: async () => ({}) },
    '@/lib/network-server': {
      resolveNetworkKey: (k) => k || 'pl2300',
      serverNetworkConfig: () => ({ networkId: 2300 }),
      serverRpcCall: async () => ({}),
    },
    '@/lib/rate-limit': {
      peekSubmitRateLimit: async () => ({ success: true }),
      consumeSubmitRateLimit: async () => ({ success: true }),
    },
    fs: { existsSync: () => false },
  }
  return { calls, mocks }
}

const req = (body) => ({
  json: async () => body,
  headers: new Headers(),
  nextUrl: new URL('http://localhost/'),
})

const baseConfig = JSON.parse(readFileSync(CONFIG, 'utf8'))
const OFF = { ...baseConfig, btc_withdrawals_enabled: false }
const ON = { ...baseConfig, btc_withdrawals_enabled: true }

const plTx = (asset) => ({
  account: 'alice',
  sequence: 3,
  destination: 'tb1qexampledestinationaddressxxxxxxxxxxxx',
  amount: 5000,
  fee: 2,
  network_id: 2300,
  public_key: '00',
  signature: '00',
  tx_id: 'ab'.repeat(32),
  body: { kind: 'rail_withdraw', asset, amount: '5000', external_to: 'tb1qexampledestinationaddressxxxxxxxxxxxx' },
})

const kickoff = { action: 'btc-kickoff', account: 'alice', dest: 'tb1qexampledestinationaddressxxxxxxxxxxxx', amount: '5000' }
const take = { ...kickoff, action: 'btc-take', destSecret: 'cd'.repeat(32), prevTxid: 'ef'.repeat(32), vout: 0, sats: 5000 }

await check('config: btc_withdrawals_enabled is a boolean', () => {
  assert.equal(typeof baseConfig.btc_withdrawals_enabled, 'boolean')
  console.log(`     (current value: ${baseConfig.btc_withdrawals_enabled})`)
})

await check('lib: flag follows config; error text', () => {
  const off = loadTs('src/lib/btc-withdrawals.ts', { config: OFF })
  const on = loadTs('src/lib/btc-withdrawals.ts', { config: ON })
  const missing = loadTs('src/lib/btc-withdrawals.ts', { config: { ...baseConfig, btc_withdrawals_enabled: undefined } })
  assert.equal(off.BTC_WITHDRAWALS_ENABLED, false)
  assert.equal(on.BTC_WITHDRAWALS_ENABLED, true)
  assert.equal(missing.BTC_WITHDRAWALS_ENABLED, false, 'missing flag must mean off')
  assert.ok(off.BTC_WITHDRAWALS_OFF_MESSAGE.includes(MSG))
  assert.ok(off.btcWithdrawalsOffResponse().body.error.includes(MSG))
  assert.ok(off.isBtcPegOutPlTx(plTx('BTC')))
  assert.ok(off.isBtcPegOutPlTx(JSON.stringify(plTx('btc'))))
  assert.ok(!off.isBtcPegOutPlTx(plTx('ETH')))
  assert.ok(!off.isBtcPegOutPlTx(plTx('USDC')))
  assert.ok(off.isBtcWithdrawWalletdAction('btc-kickoff'))
  assert.ok(off.isBtcWithdrawWalletdAction('btc-take'))
  for (const a of ['eth-kickoff', 'eth-open-claim', 'claim-proof', 'header-proof', 'mint-status', 'mint-eth-deposit', 'vault-activate', 'pay']) {
    assert.ok(!off.isBtcWithdrawWalletdAction(a), a)
  }
})

for (const file of ['src/app/api/wallet/pl/route.ts', 'src/app/api/wallet/route.ts']) {
  for (const body of [kickoff, take]) {
    await check(`API ${file}: ${body.action} refused with flag off (walletd not called)`, async () => {
      const { calls, mocks } = makeEnv()
      const route = loadTs(file, { mocks, config: OFF })
      const res = await route.POST(req(body))
      assert.equal(res.status, 503)
      assert.ok(String(res.body.error).includes(MSG), res.body.error)
      assert.equal(res.body.code, 'btc_withdrawals_disabled')
      assert.equal(calls.fetch.length, 0, 'request was forwarded to walletd')
    })
    await check(`API ${file}: ${body.action} forwarded with flag on`, async () => {
      const { calls, mocks } = makeEnv()
      const route = loadTs(file, { mocks, config: ON })
      const res = await route.POST(req(body))
      assert.equal(res.status, 200)
      assert.equal(calls.fetch.length, 1)
      assert.equal(JSON.parse(calls.fetch[0].body).action, body.action)
    })
  }
  await check(`API ${file}: mint-status (read-only) still forwarded with flag off`, async () => {
    const { calls, mocks } = makeEnv()
    const route = loadTs(file, { mocks, config: OFF })
    const res = await route.POST(req({ action: 'mint-status', account: 'alice', txHash: 'aa'.repeat(32), asset: 'ETH' }))
    assert.equal(res.status, 200)
    assert.equal(calls.fetch.length, 1)
  })
}

const SUBMIT = 'src/app/api/wallet/submit/route.ts'
await check('API submit: BTC rail_withdraw (tx object) refused with flag off', async () => {
  const { calls, mocks } = makeEnv()
  const route = loadTs(SUBMIT, { mocks, config: OFF })
  const res = await route.POST(req({ tx: plTx('BTC'), network: 'pl2300' }))
  assert.equal(res.status, 503)
  assert.ok(String(res.body.error).includes(MSG))
  assert.equal(calls.plSubmit.length + calls.plSubmitRaw.length, 0)
})
await check('API submit: BTC rail_withdraw (exact tx_json) refused with flag off', async () => {
  const { calls, mocks } = makeEnv()
  const route = loadTs(SUBMIT, { mocks, config: OFF })
  const res = await route.POST(req({ tx_json: JSON.stringify(plTx('BTC')), network: 'pl2300' }))
  assert.equal(res.status, 503)
  assert.ok(String(res.body.error).includes(MSG))
  assert.equal(calls.plSubmit.length + calls.plSubmitRaw.length, 0)
})
await check('API submit: ETH/USDC rail_withdraw still submitted with flag off', async () => {
  const { calls, mocks } = makeEnv()
  const route = loadTs(SUBMIT, { mocks, config: OFF })
  const a = await route.POST(req({ tx_json: JSON.stringify(plTx('ETH')), network: 'pl2300' }))
  const b = await route.POST(req({ tx: plTx('USDC'), network: 'pl2300' }))
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  assert.equal(calls.plSubmitRaw.length, 1)
  assert.equal(calls.plSubmit.length, 1)
})
await check('API submit: BTC rail_withdraw submitted with flag on', async () => {
  const { calls, mocks } = makeEnv()
  const route = loadTs(SUBMIT, { mocks, config: ON })
  const res = await route.POST(req({ tx: plTx('BTC'), network: 'pl2300' }))
  assert.equal(res.status, 200)
  assert.equal(calls.plSubmit.length, 1)
})

await check('UI: BridgeDepositPanel gates FBTC Bridge out', () => {
  const src = readFileSync(path.join(root, 'src/components/BridgeDepositPanel.tsx'), 'utf8')
  assert.match(src, /from '@\/lib\/btc-withdrawals'/)
  // handler: refuses before any burn
  assert.match(
    src,
    /if \(isFbtcRoute\) \{\s*if \(!BTC_WITHDRAWALS_ENABLED\) \{\s*setError\(BTC_WITHDRAWALS_OFF_MESSAGE\)\s*return\s*\}/,
  )
  // withdraw form: notice + disabled input and Bridge out button
  const form = src.slice(src.indexOf("{direction === 'withdraw' && isFbtcRoute && ("))
  const block = form.slice(0, form.indexOf("{direction === 'withdraw' && !isFbtcRoute && ("))
  assert.ok(block.length > 0, 'FBTC withdraw block not found')
  assert.match(block, /!BTC_WITHDRAWALS_ENABLED && \(/)
  assert.match(block, /\{BTC_WITHDRAWALS_OFF_MESSAGE\}/)
  assert.match(block, /disabled=\{busy \|\| !hasBtc \|\| !fbtcReady \|\| !BTC_WITHDRAWALS_ENABLED\}/)
  assert.match(block, /onClick=\{handleBridgeOut\}\s*disabled=\{\s*!BTC_WITHDRAWALS_ENABLED \|\|/)
  assert.match(block, /withdrawal is pending/)
})

if (failures) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nverify:btc-withdrawals-off: all checks passed')
