// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
/**
 * Wallet `SetExternalAddrs` tx vs the Falcon PL node (fd-pl, Falcon-PL main e265e21).
 *
 * The node's `TxBody` is `#[serde(tag = "kind", rename_all = "snake_case")]`, so the
 * variant is `{"kind":"set_external_addrs","chain":…,"address":…}`. `set_external_addr`
 * is only a deserialize alias: the node rebuilds the signed payload with
 * `serde_json::to_string(&body)` (always `set_external_addrs`), so a tx signed over the
 * alias fails signature verification. The wallet must sign the canonical kind.
 *
 * 1. Golden: tests/fixtures/node-set-external-addrs.golden.json is produced by fd-pl's
 *    own `Tx::payload` (tests/node-compat `gen`). The wallet must produce the same
 *    payload bytes, body JSON and tx_id.
 * 2. Signed vectors: tests/fixtures/wallet-set-external-addrs.signed.json holds real
 *    wallet-signed txs (throwaway key, public key only) that tests/node-compat `verify`
 *    parses as fd-pl `Tx` and checks with `Tx::verify`. Regenerate with
 *    WRITE_NODE_COMPAT_VECTORS=1 (done by tests/node-compat/run.sh).
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { createFalcon512 } from '@openforge-sh/liboqs/sig'

vi.mock('@/lib/falcon-wasm', () => {
  let f: Promise<unknown> | null = null
  return { getFalcon512: () => (f ??= import('@openforge-sh/liboqs/sig').then(m => m.createFalcon512())) }
})

const FIX = new URL('./fixtures/', import.meta.url)
type Golden = {
  account: string; sequence: number; destination: string; amount: number; fee: number; network_id: number
  chain: string; address: string; body_json: string; payload: string; tx_id: string
}
const golden: Golden[] = JSON.parse(readFileSync(new URL('node-set-external-addrs.golden.json', FIX), 'utf8'))

async function throwawaySecret(): Promise<string> {
  const K = await import('@/lib/falcon-keys')
  const f = await createFalcon512()
  const kp = f.generateKeyPair() as { publicKey: Uint8Array; secretKey: Uint8Array }
  return K.encodeFalconSecret(K.buildPubBlob(kp.publicKey), kp.secretKey)
}

describe('SetExternalAddrs: wallet matches the Falcon PL node', () => {
  it('payload, body JSON and tx_id equal fd-pl Tx::payload goldens', async () => {
    const { signPlSetExternalAddr } = await import('@/lib/pl-wallet-sign')
    const secret = await throwawaySecret()
    expect(golden.length).toBeGreaterThan(0)
    for (const g of golden) {
      // Uppercase / padded input must normalize like the node does.
      const tx = await signPlSetExternalAddr({
        account: g.account, chain: ` ${g.chain.toUpperCase()} `, address: g.address, sequence: g.sequence,
        fee: g.fee, networkId: g.network_id, falconSecret: secret,
      })
      expect(tx.tx_id).toBe(g.tx_id)
      expect(JSON.stringify(tx.body)).toBe(g.body_json)
      expect(tx.body.kind).toBe('set_external_addrs')
      expect(tx.destination).toBe('')
      expect(tx.amount).toBe(0)
      // Signature verifies over the node's exact payload bytes.
      const f = await createFalcon512()
      const pub = new Uint8Array(Buffer.from(tx.public_key, 'hex'))
      expect(f.verify(new TextEncoder().encode(g.payload), new Uint8Array(Buffer.from(tx.signature, 'hex')), pub)).toBe(true)
    }
  })

  it('writes wallet-signed vectors for fd-pl Tx::verify (tests/node-compat)', async () => {
    const { signPlSetExternalAddr } = await import('@/lib/pl-wallet-sign')
    const secret = await throwawaySecret()
    const out: Array<{ name: string; json: string; expect?: 'reject' }> = []
    for (const g of golden) {
      const tx = await signPlSetExternalAddr({
        account: g.account, chain: g.chain, address: g.address, sequence: g.sequence,
        fee: g.fee, networkId: g.network_id, falconSecret: secret,
      })
      const json = JSON.stringify(tx)
      out.push({ name: `wallet:${g.chain}:${g.address || 'remove'}`, json })
      // The pre-fix wire kind must stay rejected by the node.
      out.push({ name: `legacy-kind:${g.chain}:${g.address || 'remove'}`, json: json.replace('"set_external_addrs"', '"SetExternalAddr"'), expect: 'reject' })
    }
    expect(out.filter(o => !o.expect).every(o => o.json.includes('"kind":"set_external_addrs"'))).toBe(true)
    if (process.env.WRITE_NODE_COMPAT_VECTORS === '1') {
      writeFileSync(new URL('wallet-set-external-addrs.signed.json', FIX), JSON.stringify(out, null, 2) + '\n')
    }
  })
})
