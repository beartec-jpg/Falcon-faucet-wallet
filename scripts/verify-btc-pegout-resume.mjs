/**
 * Offline checks for the resumable BTC Bridge out (src/lib/btc-pegout-resume.ts).
 * No network, no keys, no transactions: every Falcon / Bitcoin call is a fake.
 * Run: node scripts/verify-btc-pegout-resume.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash, webcrypto } from 'node:crypto'
import ts from 'typescript'

if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(__dirname, '../src/lib/btc-pegout-resume.ts'), 'utf8')
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText
const dir = mkdtempSync(path.join(tmpdir(), 'btc-pegout-'))
const modPath = path.join(dir, 'btc-pegout-resume.mjs')
writeFileSync(modPath, js)
const m = await import(pathToFileURL(modPath).href)
rmSync(dir, { recursive: true, force: true })

const ACCOUNT = 'alice'
const AMOUNT = 5000

// ── tiny Bitcoin helpers for test vectors (no keys, no network) ──
const sha256hex = (hex) => createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex')
const h160 = (hex) => createHash('ripemd160').update(Buffer.from(sha256hex(hex), 'hex')).digest('hex')
const BECH = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
function polymod(v) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let c = 1
  for (const x of v) {
    const t = c >>> 25
    c = ((c & 0x1ffffff) << 5) ^ x
    for (let i = 0; i < 5; i++) if ((t >>> i) & 1) c ^= G[i]
  }
  return c >>> 0
}
function p2wpkhAddress(hrp, hash20hex) {
  const bytes = Buffer.from(hash20hex, 'hex')
  const words = [0]
  let acc = 0
  let bits = 0
  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 5) {
      bits -= 5
      words.push((acc >> bits) & 31)
    }
  }
  if (bits) words.push((acc << (5 - bits)) & 31)
  const exp = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31))
  const pm = polymod([...exp, ...words, 0, 0, 0, 0, 0, 0]) ^ 1
  const chk = [0, 1, 2, 3, 4, 5].map((i) => (pm >> (5 * (5 - i))) & 31)
  return hrp + '1' + [...words, ...chk].map((w) => BECH[w]).join('')
}
const le = (n, bytes) => {
  let h = ''
  let v = BigInt(n)
  for (let i = 0; i < bytes; i++) {
    h += (v & 0xffn).toString(16).padStart(2, '0')
    v >>= 8n
  }
  return h
}
const vi = (n) => (n < 0xfd ? n.toString(16).padStart(2, '0') : 'fd' + le(n, 2))
const rev = (hex) => Buffer.from(hex, 'hex').reverse().toString('hex')
function serializeTx(inputs, outputs) {
  const segwit = inputs.some((i) => i.witness?.length)
  let h = '02000000' + (segwit ? '0001' : '') + vi(inputs.length)
  for (const i of inputs) h += rev(i.txid) + le(i.vout, 4) + '00' + 'fdffffff'
  h += vi(outputs.length)
  for (const o of outputs) h += le(o.sats, 8) + vi(o.spk.length / 2) + o.spk
  if (segwit) for (const i of inputs) {
    const w = i.witness ?? []
    h += vi(w.length) + w.map((x) => vi(x.length / 2) + x).join('')
  }
  return h + '00000000'
}

const DEST_H160 = h160('02' + '11'.repeat(32))
const DEST = p2wpkhAddress('tb', DEST_H160)
const DEST_SPK = '0014' + DEST_H160
const OTHER_H160 = h160('03' + '22'.repeat(32))
const OTHER_DEST = p2wpkhAddress('tb', OTHER_H160)
/** dest-lock (claim) witness script, same layout as the node's claim_witness_script. */
const claimScript = (destH160) =>
  '63a820' + '5a'.repeat(32) + '88' + '51' + '67' + '56' + 'b2' + '75' + '76a914' + destH160 + '88ac' + '68'
const INSTANCE_TXID = 'aa'.repeat(32)
function kickoffHex({ amount = AMOUNT, destH160 = DEST_H160, prev = INSTANCE_TXID, vout = 1 } = {}) {
  return serializeTx(
    [{ txid: prev, vout, witness: ['ab'.repeat(64)] }],
    [
      { sats: amount, spk: '0020' + sha256hex(claimScript(destH160)) },
      { sats: 90_000, spk: '5120' + 'cd'.repeat(32) },
    ],
  )
}
const KICKOFF_HEX = kickoffHex()
const KICKOFF_TXID = await m.btcTxidFromRaw(KICKOFF_HEX)
function takeHex({ kickoffTxid = KICKOFF_TXID, destH160 = DEST_H160, paySpk = DEST_SPK, pay = AMOUNT - 300 } = {}) {
  return serializeTx(
    [{ txid: kickoffTxid, vout: 0, witness: ['30'.repeat(71), '02' + '11'.repeat(32), '', claimScript(destH160)] }],
    [{ sats: pay, spk: paySpk }],
  )
}
const TAKE_HEX = takeHex()
const TAKE_TXID = await m.btcTxidFromRaw(TAKE_HEX)

function memKv() {
  const map = new Map()
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v), map }
}

// Legacy genesis coinbase (txid known) + a segwit wrapper of it (txid must not change).
const GENESIS_RAW =
  '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000'
const GENESIS_TXID = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b'
const segwitOf = (raw) => raw.slice(0, 8) + '0001' + raw.slice(8, -8) + '0140' + 'ab'.repeat(64) + raw.slice(-8)

