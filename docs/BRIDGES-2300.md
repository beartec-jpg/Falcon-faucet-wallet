# Falcon faucet wallet — 2300 dest-lock bridges

**Last updated:** 2026-08-26  
**Network the portal talks to:** Falcon PL **2300**  
**Not an audit. Not mainnet.**

Protocol source of truth: [`BRIDGES_2300_STATUS.md`](https://github.com/beartec-jpg/Falcon-PL/blob/fix/pl-multihost-state-determinism/falcon-pl-rs/crates/fd-pl/docs/BRIDGES_2300_STATUS.md) in **Falcon-PL**. If this file and that file disagree, fix both.

---

## Live rails (testnet)

| Rail | In | Out | Wallet |
|------|----|-----|--------|
| **ETH** Sepolia → FETH | `depositEth(dest20)` then auto-mint | burn → sampled LC header → `openClaim` / `take` to your 0x | `pl-2300-bridge.json` `status: live` |
| **USDC** Sepolia → F-USDC | `depositUsdc` then auto-mint | same | same |
| **BTC** testnet → FBTC | pay FROST P2TR + FALC dest memo; SPV mint after 6 confs | burn → FROST Kickoff dest-lock → CSV=6 take | `BTC_RAIL_LIVE = true` |

`dest20 = sha256(lowercase PL account)[:20]`.

### Honest custody model

- **ETH/USDC:** no owner, no admin `withdraw` on `FalconBridge`. Funds dest-lock to the user’s 0x on the way out. Trust Groth16 of **4-of-6 LC** and **sampled** FPL headers. Auto-mint can delay a peg-in; it cannot drain the Sepolia pool.
- **BTC:** no COMPLETE file, no operator `withdraw`. Kickoff is still **t=4 of n=6 FROST**. After Kickoff, only the dest Bitcoin key (CSV) or a published abort after a valid challenge.
- Classic **XRPL FXRP** is a separate corridor. Falcon Ledger **1001** is shut down.

### Live addresses (testnet only)

| Item | Value |
|------|--------|
| FalconBridge (Sepolia) | `0x7eB72974F2d2a4AaDFabAf0975a29470fcd163E4` |
| Groth16Verifier | `0x7db9b1862AE7D04cE9ff85447390bDdfa972a9d0` |
| Sepolia USDC (Circle) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| `startHeight` | 121064 · sampled headers |
| BTC vault FROST P2TR t=4/n=6 | `tb1pj9d6d6eaayw7f7hc3mr2lm3xhuscuhtw6kpjqz5jvvuf4mh2lduq2pqytm` |

### Config / code on this repo

| File | Role |
|------|------|
| `public/config/pl-2300-bridge.json` | Dest-lock ETH/USDC. `status: live`. |
| `src/lib/pl-dest-lock.ts` | `depositEth` / `depositUsdc`, `openClaim` / `take`. |
| `src/lib/pl-btc-rail.ts` | BTC rail. **`BTC_RAIL_LIVE = true`**. |
| `public/config/usdc-bridge.json` | **1001 / old FalconCollateralLock** + FXRP notes. Do not use for 2300 dest-lock. |

## Retired / never send

`0x2dae31…`, `0x11808B…`, `0x19b852…`, `0xE660de…`, `tb1q7dnl…`, `tb1qesum…`.

## Historical PDFs in `Docs/`

July–August 2026 security / e2e / lending PDFs describe **network 1001** Falcon Ledger (custodial lock-mint). See [archive-1001/README.md](archive-1001/README.md). They are **not** the 2300 dest-lock / FROST / Groth16 design. The in-app whitepaper lists them as historical downloads.
