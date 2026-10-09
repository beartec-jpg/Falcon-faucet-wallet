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
const DEST = 'tb1qexampledestaddress0000000000000000000'
const AMOUNT = 5000

function memKv() {
  const map = new Map()
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v), map }
}

// Legacy genesis coinbase (txid known) + a segwit wrapper of it (txid must not change).
const GENESIS_RAW =
  '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000'
const GENESIS_TXID = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b'
const segwitOf = (raw) => raw.slice(0, 8) + '0001' + raw.slice(8, -8) + '0140' + 'ab'.repeat(64) + raw.slice(-8)

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
    failKickoff: 0,
    failBroadcast: 0,
    broadcastError: 'network timeout',
    failSubmit: 0,
    sealOnSubmit: true,
    ...opts,
  }
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
      return { signed_btc_tx: segwitOf(GENESIS_RAW), amount: AMOUNT }
    },
    broadcast: async (hex) => {
      w.broadcasts.push(hex)
      if (w.failBroadcast > 0) {
        w.failBroadcast -= 1
        throw new Error(w.broadcastError)
      }
      return GENESIS_TXID
    },
    pollConfirmations: async () => w.confs,
    requestTake: async () => {
      w.takes += 1
      return { take_txid: 'f'.repeat(64) }
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
  timing: { burnWaitMs: 20_000, kickoffWaitMs: 60_000 },
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
  assert.equal(out.kickoffTxid, GENESIS_TXID)
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
  assert.equal(w.broadcasts.length, 2)
  assert.equal(w.broadcasts[0], w.broadcasts[1])
})

await test('"already in mempool" broadcast still learns the Kickoff txid', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld({ failBroadcast: 1, broadcastError: 'txn-already-in-mempool' })
  const out = await m.runBtcPegOut(params, w.deps(store))
  assert.equal(out.kickoffTxid, GENESIS_TXID)
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
  assert.equal(w.broadcasts.length, 1)
  assert.equal(w.takes, 1)
})

await test('Kickoff input spent by another tx: retry gets a new Kickoff, still no new burn', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld({ failBroadcast: 1, broadcastError: 'bad-txns-inputs-missingorspent', confs: 0 })
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /input was already spent/)
  assert.equal(store.listOpen(ACCOUNT)[0].phase, 'burned')
  w.confs = 6
  await m.runBtcPegOut(params, w.deps(store))
  assert.equal(w.burnsSigned, 1)
  assert.equal(w.kickoffRequests, 2)
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
  await assert.rejects(m.runBtcPegOut(params, deps()), /status could not be checked/)
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

await test('take: never marked done without a Bitcoin take; signed take is broadcast', async () => {
  // Empty take response → stays open, retry completes.
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld()
  let empty = true
  const deps = () =>
    w.deps(store, {
      requestTake: async () => {
        w.takes += 1
        return empty ? {} : { signed_btc_tx: GENESIS_RAW }
      },
    })
  await assert.rejects(m.runBtcPegOut(params, deps()), /take returned no Bitcoin transaction/)
  assert.equal(store.listOpen(ACCOUNT)[0].phase, 'kickoff_broadcast')
  empty = false
  const out = await m.runBtcPegOut(params, deps())
  assert.equal(out.takeTxid, GENESIS_TXID)
  assert.equal(w.broadcasts.length, 2) // Kickoff once + take once
  assert.equal(w.burnsSigned, 1)
  assert.equal(w.kickoffRequests, 1)

  // Take broadcast fails → stays open (not done).
  const store2 = m.kvBtcPegOutStore(memKv())
  const w2 = fakeWorld()
  let failTake = true
  await assert.rejects(
    m.runBtcPegOut(
      params,
      w2.deps(store2, {
        requestTake: async () => ({ signed_btc_tx: GENESIS_RAW }),
        broadcast: async (hex) => {
          w2.broadcasts.push(hex)
          if (hex === GENESIS_RAW && failTake) throw new Error('network timeout')
          return GENESIS_TXID
        },
      }),
    ),
    /take broadcast failed/,
  )
  assert.equal(store2.listOpen(ACCOUNT)[0].phase, 'kickoff_broadcast')
  failTake = false
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

await test('resumed kickoff_broadcast whose input was spent elsewhere: new Kickoff, no new burn', async () => {
  const store = m.kvBtcPegOutStore(memKv())
  const w = fakeWorld({ confs: 0 })
  await assert.rejects(m.runBtcPegOut({ ...params, timing: { ...params.timing, kickoffWaitMs: 1 } }, w.deps(store)))
  w.failBroadcast = 1
  w.broadcastError = 'bad-txns-inputs-missingorspent'
  await assert.rejects(m.runBtcPegOut(params, w.deps(store)), /input was already spent/)
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
  await assert.rejects(m.runBtcPegOut(params, w.deps(store, unknownPoll)), /status is unknown/)
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

console.log(`\n${passed} BTC peg-out resume checks passed`)