/** Two explorers' outspend answers → agreed view (what the site adapter does). */
const spentBy = (txid, { height = 100, tips = [110, 110] } = {}) =>
  m.agreeSpender(tips.map((tip) => ({ ok: true, spent: true, txid, confirmed: true, blockHeight: height, tip })))

/** Fake Falcon PL + Bitcoin. Counts every irreversible call. */
function fakeWorld(opts = {}) {
  const w = {
    seq: 7,
    balance: 100,
    btcSats: 20_000,
    chainNotes: [],
    chainAvailable: true,
    mempool: new Map(),
    burnsSigned: 0,
    burnsApplied: 0,
    submits: 0,
    kickoffRequests: 0,
    broadcasts: [],
    takes: 0,
    confs: 6,
    takeConfs: 1,
    failKickoff: 0,
    failBroadcast: 0,
    broadcastError: 'network timeout',
    failSubmit: 0,
    sealOnSubmit: true,
    spender: null,
    /** Amount the fake coordinator's Kickoff / take pay. */
    amount: AMOUNT,
    ...opts,
  }
  w.kickHex = () => (w.amount === AMOUNT ? KICKOFF_HEX : kickoffHex({ amount: w.amount }))
  w.takeHexFor = async () =>
    w.amount === AMOUNT
      ? TAKE_HEX
      : takeHex({ kickoffTxid: await m.btcTxidFromRaw(w.kickHex()), pay: w.amount - 300 })
  const noteFor = (amount, dest) =>
    createHash('sha256').update(`wd:BTC:${ACCOUNT}:${amount}:${dest}`).digest('hex')
  w.apply = (raw) => {
    const tx = JSON.parse(raw)
    if (tx.sequence !== w.seq) return // stale / already applied
    const note = noteFor(tx.amount, tx.dest)
    if (w.chainNotes.some((n) => n.noteId === note)) throw new Error('duplicate withdraw note')
    w.seq += 1
    w.btcSats -= tx.amount
    w.balance -= 2
    w.burnsApplied += 1
    w.chainNotes.push({ noteId: note, amountSats: tx.amount, externalTo: tx.dest })
  }
  w.deps = (store, extra = {}) => ({
    store,
    accountSnap: async () => ({ sequence: w.seq, balance: w.balance, btcSats: w.btcSats }),
    listChainWithdrawals: async () => (w.chainAvailable ? w.chainNotes.slice() : null),
    signBurn: async (sequence) => {
      w.burnsSigned += 1
      const raw = JSON.stringify({ sequence, amount: AMOUNT, dest: DEST, n: w.burnsSigned })
      return { tx_id: `burn-${sequence}-${w.burnsSigned}`, rawJson: raw }
    },
    submitBurn: async (raw) => {
      w.submits += 1
      if (w.failSubmit > 0) {
        w.failSubmit -= 1
        throw new Error('503 node busy')
      }
      if (w.sealOnSubmit) w.apply(raw)
      else w.mempool.set(raw, true)
    },
    requestKickoff: async () => {
      w.kickoffRequests += 1
      if (w.failKickoff > 0) {
        w.failKickoff -= 1
        throw new Error('instance has no confirmed Bitcoin UTXO')
      }
      return { signed_btc_tx: w.kickHex(), amount: w.amount }
    },
    broadcast: async (hex) => {
      w.broadcasts.push(hex)
      if (w.failBroadcast > 0) {
        w.failBroadcast -= 1
        throw new Error(w.broadcastError)
      }
      return m.btcTxidFromRaw(hex)
    },
    // The take is unknown to Bitcoin until something broadcast it.
    pollConfirmations: async (txid) => {
      const th = await w.takeHexFor()
      if (txid !== (await m.btcTxidFromRaw(th))) return w.confs
      return w.broadcasts.includes(th) ? w.takeConfs : null
    },
    lookupSpender: async () => w.spender,
    requestTake: async () => {
      w.takes += 1
      return { signed_btc_tx: await w.takeHexFor() }
    },
    sleep: async () => {},
    now: (() => {
      let t = 1_000_000
      return () => (t += 1_000)
    })(),
    ...extra,
  })
  return w
}

const params = {
  account: ACCOUNT,
  network: 'testnet',
  amountSats: AMOUNT,
  dest: DEST,
  fee: 2,
  claimCsv: 6,
  timing: { burnWaitMs: 20_000, kickoffWaitMs: 60_000, takeWaitMs: 30_000 },
}

let passed = 0
async function test(name, fn) {
  await fn()
  passed += 1
  console.log(`ok - ${name}`)
}

await test('note id matches the node derivation', async () => {
  const want = createHash('sha256').update(`wd:BTC:${ACCOUNT}:${AMOUNT}:${DEST}`).digest('hex')
  assert.equal(await m.btcWithdrawNoteId(ACCOUNT, AMOUNT, DEST), want)
})

await test('txid from raw: legacy vector and segwit wrapper', async () => {
  assert.equal(await m.btcTxidFromRaw(GENESIS_RAW), GENESIS_TXID)
  assert.equal(await m.btcTxidFromRaw(segwitOf(GENESIS_RAW)), GENESIS_TXID)
})

await test('fresh withdrawal: one burn, one Kickoff, take, record done', async () => {
  const kv = memKv()
  const store = m.kvBtcPegOutStore(kv)
  const w = fakeWorld()
  const out = await m.runBtcPegOut(params, w.deps(store))
  assert.equal(w.burnsSigned, 1)
  assert.equal(w.burnsApplied, 1)
  assert.equal(w.kickoffRequests, 1)
  assert.equal(w.takes, 1)
  assert.equal(out.kickoffTxid, KICKOFF_TXID)
  assert.equal(out.takeTxid, TAKE_TXID)
  assert.equal(out.resumed, false)
  assert.equal(store.listOpen(ACCOUNT).length, 0)
  assert.equal(store.load(ACCOUNT, out.noteId).phase, 'done')
})

