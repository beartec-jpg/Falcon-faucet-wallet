# Portal documentation index

**Current testnet:** Falcon PL **2300**. Last updated **2026-08-26**.  
Falcon Ledger / XRPL fork **1001** is shut down.

## Read first

| Doc | Role |
|-----|------|
| [BRIDGES-2300.md](BRIDGES-2300.md) | Portal dest-lock rails (ETH, USDC, BTC) |
| [ROADMAP.md](ROADMAP.md) | Shipped vs next |
| Protocol [BRIDGES_2300_STATUS.md](https://github.com/beartec-jpg/Falcon-PL/blob/fix/pl-multihost-state-determinism/falcon-pl-rs/crates/fd-pl/docs/BRIDGES_2300_STATUS.md) | **Source of truth** for contracts, trust model, e2e |
| In-app `/whitepaper` | Protocol paper (v5.1). Not an audit. |

## Historical (1001 / pre dest-lock)

| Path | Role |
|------|------|
| [archive-1001/README.md](archive-1001/README.md) | Index of 1001 PDFs and lock-mint reports |
| `Docs/*.pdf` | Same PDFs served at `/Docs/…` so old links work; labeled historical in the whitepaper |
| [MULTI-CHAIN-IMPLEMENTATION.md](MULTI-CHAIN-IMPLEMENTATION.md) | 1001 lock-mint implementation |
| [BRIDGE-AND-CUSTODY-HARDENING-PLAN.md](BRIDGE-AND-CUSTODY-HARDENING-PLAN.md) | SPV/shared-reserve hardening — not dest-lock |
| [TESTNET-E2E-REPORT.md](TESTNET-E2E-REPORT.md) | 1001 e2e |
| [HARDENING.md](HARDENING.md), [HARDENING-CONTINUATION-PLAN.md](HARDENING-CONTINUATION-PLAN.md) | Portal hardening, 1001-era |

Do not send funds using addresses in historical files.
