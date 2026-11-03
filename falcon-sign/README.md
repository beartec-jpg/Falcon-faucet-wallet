# Falcon Sign SDK

Falcon-512 post-quantum keys, signing and verification, and transaction
building, signing and submission for the **Falcon PL (FPL) testnet**.
Byte-compatible with the Falcon wallet (`src/lib/pl-wallet-sign.ts`) and the
Rust node (`Falcon-PL/falcon-pl-rs/crates/fd-pl`). Apache-2.0.

> Falcon PL is a testnet. FPL testnet tokens have no monetary value.

| Folder | What |
|---|---|
| `ts/` | `@beartec/falcon-sign`, TypeScript, Node ≥ 20 and browsers (ESM) |
| `rust/` | `falcon-sign` crate, same format, `pqcrypto-falcon` like the node |
| `compat/` | test harness linking the node's `fd-pl` crate |
| `scripts/test-compat.sh` | one command for all tests and cross-compat vectors |
| `vectors/` | generated vectors; `txid-golden.json` is produced by the node's code |

## Format (from the node)

```
payload   = "pl-tx:v2|{account}|{sequence}|{destination}|{amount}|{fee}|{network_id}|{body_json}"
signature = Falcon-512 detached signature over UTF-8(payload), hex
tx_id     = hex(SHA-256(UTF-8(payload)))
```

`body_json` is exactly `serde_json::to_string(&TxBody)`: `{"kind":"<snake_case>", ...fields in declared order}`.
The node re-serialises the body it parsed, so field order and integer encoding
must match; the SDK writes u64s as exact JSON integers (bigint/string inputs
are fine, no JS-number rounding). `public_key` is the raw 897-byte key in hex
(no `0xFB` prefix). Testnet `network_id` is 2300; default fee is 2.

## TypeScript

```bash
npm install @beartec/falcon-sign   # or: file:falcon-sign/ts
```

```ts
import { generateKeyPair, encodeFalconSecret, keyPairFromFalconSecret,
         sign, verify, build, signTx, verifyTx, GatewayClient } from '@beartec/falcon-sign'

// Keys
const kp = await generateKeyPair()          // { publicKey, secretKey, publicKeyHex, address, destroy() }
const backup = encodeFalconSecret(kp)       // wallet falcon_secret format (keep it secret)
const same = keyPairFromFalconSecret(backup)

// Raw sign / verify
const sig = await sign('hello', kp)
await verify('hello', sig, kp.publicKeyHex) // true

// Build, sign, submit a transfer
const gw = new GatewayClient({ apiKey: process.env.FPL_GATEWAY_KEY }) // header x-api-key
const acct: any = await gw.getAccount(kp.address)
const tx = build.transfer({ account: kp.address, sequence: acct.sequence ?? 0, destination: 'rDest...', amount: 1_000n })
const signed = await signTx(tx, kp)         // { json, txId, tx }
console.log(await verifyTx(signed))         // { ok: true, txId }
await gw.submitTx(signed)                   // fpl_submitTx with the exact wire JSON
kp.destroy()
```

Builders (`build.*`, all take `account`, `sequence`, optional `fee`, `networkId`):
`transfer`, `assetTransfer` (BTC/BTC4/ETH/USDC), `transferToKey`, `swapRoute`,
`addLiquidity`, `removeLiquidity`, `lendSupply`, `lendWithdraw`, `lendBorrow`,
`lendRepay`, `vaultOpen`, `vaultLock`, `claim`, `watcherHeartbeat`,
`railWithdraw`, `setExternalAddr`, `placeLimitOrder`, `cancelOrder`.
For anything else build an `UnsignedTx` with a `TxBody` from `BODY_SPEC`.

Gateway client: `status`, `health`, `getAccount`, `orderBook`, `openOrders`,
`fills`, `submitTx`, `gatewayHealth`, `tiers`, `usage`, and raw `rpc()`. Key in
`X-API-Key` (or `authHeader: 'bearer'`). On HTTP 429 with `Retry-After` it waits
and retries (`maxRetries`, default 3); a monthly-quota 429 (no `Retry-After`) is
thrown at once as `GatewayError`. The key is never logged (`toJSON` redacts it).

Browser: the liboqs WASM loads via dynamic import; bundlers handle it. For an
offline page you can pass your own backend with `setFalconBackend()`.

## Rust

```rust
use falcon_sign::{Keypair, UnsignedTx, TxBody};
let kp = Keypair::generate();
let tx = UnsignedTx::transfer(&address, seq, "rDest...", 1000).sign(&kp);
tx.verify()?;
let wire = tx.to_json(); // POST as params.tx to fpl_submitTx
```

The crate has no gateway client yet (see below).

## Tests

```bash
FPL_NODE_DIR=/path/to/Falcon-PL ./scripts/test-compat.sh   # or omit to clone e265e21
```

1. Rust crate unit tests.
2. The node's own code (`fd-pl` `Tx::sign_body`) signs every common tx kind and
   writes tx-id goldens; Rust-crate-signed txs are verified by `fd-pl Tx::verify`.
3. TS: unit tests; the wallet's signing code signs every kind it supports and
   the SDK must verify it with identical tx ids; the SDK verifies all
   node-signed vectors and matches the node's tx ids and body JSON.
4. `fd-pl Tx::verify` checks every SDK-signed and wallet-signed tx.

## Later
- Gateway client and builders for the Rust crate; publish to npm / crates.io.