await test('Kickoff fails after the burn: retry does NOT burn again and completes', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld({ failKickoff: 1 })
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /burned but the Kickoff could not be signed/)
  assert.equal(w.burnsApplied, 1)
  const open = store.listOpen(ACCOUNT)
  assert.equal(open.length, 1)
  assert.equal(open[0].phase, 'burned')
  assert.equal(open[0].noteId, await m.btcWithdrawNoteId(ACCOUNT, AMOUNT, DEST))
  // UI lookup used to skip the "insufficient FBTC" check while resuming.
  assert.ok(m.findOpenBtcPegOut(ACCOUNT, AMOUNT, DEST, store))

  const out = await m.runBtcPegOut(params, w.deps(store))
  assert.equal(w.burnsSigned, 1, 'no second burn signed')
  assert.equal(w.burnsApplied, 1, 'no second burn applied')
  assert.equal(w.kickoffRequests, 2)
  assert.equal(w.takes, 1)
  assert.equal(out.resumed, true)
  assert.equal(store.listOpen(ACCOUNT).length, 0)
})

await test('Kickoff broadcast fails: retry re-broadcasts the SAME Kickoff, no new Kickoff, no new burn', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld({ failBroadcast: 1 })
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /broadcast failed/)
  assert.equal(store.listOpen(ACCOUNT)[0].phase, 'kickoff_signed')
  await m.runBtcPegOut(params, w.deps(store))
  assert.equal(w.burnsSigned, 1)
  assert.equal(w.kickoffRequests, 1)
  assert.deepEqual(w.broadcasts, [KICKOFF_HEX, KICKOFF_HEX, TAKE_HEX])
})

await test('"already in mempool" broadcast still learns the Kickoff txid', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld({ failBroadcast: 1, broadcastError: 'txn-already-in-mempool' })
  const out = await m.runBtcPegOut(params, w.deps(store))
  assert.equal(out.kickoffTxid, KICKOFF_TXID)
  assert.equal(w.takes, 1)
})

await test('CSV not reached: retry resumes the take only', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld({ confs: 2 })
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /Wait for 6 Bitcoin confirmations/)
  w.confs = 6
  await m.runBtcPegOut(params, w.deps(store))
  assert.equal(w.burnsSigned, 1)
  assert.equal(w.kickoffRequests, 1)
  assert.deepEqual(w.broadcasts, [KICKOFF_HEX, TAKE_HEX])
  assert.equal(w.takes, 1)
})

await test('agreeSpender: needs every explorer, agreement, and a known tip', async () => {
  const a = (o) => ({ ok: true, spent: true, txid: 'b'.repeat(64), confirmed: true, blockHeight: 100, tip: 110, ...o })
  assert.deepEqual(m.agreeSpender([a(), a()]), { spent: true, txid: 'b'.repeat(64), confirmations: 11 })
  assert.equal(m.agreeSpender([a()]), null, 'one explorer is not enough')
  assert.equal(m.agreeSpender([a(), { ok: false }]), null, 'an explorer failed')
  assert.equal(m.agreeSpender([a(), a({ txid: 'c'.repeat(64) })]), null, 'explorers disagree on the spender')
  assert.equal(m.agreeSpender([a(), a({ spent: false })]), null, 'explorers disagree on spent')
  assert.equal(m.agreeSpender([a(), a({ tip: undefined })]).confirmations, null, 'tip unknown → unknown, not 0')
  assert.equal(m.agreeSpender([a(), a({ confirmed: false })]).confirmations, 0)
  assert.equal(m.agreeSpender([a(), a({ tip: 104 })]).confirmations, 5, 'smallest depth wins')
  assert.deepEqual(m.agreeSpender([{ ok: true, spent: false }, { ok: true, spent: false }]), { spent: false })
})

for (const [name, spender] of [
  ['spender unknown (lookup failed)', null],
  ['explorers disagree on the spender', m.agreeSpender([
    { ok: true, spent: true, txid: 'b'.repeat(64), confirmed: true, blockHeight: 100, tip: 110 },
    { ok: true, spent: true, txid: 'c'.repeat(64), confirmed: true, blockHeight: 100, tip: 110 },
  ])],
  ['only one explorer answered', m.agreeSpender([
    { ok: true, spent: true, txid: 'b'.repeat(64), confirmed: true, blockHeight: 100, tip: 110 },
    { ok: false },
  ])],
  ['spender confirmed but tip unknown', spentBy('b'.repeat(64), { tips: [110, undefined] })],
  ['spender only 5 deep', spentBy('b'.repeat(64), { height: 100, tips: [104, 104] })],
  ['spender unconfirmed', m.agreeSpender([
    { ok: true, spent: true, txid: 'b'.repeat(64), confirmed: false },
    { ok: true, spent: true, txid: 'b'.repeat(64), confirmed: false },
  ])],
  ['spender is our own Kickoff', spentBy(KICKOFF_TXID)],
]) {
  await test(`Kickoff input spent, ${name}: SAME Kickoff kept, manual check, no new Kickoff`, async () => {
    const store = m.kvBtcPegOutStore(memKv())
    const w = fakeWorld({ failBroadcast: 1, broadcastError: 'bad-txns-inputs-missingorspent', confs: null, spender })
    await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /could not be proven.*manual/s)
    const rec = store.listOpen(ACCOUNT)[0]
    assert.equal(rec.phase, 'kickoff_signed')
    assert.equal(rec.signedKickoffHex, KICKOFF_HEX)
    // Retry with the same answer: still the same Kickoff, never a second one.
    w.failBroadcast = 1
    await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /could not be proven/)
    assert.equal(w.kickoffRequests, 1)
    assert.equal(w.burnsSigned, 1)
    assert.ok(w.broadcasts.every((h) => h === KICKOFF_HEX))
  })
}

