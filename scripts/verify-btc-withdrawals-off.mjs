/**
 * Offline checks for the btc_withdrawals_enabled flag (no network, no node).
 * Run: node scripts/verify-btc-withdrawals-off.mjs
 *
 * - config: public/config/btc-spv-bridge.json has btc_withdrawals_enabled === false
 * - API: with the flag off, /api/wallet/submit refuses a BTC rail_withdraw (FBTC burn)
 *   before the node is called; ETH/USDC and read-only actions still go through.
 * - API: /api/wallet + /api/wallet/pl refuse btc-kickoff / btc-take (and aliases)
 *   with 403 whatever the flag says, with or without an Origin header.
 * - API: both wallet routes forward only WALLET_ROUTE_ACTIONS, reject a non-string
 *   action with 400, and accept only ETH/USDC for eth-open-claim.
 * - UI: BridgeDepositPanel gates the FBTC Bridge out handler, button and input,
 *   and hides the Kickoff explanation while the flag is off.
 *
 * RE-ENABLE TOGETHER, in one PR: btc_withdrawals_enabled, the unconditional
 * btc-kickoff/btc-take refusal in both api/wallet routes, and WALLET_ROUTE_ACTIONS
 * (src/lib/wallet-actions.ts), then update this script. Turning on only the flag
 * lets users burn FBTC while Kickoff/take are still refused, so the burns get stuck.
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
process.env.VERCEL = '1' // origin check runs in production mode
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

await check('config: btc_withdrawals_enabled is false (BTC withdrawals off)', () => {
  // The re-enable PR flips this to true and updates this check with it.
  assert.equal(
    baseConfig.btc_withdrawals_enabled,
    false,
    'btc_withdrawals_enabled must be false while BTC withdrawals are in final testing',
  )
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
  for (const a of ['btc-kickoff', 'btc-take', 'btc_kickoff', 'BTC-Take', ' btc-kickoff ', 'resume-btc-kickoff', 'kickoff-btc', 'fbtc-take']) {
    assert.ok(off.isBtcWithdrawWalletdAction(a), a)
  }
  for (const a of ['eth-kickoff', 'eth-open-claim', 'claim-proof', 'header-proof', 'mint-status', 'mint-eth-deposit', 'vault-activate', 'pay']) {
    assert.ok(!off.isBtcWithdrawWalletdAction(a), a)
  }
})

const PAUSED = 'BTC withdrawals are paused'
const SITE = 'https://site.example'
const reqWith = (body, origin) => {
  const headers = new Headers({ host: 'site.example', 'x-forwarded-proto': 'https' })
  if (origin) headers.set('origin', origin)
  return { json: async () => body, headers, url: `${SITE}/api/wallet/pl`, nextUrl: new URL(`${SITE}/api/wallet/pl`) }
}

for (const file of ['src/app/api/wallet/pl/route.ts', 'src/app/api/wallet/route.ts']) {
  const actions = [kickoff, take, { ...kickoff, action: 'btc_kickoff' }, { ...take, action: 'BTC-TAKE' }]
  for (const [cfgName, config] of [['off', OFF], ['on', ON]]) {
    for (const origin of [null, SITE, 'https://other.example']) {
      for (const body of actions) {
        await check(`API ${file}: ${body.action} refused (flag ${cfgName}, origin ${origin ?? 'none'})`, async () => {
          const { calls, mocks } = makeEnv()
          delete mocks['@/lib/origin'] // real origin check (production mode)
          const route = loadTs(file, { mocks, config })
          const res = await route.POST(reqWith(body, origin))
          assert.equal(res.status, 403)
          assert.ok(String(res.body.error).includes(PAUSED), res.body.error)
          assert.equal(res.body.code, 'btc_withdrawals_paused')
          assert.equal(calls.fetch.length, 0, 'request was forwarded to walletd')
        })
      }
    }
  }
  await check(`API ${file}: mint-status (read-only) still forwarded`, async () => {
    const { calls, mocks } = makeEnv()
    const route = loadTs(file, { mocks, config: OFF })
    const res = await route.POST(req({ action: 'mint-status', account: 'alice', txHash: 'aa'.repeat(32), asset: 'ETH' }))
    assert.equal(res.status, 200)
    assert.equal(calls.fetch.length, 1)
  })
  await check(`API ${file}: eth-kickoff not caught by the BTC pause`, async () => {
    const { mocks } = makeEnv()
    const route = loadTs(file, { mocks, config: OFF })
    const res = await route.POST(req({ action: 'eth-kickoff', noteId: 'x', dest: '0x', amount: '1', asset: 'ETH' }))
    assert.notEqual(res.body.code, 'btc_withdrawals_paused')
  })
  await check(`API ${file}: other actions still need an allowed Origin`, async () => {
    const { calls, mocks } = makeEnv()
    delete mocks['@/lib/origin']
    const route = loadTs(file, { mocks, config: OFF })
    const res = await route.POST(reqWith({ action: 'mint-status', account: 'alice', txHash: 'aa'.repeat(32) }, 'https://other.example'))
    assert.equal(res.status, 403)
    assert.equal(calls.fetch.length, 0)
  })
}

const WALLETD_ACTIONS = [
  'vault-activate',
  'eth-kickoff',
  'eth-open-claim',
  'header-proof',
  'claim-proof',
  'mint-eth-deposit',
  'mint-status',
  'pay',
]

await check('lib: WALLET_ROUTE_ACTIONS is exactly the expected allowlist and covers the site callers', () => {
  const wa = loadTs('src/lib/wallet-actions.ts', {})
  assert.deepEqual([...wa.WALLET_ROUTE_ACTIONS].sort(), [...WALLETD_ACTIONS].sort())
  assert.ok(!wa.WALLET_ROUTE_ACTIONS.has('btc-kickoff'))
  assert.ok(!wa.WALLET_ROUTE_ACTIONS.has('btc-take'))
  // every non-BTC action the site posts to /api/wallet/pl must be allowed
  const callers = ['src/lib/pl-dest-lock.ts', 'src/lib/pl-btc-rail.ts']
    .map((f) => readFileSync(path.join(root, f), 'utf8'))
    .join('\n')
  const sent = new Set()
  for (const m of callers.matchAll(/action: '([a-z0-9-]+)'/g)) sent.add(m[1])
  for (const m of callers.matchAll(/postMint\('([a-z0-9-]+)'/g)) sent.add(m[1])
  for (const a of sent) {
    if (/^btc-/.test(a)) continue
    assert.ok(wa.WALLET_ROUTE_ACTIONS.has(a), `site sends ${a} but it is not allowlisted`)
  }
  assert.ok(sent.has('eth-open-claim') && sent.has('mint-status'), 'caller scan found nothing')
})

for (const file of ['src/app/api/wallet/pl/route.ts', 'src/app/api/wallet/route.ts']) {
  for (const action of WALLETD_ACTIONS) {
    await check(`API ${file}: allowlisted ${action} passes the action check`, async () => {
      const { mocks } = makeEnv()
      const route = loadTs(file, { mocks, config: OFF })
      const res = await route.POST(req({ action }))
      assert.notEqual(res.body?.error, 'Unknown action')
      assert.notEqual(res.body?.error, 'action must be a string')
    })
  }
  for (const action of ['faucet', 'name-reserve', 'deposit-x', 'v3-refund', 'PAY', 'eth-kickoff ', '']) {
    await check(`API ${file}: unknown action ${JSON.stringify(action)} gets 400, nothing forwarded`, async () => {
      const { calls, mocks } = makeEnv()
      const route = loadTs(file, { mocks, config: OFF })
      const res = await route.POST(req({ action, account: 'alice', from: 'alice', to: 'bob', amount: 5 }))
      assert.equal(res.status, 400)
      assert.equal(res.body.error, 'Unknown action')
      assert.equal(calls.fetch.length, 0)
    })
  }
  for (const action of [null, 123, true, { a: 1 }, ['pay']]) {
    await check(`API ${file}: non-string action ${JSON.stringify(action)} gets 400`, async () => {
      const { calls, mocks } = makeEnv()
      const route = loadTs(file, { mocks, config: OFF })
      const res = await route.POST(req({ action, from: 'alice', to: 'bob', amount: 5 }))
      assert.equal(res.status, 400)
      assert.equal(res.body.error, 'action must be a string')
      assert.equal(calls.fetch.length, 0)
    })
  }
  await check(`API ${file}: missing action still means pay`, async () => {
    const { mocks } = makeEnv()
    const route = loadTs(file, { mocks, config: OFF })
    const res = await route.POST(req({ from: 'alice', to: 'alice', amount: 5 }))
    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'Destination must differ from sender')
  })
  const openClaim = (asset) => ({
    action: 'eth-open-claim',
    noteId: 'ab'.repeat(32),
    dest: '0x' + '11'.repeat(20),
    amount: '1000',
    account: 'alice',
    ...(asset === undefined ? {} : { asset }),
  })
  for (const asset of ['BTC', 'FBTC', 'DAI', 'ETH2', '', 5, null]) {
    await check(`API ${file}: eth-open-claim asset ${JSON.stringify(asset)} gets 400`, async () => {
      const { calls, mocks } = makeEnv()
      const route = loadTs(file, { mocks, config: OFF })
      const res = await route.POST(req(openClaim(asset)))
      assert.equal(res.status, 400)
      assert.equal(res.body.error, 'asset must be ETH or USDC')
      assert.equal(calls.fetch.length, 0)
    })
  }
  for (const asset of ['ETH', 'USDC', 'eth', undefined]) {
    await check(`API ${file}: eth-open-claim asset ${JSON.stringify(asset)} forwarded`, async () => {
      const { calls, mocks } = makeEnv()
      const route = loadTs(file, { mocks, config: OFF })
      const res = await route.POST(req(openClaim(asset)))
      assert.equal(res.status, 200)
      assert.equal(calls.fetch.length, 1)
      assert.ok(['ETH', 'USDC'].includes(JSON.parse(calls.fetch[0].body).asset))
    })
  }
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
  // Kickoff explanation hidden while the flag is off
  assert.match(block, /\{spvLive && BTC_WITHDRAWALS_ENABLED && \(\s*<div[^>]*>\s*<p[^>]*>\s*[^<]*Kickoff/)
  // Finish (SPV proving of an existing withdrawal) stays usable
  const card = src.slice(src.indexOf('{spvWithdraws[0] && ('))
  const finish = card.slice(0, card.indexOf("'Finish'"))
  assert.ok(finish.length > 0, 'Finish button not found')
  const finishBtn = finish.slice(finish.lastIndexOf('<button'))
  assert.match(finishBtn, /disabled=\{busy\}/)
  assert.doesNotMatch(finishBtn, /BTC_WITHDRAWALS_ENABLED/)
})

if (failures) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nverify:btc-withdrawals-off: all checks passed')
