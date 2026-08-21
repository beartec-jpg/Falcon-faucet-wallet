# Falcon faucet wallet — 2300 bridge paperwork

**Last updated:** 2026-08-21  
**Network the portal talks to:** Falcon PL **2300**  
**ETH/USDC dest-lock in and out are live.** Wallet deposit auto-mints on Falcon PL. Bridge out burns on Falcon PL, waits for a sampled LC header, then `openClaim`/`take` dest-locked to your Sepolia 0x. BTC stays closed (`BTC_RAIL_LIVE = false`). Do not send BTC. Do not send to old 1001 collateral locks.

The protocol-side living report is [`falcon-pl-rs/crates/fd-pl/docs/BRIDGES_2300_STATUS.md`](https://github.com/beartec-jpg/Falcon-PL) (on the operator tree: `~/falcon-pl/falcon-pl-rs/crates/fd-pl/docs/BRIDGES_2300_STATUS.md`).

Classic **XRPL FXRP** stays a separate corridor. The Falcon Ledger / XRPL-fork **1001** network is shut down; `public/config/usdc-bridge.json` still describes that old collateral lock and must **not** be used for 2300 dest-lock.

---

## Config on this repo

| File | Role |
|------|------|
| `public/config/pl-2300-bridge.json` | Dest-lock ETH/USDC (`FalconBridge`). `status` is **`live`**. |
| `src/lib/pl-dest-lock.ts` | Peg-in: `depositEth`/`depositUsdc` then `mint-eth-deposit`. Peg-out: signed `RailWithdraw` then `openClaim`/`take`. `dest20 = sha256(lowercase PL account)[:20]`. |
| `public/config/usdc-bridge.json` | **1001 / old FalconCollateralLock** — keep for FXRP/classic notes; do not overwrite with 2300 dest-lock. |
| `src/lib/pl-btc-rail.ts` | BTC rail. **`BTC_RAIL_LIVE = false`**. |

## Live Sepolia dest-lock

- FalconBridge: `0x7eB72974F2d2a4AaDFabAf0975a29470fcd163E4`
- Groth16Verifier: `0x7db9b1862AE7D04cE9ff85447390bDdfa972a9d0`
- USDC (Sepolia Circle): `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
- `startHeight`: 121064 · sampled FPL headers (Groth16 of 4-of-6 LC Schnorr)

## Retired / never send

`0x2dae31…`, `0x11808B…`, `0x19b852…`, `0xE660de…`, `tb1q7dnl…`, `tb1qesum…`, unpublished FROST P2TR.

## Historical PDFs in `Docs/`

July–August 2026 security / e2e / lending PDFs describe **network 1001** Falcon Ledger. They are snapshots of that fork. They are **not** the 2300 dest-lock / FROST / Groth16 design. Leave them as dated artifacts; this file + `pl-2300-bridge.json` are the current portal paperwork.