await test('Kickoff input spent by a DIFFERENT tx ≥6 deep on every explorer: new Kickoff, no new burn', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld({
    failBroadcast: 1,
    broadcastError: 'bad-txns-inputs-missingorspent',
    confs: null,
    spender: spentBy('b'.repeat(64), { height: 100, tips: [105, 106] }),
  })
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /can never confirm/)
  assert.equal(store.listOpen(ACCOUNT)[0].phase, 'burned')
  w.confs = 6
  await m.runBtcPegOut(params, w.deps(store))
  assert.equal(w.burnsSigned, 1)
  assert.equal(w.kickoffRequests, 2)
})

await test('Kickoff input spent by OUR Kickoff (already confirmed): carries on, no new Kickoff', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld({ failBroadcast: 1, broadcastError: 'bad-txns-inputs-missingorspent' })
  const out = await m.runBtcPegOut(params, w.deps(store))
  assert.equal(out.kickoffTxid, KICKOFF_TXID)
  assert.equal(w.kickoffRequests, 1)
})

await test('Kickoff that does not match the request is never broadcast', async () => {
  for (const [kick, why] of [
    [{ signed_btc_tx: KICKOFF_HEX, amount: AMOUNT + 1 }, /Kickoff amount/],
    [{ signed_btc_tx: kickoffHex({ amount: AMOUNT - 1 }), amount: AMOUNT }, /pays 4999 sats/],
    [{ signed_btc_tx: serializeTx([{ txid: INSTANCE_TXID, vout: 1 }], [{ sats: AMOUNT, spk: DEST_SPK }]) }, /not a dest-lock/],
  ]) {
    const store = m.kvBtcPegOutStore(memKv())
    const w = fakeWorld()
    await assert.rejects(
      m.runBtcPegOut(params, w.deps(store, { requestKickoff: async () => kick })),
      why,
    )
    assert.equal(store.listOpen(ACCOUNT)[0].phase, 'burned')
    assert.equal(w.broadcasts.length, 0)
  }
})

await test('burn submit fails: retry re-sends the same signed burn (no second signature)', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld({ failSubmit: 1 })
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /Burn submit failed/)
  assert.equal(w.burnsApplied, 0)
  assert.equal(store.listOpen(ACCOUNT)[0].phase, 'burn_signed')
  await m.runBtcPegOut(params, w.deps(store))
  assert.equal(w.burnsSigned, 1)
  assert.equal(w.burnsApplied, 1)
  assert.equal(w.takes, 1)
})

await test('lost browser state: on-chain burn is found; refuses without confirmation, resumes with it', async () => {
  const w = fakeWorld({ failKickoff: 1 })
  await assert.rejects(m.runBtcPegOut(params, w.deps(m.kvBtcPegOutStore(memKv()))))
  assert.equal(w.burnsApplied, 1)

  const fresh = m.kvBtcPegOutStore(memKv()) // browser storage wiped
  await assert.rejects(m.runBtcPegOut(params, w.deps(fresh)), /already has a burn/)
  assert.equal(w.burnsSigned, 1)
  assert.equal(w.kickoffRequests, 1)

  const fresh2 = m.kvBtcPegOutStore(memKv())
  const out = await m.runBtcPegOut(params, w.deps(fresh2, { confirmChainResume: async () => true }))
  assert.equal(w.burnsSigned, 1, 'no second burn')
  assert.equal(w.burnsApplied, 1)
  assert.equal(w.takes, 1)
  assert.equal(out.resumed, false)
  assert.equal(fresh2.load(ACCOUNT, out.noteId).recoveredFromChain, true)
})

await test('another withdrawal is open: a different amount is refused (no second burn)', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld({ failKickoff: 1 })
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)))
  await assert.rejects(
    m.runBtcPegOut({ ...params, amountSats: AMOUNT + 1 }, w.deps(store)),
    /still in progress/,
  )
  assert.equal(w.burnsSigned, 1)
})

await test('completed withdrawal: same amount + address is refused up front', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld()
  await m.runBtcPegOut(params, w.deps(store))
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /already completed/)
  assert.equal(w.burnsSigned, 1)
  assert.equal(w.kickoffRequests, 1)
})

await test('burn never sealed and its sequence was used: record dropped, fresh burn then works', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld({ sealOnSubmit: false })
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /not confirmed it sealed yet/)
  assert.equal(store.listOpen(ACCOUNT)[0].phase, 'burn_signed')
  w.seq += 1 // another tx used the sequence; the queued burn can never apply
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /never sealed/)
  assert.equal(store.listOpen(ACCOUNT).length, 0)
  w.sealOnSubmit = true
  await m.runBtcPegOut(params, w.deps(store))
  assert.equal(w.burnsApplied, 1)
  assert.equal(w.takes, 1)
})

