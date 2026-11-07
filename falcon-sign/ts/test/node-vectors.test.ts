// Verifies vectors produced by the Rust node's own code (compat/ → fd-pl).
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { verifyTx, txId, serializeBody, parseTxJson, type TxBody } from '../src/index.js'

const f = new URL('../../vectors/node-signed.json', import.meta.url)
const g = new URL('../../vectors/txid-golden.json', import.meta.url)
const need = process.env.REQUIRE_NODE_VECTORS === '1'

describe.skipIf(!need && !existsSync(f))('node -> SDK', () => {
  it('node-signed txs (fd-pl Tx::sign_body / falcon-sign crate) verify in the SDK', async () => {
    const v = JSON.parse(readFileSync(f, 'utf8')) as { name: string; json: string }[]
    expect(v.length).toBeGreaterThan(5)
    for (const t of v) expect(await verifyTx(t.json), t.name).toMatchObject({ ok: true })
  })
  it('tx ids and body JSON match fd-pl for golden inputs', () => {
    const v = JSON.parse(readFileSync(g, 'utf8')) as { name: string; tx: string; body_json: string; payload: string; tx_id: string }[]
    for (const t of v) {
      const p = parseTxJson(t.tx)
      expect(serializeBody(p.body as TxBody), t.name).toBe(t.body_json)
      expect(txId({ account: p.account, sequence: p.sequence, destination: p.destination, amount: p.amount, fee: p.fee, networkId: p.network_id, body: p.body }), t.name).toBe(t.tx_id)
    }
  })
})