await test('chain list unavailable: no fresh burn; a sealed-or-dead question waits instead of guessing', async () => {
  const w0 = fakeWorld({ chainAvailable: false })
  await assert.rejects(m.runBtcPegOut(params, w0.deps(m.kvBtcPegOutStore(memKv()))), /Could not check Falcon PL/)
  assert.equal(w0.burnsSigned, 0)

  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld({ sealOnSubmit: false })
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /not confirmed it sealed yet/)
  const queued = [...w.mempool.keys()][0]
  w.apply(queued) // the burn seals…
  w.chainAvailable = false // …while the list is down
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /not confirmed it sealed yet/)
  assert.equal(store.listOpen(ACCOUNT)[0].phase, 'burn_signed')
  assert.equal(w.kickoffRequests, 0, 'no Kickoff on an unconfirmed burn')
  w.chainAvailable = true
  await m.runBtcPegOut(params, w.deps(store))
  assert.equal(w.burnsSigned, 1)
  assert.equal(w.burnsApplied, 1)
  assert.equal(w.takes, 1)
})

await test('lost browser state + changed amount: earlier on-chain withdrawal blocks a blind new burn', async () => {
  const w = fakeWorld({ failKickoff: 1 })
  await assert.rejects(m.runBtcPegOut(params, w.deps(m.kvBtcPegOutStore(memKv()))))
  assert.equal(w.burnsApplied, 1)
  const other = { ...params, amountSats: AMOUNT + 1 }
  await assert.rejects(
    m.runBtcPegOut(other, w.deps(m.kvBtcPegOutStore(memKv()))),
    /no record of .*5000 sats/,
  )
  assert.equal(w.burnsSigned, 1, 'no second burn without confirmation')
  let shown = null
  const deps = w.deps(m.kvBtcPegOutStore(memKv()), {
    confirmFreshBurn: async (others) => {
      shown = others
      return true
    },
    signBurn: async (sequence) => {
      w.burnsSigned += 1
      return { tx_id: `burn-${sequence}`, rawJson: JSON.stringify({ sequence, amount: AMOUNT + 1, dest: DEST }) }
    },
  })
  w.amount = AMOUNT + 1
  await m.runBtcPegOut(other, deps)
  assert.equal(shown.length, 1)
  assert.equal(shown[0].amountSats, AMOUNT)
  assert.equal(w.burnsSigned, 2, 'explicitly confirmed new withdrawal')
})

await test('a locally completed withdrawal does not trigger the earlier-withdrawal prompt', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld()
  await m.runBtcPegOut(params, w.deps(store))
  const deps = w.deps(store, {
    confirmFreshBurn: async () => {
      throw new Error('should not be asked')
    },
    signBurn: async (sequence) => {
      w.burnsSigned += 1
      return { tx_id: `burn-${sequence}`, rawJson: JSON.stringify({ sequence, amount: AMOUNT + 7, dest: DEST }) }
    },
  })
  w.amount = AMOUNT + 7
  await m.runBtcPegOut({ ...params, amountSats: AMOUNT + 7 }, deps)
  assert.equal(w.burnsApplied, 2)
})

await test('Kickoff input reported spent but its status is unknown: keep the same signed Kickoff', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld({ failBroadcast: 1, broadcastError: 'bad-txns-inputs-missingorspent' })
  const deps = () =>
    w.deps(store, {
      pollConfirmations: async () => {
        if (w.explorerDown) throw new Error('explorer 503')
        return w.confs
      },
    })
  w.explorerDown = true
  await assert.rejects(m.runBtcPegOut(params, deps()), /could not be proven/)
  assert.equal(store.listOpen(ACCOUNT)[0].phase, 'kickoff_signed')
  w.explorerDown = false
  await m.runBtcPegOut(params, deps())
  assert.equal(w.kickoffRequests, 1, 'no second Kickoff')
  assert.equal(w.broadcasts[0], w.broadcasts[1])
})

await test('two tabs at once: the lock lets only one run (one burn)', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld()
  const held = new Set()
  const withLock = async (key, fn) => {
    if (held.has(key)) throw new Error('already running in another tab')
    held.add(key)
    try {
      return await fn()
    } finally {
      held.delete(key)
    }
  }
  const results = await Promise.allSettled([
    m.runBtcPegOut(params, w.deps(store, { withLock })),
    m.runBtcPegOut(params, w.deps(store, { withLock })),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.match(String(results.find((r) => r.status === 'rejected').reason), /another tab/)
  assert.equal(w.burnsSigned, 1)
  assert.equal(w.kickoffRequests, 1)
})

await test('storage unavailable or not keeping writes: stops BEFORE the burn', async () => {
  const throwing = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } }
  const w1 = fakeWorld()
  await assert.rejects(m.runBtcPegOut(params, w1.deps(m.kvBtcPegOutStore(throwing))), /Could not save/)
  assert.equal(w1.submits, 0)
  assert.equal(w1.burnsApplied, 0)

  const dropping = { getItem: () => null, setItem: () => {} }
  const w2 = fakeWorld()
  await assert.rejects(m.runBtcPegOut(params, w2.deps(m.kvBtcPegOutStore(dropping))), /Could not save/)
  assert.equal(w2.submits, 0)

  const w3 = fakeWorld()
  await assert.rejects(m.runBtcPegOut(params, w3.deps(m.kvBtcPegOutStore(null))), /Could not save/)
  assert.equal(w3.submits, 0)
})

await test('storage fails after the burn: stops before requesting a Kickoff it could not remember', async () => {
  const kv = memKv()
  let writes = 0
  const flaky = {
    getItem: kv.getItem,
    setItem: (k, v) => {
      writes += 1
      if (writes >= 2) throw new Error('QuotaExceededError')
      kv.setItem(k, v)
    },
  }
  const w = fakeWorld()
  await assert.rejects(m.runBtcPegOut(params, w.deps(m.kvBtcPegOutStore(flaky))), /Could not save/)
  assert.equal(w.burnsApplied, 1)
  assert.equal(w.kickoffRequests, 0)
  // Storage back: the saved burn_signed record resumes with no new burn.
  await m.runBtcPegOut(params, w.deps(m.kvBtcPegOutStore(kv)))
  assert.equal(w.burnsSigned, 1)
  assert.equal(w.takes, 1)
})

await test('take: never marked done without a checked, confirmed Bitcoin take', async () => {
  // Empty take response → stays open, retry completes.
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld()
  let empty = true
  const deps = () =>
    w.deps(store, {
      requestTake: async () => {
        w.takes += 1
        return empty ? {} : { signed_btc_tx: TAKE_HEX }
      },
    })
  await assert.rejects(m.runBtcPegOut(params, deps()), /no signed take returned/)
  assert.equal(store.listOpen(ACCOUNT)[0].phase, 'kickoff_broadcast')
  empty = false
  const out = await m.runBtcPegOut(params, deps())
  assert.equal(out.takeTxid, TAKE_TXID)
  assert.deepEqual(w.broadcasts, [KICKOFF_HEX, TAKE_HEX])
  assert.equal(w.burnsSigned, 1)
  assert.equal(w.kickoffRequests, 1)

  // Take broadcast fails → saved as take_broadcast (not done); retry re-sends the SAME take.
  const store2 = m.kvBtcPegOutStore(memKv())
  const w2 = fakeWorld({ takeConfs: null })
  let failTake = true
  const attempts = []
  const deps2 = () =>
    w2.deps(store2, {
      broadcast: async (hex) => {
        attempts.push(hex)
        if (hex === TAKE_HEX && failTake) throw new Error('network timeout')
        w2.broadcasts.push(hex) // only a successful send reaches Bitcoin
        return m.btcTxidFromRaw(hex)
      },
    })
  await assert.rejects(m.runBtcPegOut(params, deps2()), /take broadcast failed/)
  assert.equal(store2.listOpen(ACCOUNT)[0].phase, 'take_broadcast')
  failTake = false
  w2.takeConfs = 1
  await m.runBtcPegOut(params, deps2())
  assert.equal(w2.takes, 1, 'take not requested again')
  assert.deepEqual(attempts, [KICKOFF_HEX, TAKE_HEX, TAKE_HEX])
  assert.equal(store2.listOpen(ACCOUNT).length, 0)
})

await test('take broadcast but unconfirmed: NOT done; resume waits for ≥1 confirmation of that txid', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld({ takeConfs: 0 })
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /not confirmed yet/)
  const rec = store.listOpen(ACCOUNT)[0]
  assert.equal(rec.phase, 'take_broadcast')
  assert.equal(rec.takeTxid, TAKE_TXID)
  // Unknown status is not a confirmation either.
  w.takeConfs = null
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /not confirmed yet/)
  assert.equal(store.listOpen(ACCOUNT)[0].phase, 'take_broadcast')
  // A different tx confirming does not count: only TAKE_TXID is polled.
  const polled = []
  w.takeConfs = 1
  const out = await m.runBtcPegOut(params, w.deps(store, {
    pollConfirmations: async (txid) => {
      polled.push(txid)
      return txid === TAKE_TXID ? w.takeConfs : 0
    },
  }))
  assert.ok(polled.every((t) => t === TAKE_TXID))
  assert.equal(out.takeTxid, TAKE_TXID)
  assert.equal(w.takes, 1)
  assert.equal(w.kickoffRequests, 1)
  assert.equal(w.burnsSigned, 1)
  assert.equal(store.load(ACCOUNT, out.noteId).phase, 'done')
})

await test('take that does not pay this withdrawal is rejected and never broadcast', async () => {
  const otherKick = await m.btcTxidFromRaw(kickoffHex({ vout: 2 }))
  for (const [hex, why] of [
    [takeHex({ paySpk: '0014' + OTHER_H160 }), /pays 0 sats/],
    [takeHex({ destH160: OTHER_H160, paySpk: '0014' + OTHER_H160 }), /dest-lock script/],
    [takeHex({ kickoffTxid: otherKick }), /does not spend this Kickoff/],
    [takeHex({ pay: AMOUNT - 2001 }), /expected 5000/],
    [takeHex({ pay: AMOUNT + 1 }), /expected 5000/],
  ]) {
    const store = m.kvBtcPegOutStore(memKv())
    const w = fakeWorld()
    await assert.rejects(m.runBtcPegOut(params, w.deps(store, { requestTake: async () => ({ signed_btc_tx: hex }) })), why)
    assert.equal(store.listOpen(ACCOUNT)[0].phase, 'kickoff_broadcast')
    assert.deepEqual(w.broadcasts, [KICKOFF_HEX])
  }
  void OTHER_DEST
})

await test('account named "constructor" works (null-prototype store)', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  assert.deepEqual(store.listOpen('constructor'), [])
  assert.equal(store.load('constructor', 'x'), null)
  const now = Date.now()
  store.save({ v: 1, noteId: 'n1', account: 'constructor', network: 't', amountSats: 1, dest: 'd', sequence: 0,
    burnTxId: '', burnRawJson: '', phase: 'burned', createdAt: now, updatedAt: now })
  assert.equal(store.listOpen('constructor').length, 1)
  assert.equal(store.load('__proto__', 'n1'), null)
})

await test('dead burn whose record cannot be cleared: says so, does not claim a fresh start', async () => {
  const kv = memKv()
  const store = m.kvBtcPegOutStore(kv)
  const w = fakeWorld({ sealOnSubmit: false })
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /not confirmed it sealed yet/)
  w.seq += 1
  const ro = { getItem: kv.getItem, setItem: () => { throw new Error('QuotaExceededError') } }
  await assert.rejects(m.runBtcPegOut(params, w.deps(m.kvBtcPegOutStore(ro))), /could not clear its record/)
  assert.equal(w.burnsApplied, 0)
})

await test('resumed kickoff_broadcast with 0 confirmations re-broadcasts the SAME Kickoff', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld({ confs: 0 })
  await assert.rejects(m.runBtcPegOut({ ...params, timing: { ...params.timing, kickoffWaitMs: 1 } }, w.deps(store)), /Wait for 6/)
  assert.equal(w.broadcasts.length, 1)
  w.confs = 6
  let first = true
  await m.runBtcPegOut(params, w.deps(store, {
    pollConfirmations: async () => {
      if (first) { first = false; return 0 } // dropped from mempool
      return 6
    },
  }))
  assert.equal(w.broadcasts.length, 2)
  assert.equal(w.broadcasts[0], w.broadcasts[1])
  assert.equal(w.kickoffRequests, 1)
  assert.equal(w.burnsSigned, 1)
})

await test('resumed Kickoff, input spent elsewhere, 0 confs: kept unless a different spender is ≥6 deep', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld({ confs: 0 })
  await assert.rejects(m.runBtcPegOut({ ...params, timing: { ...params.timing, kickoffWaitMs: 1 } }, w.deps(store)))
  w.failBroadcast = 1
  w.broadcastError = 'bad-txns-inputs-missingorspent'
  // 0 confirmations alone (old behaviour) is NOT enough to replace it.
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /could not be proven/)
  assert.equal(store.listOpen(ACCOUNT)[0].phase, 'kickoff_broadcast')
  assert.equal(w.kickoffRequests, 1)
  w.failBroadcast = 1
  w.spender = spentBy('b'.repeat(64), { height: 100, tips: [110, 110] })
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /can never confirm/)
  assert.equal(store.listOpen(ACCOUNT)[0].phase, 'burned')
  w.confs = 6
  await m.runBtcPegOut(params, w.deps(store))
  assert.equal(w.kickoffRequests, 2)
  assert.equal(w.burnsSigned, 1)
})

await test('resumed Kickoff with UNKNOWN status: re-sent as the same tx; spent input never triggers a new Kickoff', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld({ confs: 0 })
  await assert.rejects(m.runBtcPegOut({ ...params, timing: { ...params.timing, kickoffWaitMs: 1 } }, w.deps(store)))
  const unknownPoll = { pollConfirmations: async () => { throw new Error('Tx not found yet') } }
  w.failBroadcast = 1
  w.broadcastError = 'bad-txns-inputs-missingorspent'
  await assert.rejects(m.runBtcPegOut(params, w.deps(store, unknownPoll)), /could not be proven/)
  assert.equal(store.listOpen(ACCOUNT)[0].phase, 'kickoff_broadcast')
  assert.equal(w.kickoffRequests, 1, 'no new Kickoff on unknown status')
  assert.equal(w.broadcasts.length, 2)
  assert.equal(w.broadcasts[0], w.broadcasts[1])
  assert.equal(w.burnsSigned, 1)
})

await test('dynamic Kickoff max: blocks a fresh burn, never a resume', async () => {
  const w0 = fakeWorld()
  await assert.rejects(
    m.runBtcPegOut({ ...params, maxFreshSats: AMOUNT - 1 }, w0.deps(m.kvBtcPegOutStore(memKv()))),
    /at most/,
  )
  assert.equal(w0.burnsSigned, 0)
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld({ confs: 2 })
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /Wait for 6/)
  w.confs = 6
  await m.runBtcPegOut({ ...params, maxFreshSats: 0 }, w.deps(store)) // output already spent by our Kickoff
  assert.equal(w.takes, 1)
  assert.equal(w.burnsSigned, 1)
})

await test('records live under a per-account key (other accounts cannot overwrite them)', async () => {
  const kv = memKv()
  const a = m.kvBtcPegOutStore(kv)
  const b = m.kvBtcPegOutStore(kv)
  const now = Date.now()
  const rec = (account, noteId) => ({ v: 1, noteId, account, network: 't', amountSats: 1, dest: 'd', sequence: 0,
    burnTxId: '', burnRawJson: '', phase: 'kickoff_signed', createdAt: now, updatedAt: now })
  // Interleaved writers for different accounts (stale reads cannot clobber).
  a.save(rec('alice', 'n1'))
  b.save(rec('bob', 'n2'))
  a.save(rec('alice', 'n3'))
  assert.equal(a.listOpen('alice').length, 2)
  assert.equal(a.listOpen('bob').length, 1)
  assert.ok([...kv.map.keys()].every((k) => k.startsWith(m.BTC_PEGOUT_STORE_KEY + ':')))
})

await test('in-flight burn commits during the chain check: no fresh burn is signed', async () => {
  const w = fakeWorld()
  const lostRaw = JSON.stringify({ sequence: w.seq, amount: AMOUNT + 3, dest: DEST })
  const deps = w.deps(m.kvBtcPegOutStore(memKv()), {
    listChainWithdrawals: async () => {
      const snapshot = w.chainNotes.slice() // list taken BEFORE the commit…
      w.apply(lostRaw) // …then the lost in-flight burn commits
      return snapshot
    },
  })
  await assert.rejects(m.runBtcPegOut(params, deps), /changed on Falcon PL while/)
  assert.equal(w.burnsSigned, 0)
  assert.equal(w.burnsApplied, 1)
})

await test('done records become compact tombstones and are never evicted', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const now = Date.now()
  for (let i = 0; i < 2100; i++) {
    store.save({ v: 1, noteId: `n${i}`, account: 'alice', network: 't', amountSats: 1000 + i, dest: 'd', sequence: i,
      burnTxId: 'b', burnRawJson: '{"big":"payload"}', signedKickoffHex: 'ab', phase: 'done', createdAt: now, updatedAt: now })
  }
  for (let i = 0; i < 2100; i += 1) {
    const r = store.load('alice', `n${i}`)
    assert.equal(r.phase, 'done')
    assert.equal(r.burnRawJson, '')
    assert.equal(r.signedKickoffHex, undefined)
  }
})

await test('a duplicate-input validation failure is NOT "already known": take not marked done', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld()
  let n = 0
  await assert.rejects(
    m.runBtcPegOut(params, w.deps(store, {
      broadcast: async (hex) => {
        n += 1
        if (n === 2) throw new Error('bad-txns-inputs-duplicate')
        return m.btcTxidFromRaw(hex)
      },
    })),
    /take broadcast failed/,
  )
  assert.equal(store.listOpen(ACCOUNT)[0].phase, 'take_broadcast')
})

await test('mismatched txids are rejected (Kickoff and take)', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld()
  const bad = 'c'.repeat(64)
  await assert.rejects(
    m.runBtcPegOut(params, w.deps(store, { broadcast: async () => bad })),
    /different txid/,
  )
  assert.equal(store.listOpen(ACCOUNT)[0].phase, 'kickoff_signed')
  assert.equal(store.listOpen(ACCOUNT)[0].kickoffTxid, KICKOFF_TXID)
  await assert.rejects(
    m.runBtcPegOut(params, w.deps(store, { requestTake: async () => ({ take_txid: bad, signed_btc_tx: TAKE_HEX }) })),
    /does not match its signed transaction/,
  )
  assert.equal(store.listOpen(ACCOUNT)[0].phase, 'kickoff_broadcast')
  assert.equal(w.kickoffRequests, 1)
  assert.equal(w.burnsSigned, 1)
})

await test('corrupt saved records: refuses to run and never overwrites them', async () => {
  const kv = memKv()
  const key = `${m.BTC_PEGOUT_STORE_KEY}:${encodeURIComponent(ACCOUNT)}`
  kv.setItem(key, '{not json')
  const store = m.kvBtcPegOutStore(kv)
  const w = fakeWorld()
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /unreadable/)
  assert.equal(w.burnsSigned, 0)
  assert.throws(() => store.save({ v: 1, noteId: 'x', account: ACCOUNT, phase: 'burned' }), /unreadable/)
  assert.throws(() => store.listOpen(ACCOUNT), /unreadable/)
  assert.equal(kv.getItem(key), '{not json', 'left untouched')
  kv.setItem(key, '[1,2]')
  assert.throws(() => store.load(ACCOUNT, 'x'), /unreadable/)
})

await test('stored record that does not match this withdrawal is refused (nothing signed)', async () => {
  for (const patch of [
    { v: 2 },
    { amountSats: AMOUNT + 1 },
    { network: 'mainnet' },
    { dest: OTHER_DEST },
    { account: 'mallory' },
    { claimSats: AMOUNT + 9 },
    { kickoffTxid: 'c'.repeat(64) },
    { signedKickoffHex: kickoffHex({ amount: AMOUNT - 1 }) },
    { phase: 'weird' },
  ]) {
    const kv = memKv()
    const store = m.kvBtcPegOutStore(kv)
    const w = fakeWorld({ confs: 2 })
    await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /Wait for 6/)
    const rec = store.listOpen(ACCOUNT)[0]
    const key = `${m.BTC_PEGOUT_STORE_KEY}:${encodeURIComponent(ACCOUNT)}`
    kv.setItem(key, JSON.stringify([{ ...rec, ...patch }]))
    const before = w.broadcasts.length
    w.confs = 6
    await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /does not match it/, JSON.stringify(patch))
    assert.equal(w.broadcasts.length, before)
    assert.equal(w.takes, 0)
    assert.equal(w.kickoffRequests, 1)
  }
})

await test('dest address forms: P2WPKH and P2PKH accepted, others refused', async () => {
  assert.equal(await m.btcDestScriptPubKey(DEST), DEST_SPK)
  // Known testnet P2PKH vector (hash160 of 0x00…): mfWxJ45yp2SFn7UciZyNpvDKrzbhyfKrY8
  assert.equal(
    await m.btcDestScriptPubKey('mfWxJ45yp2SFn7UciZyNpvDKrzbhyfKrY8'),
    '76a914' + '00'.repeat(20) + '88ac',
  )
  await assert.rejects(m.btcDestScriptPubKey(DEST.slice(0, -1) + (DEST.endsWith('q') ? 'p' : 'q')), /checksum/)
  await assert.rejects(m.btcDestScriptPubKey('2N3oefVeg6stiTb5Kh3ozCSkaqmx91FDbsm'), /only P2PKH/)
})

console.log(`\n${passed} BTC peg-out resume checks passed`)
