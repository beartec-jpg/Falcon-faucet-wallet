> **HISTORICAL (Falcon Ledger 1001 / pre dest-lock).** Not the live 2300 product.
> Current: [BRIDGES-2300.md](BRIDGES-2300.md) · [README.md](README.md).
> Archive index: [archive-1001/README.md](archive-1001/README.md).

# BTC Bridge hardening — audit + continuation plan

**Date:** 2026-08-03  
**Audience:** Production hardening (mainnet path), not a feature wishlist  
**Sources:** Scott status mail, `BRIDGE-AND-CUSTODY-HARDENING-PLAN.md` (W1–W5), live fleet check, production program (Phases 0–3)

---

## 0. Executive summary

| Layer | Status (2026-08-03) |
|-------|---------------------|
| **Falcon SPV headers** | **Green** — tip lag ≈ **0** (was “thousands behind” in the mail) |
| **Portal hardening (origin/main)** | **Shipped** as `c3936e8` (W1.3/1.5/1.7, W2 tiers, W3.4 script, lag banner) |
| **This machine `main`** | **Behind origin by 3 commits** — pull before more portal work |
| **Fleet redeemer** | **Running but stuck** on open burn **#12764 (90k)** — no **single** mature UTXO ≥ ~90.5k (fragmented vault) |
| **True permissionless headers / real challenge / bonds** | **Not done** — still fleet-ops + residual free COMPLETE leaf |
| **Mainnet gate** | **Not green** — economic + reorg + multi-submitter still open |

**Bottom line:** Portal fail-closed + visibility is largely done. Next risk reduction is **ops/fleet** (UTXO consolidation + redeemer reliability), then **protocol** (multi-submitter, engine validation, CSV/challenge), then **economic** (bonds, pause, audit).

---

## 1. Work already done (honest inventory)

### 1.1 Portal (faucet-wallet) — **done / mostly done**

From plan + `c3936e8` + prior bridge work:

| ID | Item | Evidence |
|----|------|----------|
| — | SPV peg-in/out E2E UX, trackers, prove path | Bridge panel, withdraw tracker |
| — | Explorer **Bitcoin Bridge suite** | `/scan` tab + `/api/scan/btc-bridge` |
| — | WP4 v3 hold config in portal | `btc-spv-bridge.json` watch `tb1q7dnl…` / hash `44AB2A…` |
| — | Deposit tracker multi-layer restore + chain `list_deposits` | `btc-spv-pending.ts`, API action |
| W1.3 | Independent Merkle verify | `src/lib/btc-merkle.ts` (+ server path in PR) |
| W1.5 | Header lag banner + status fields | Bridge UI + SPV status API |
| W1.7 / W2 | Claim preflight: headers, **value-tier confs**, reorg buffer, **retired watches** | `btc-spv-policy.ts`, config `conf_tiers` |
| W3.4 | Config ↔ chain verify script | `npm run verify:btc-bridge-config` |
| W3.6 | Peg-out card honesty (burn#, challenge) | Bridge out UI |
| W4.7 | Vault backup hygiene (small) | Orthogonal |

**Not done on portal (still):** dual independent full-node RPC (still dual *explorers*), claim **pause** flag, reorg **clawback** of minted FBTC (engine), cold keygen (W4.1–4.2).

### 1.2 Fleet / protocol (qXRP + 46.224) — **partial**

| Item | Status |
|------|--------|
| Dual header submitters | **Live** (`btc-header-submitter` + `qxrp-spv-headers`) — lag **0** now |
| Secure redeemer (solvent + fee wallet) | **Live** |
| Challenger live + instance watch | **Live** |
| Solvency cron | **Live** |
| v3 SetWatch + migrate | **Done** (product hold cut over) |
| Lab two_phase + fraud race | **Passed** (testnet lab) |
| Multi-party **permissionless** submit + bonds | **Not done** (still ops daemons) |
| Real challenge leaf (not free COMPLETE residual) | **Not done** (v3 still CSV + public preimage model) |
| Redeemer multi-input / consolidate | **Missing** — causes unpaid large burns |
| Engine reorg clawback / pause bit | **Not done** |
| Metrics pipeline (Prometheus/alerts) | **Partial** (logs + explorer suite only) |

### 1.3 Live testnet snapshot (fleet)

```
falcon_tip ≈ btc_tip     lag 0
watch                     44AB2A… (v3)
open unpaid               #12764 90_000 sats (no BtcTxID)
redeemer                  need>=90546; mature max piece 90_000 — cannot pay without consolidate/multi-in
hold mature               ~210k sats fragmented
```

Headers are **no longer** the blocker described in the mail. **UTXO fragmentation + open burns** are.

---

## 2. Map: production program ↔ our workstreams

| Production program | Plan ID | Status |
|--------------------|---------|--------|
| Phase 0 freeze & measure | W5.2, metrics | **Partial** — Explorer suite + logs; no formal risk budget doc |
| Phase 1 headers permissionless | W1.1–W1.2 | **Ops dual daemon only** |
| Phase 1 independent Merkle + dual feeds | W1.3–W1.4 | **Merkle yes; feeds = explorers not full nodes** |
| Phase 1 lag alerts + pause claims | W1.5–W1.7 | **Banner + preflight; no auto protocol pause** |
| Phase 1 value-tier confs | W2.1–W2.3 | **Portal policy yes; engine not enforced** |
| Phase 1 reorg window / claw | W2 | **Buffer before claim only; no claw after mint** |
| Phase 2 CSV / real challenge | W3.1–W3.3 | **CSV=16; free leaf residual remains** |
| Phase 2 JS↔C++ equivalence | W3.4 | **Config hash CI only** |
| Phase 2 client secrets / HW | W4 | **Not started (except backup copy)** |
| Phase 3 bonds / pause / audit / soak | W5 | **Not started** |

---

## 3. Continuation plan (sequenced for mainnet realism)

Order by: **(1) risk removed (2) hard to change later (3) unblocks the rest.**

### Gate rule (unchanged)

**No mainnet value** until:

1. Header lag SLO green under chaos (kill one submitter)  
2. Dual independent proof sources + Merkle verify (done for explorers; full nodes preferred)  
3. Peg-out pays reliably (including multi-UTXO) + solvency always enforced  
4. Documented residual risk signed (free COMPLETE leaf or removed via ceremony)

---

### Sprint 0 — Align repos & unstick testnet (this week)  **P0**

| # | Task | Why first |
|---|------|-----------|
| S0.1 | `git pull` portal `main` to include `c3936e8` hardening | Local is **behind origin** |
| S0.2 | **Consolidate hold UTXOs** or redeemer **multi-input** pay for burns ≥ largest UTXO | Unblocks #12764 (90k) and all large peg-outs |
| S0.3 | Pay or cancel/resolve open burns **#12764**, **#12744** | Clears false “overcollateralization” / stuck UX |
| S0.4 | Redeemer health log/API: last pay, skip reason, queue | Makes Finish failures actionable |
| S0.5 | One-page **state machine** doc (header → claim → burn → COMPLETE → prove) | Phase 0 measure |

**Exit:** Claim + Finish work for dust **and** 90k-class burns on testnet; lag banner green.

---

### Sprint 1 — Headers & claim fail-closed (highest leverage)  **P0–P1**

| # | Task | Plan ID |
|---|------|---------|
| S1.1 | Second **full node** (or electrum/bitcoind) feed for portal proofs; keep dual explorers as fallback | W1.4+ |
| S1.2 | Ops alerts: lag >50 warn, >100 critical (Slack/email); optional **portal claim pause** flag | W1.6, W5.3 light |
| S1.3 | Chaos: stop one header daemon → tip still advances within SLO | W1.2 acceptance |
| S1.4 | Document submitter keys/process; draft multi-submitter bond design (no code freeze) | W1.1, W5.1 prep |
| S1.5 | Engine parity: reject claim if watch/memo/amount mismatch (even if portal lied) | W2.6 |

**Exit:** Header lag cannot silently brick claims; corrupt explorer proof rejected; engine is source of truth.

---

### Sprint 2 — Peg-out vault reliability & residual risk  **P1**

| # | Task | Plan ID |
|---|------|---------|
| S2.1 | Redeemer: coin selection / consolidate; never leave unpaid when sum(mature) ≥ amount | — |
| S2.2 | Never spend **unclaimed deposit UTXOs** preferentially without accounting (fix 65k→out) | Safety |
| S2.3 | Raise product CSV path design (≥144) for **next ceremony** (don’t break testnet UX without notice) | W3.1 |
| S2.4 | Lab: real challenge e2e recorded; product still race-based until leaf change | W3.2 |
| S2.5 | Formal residual risk note: free COMPLETE leaf → challenger + prove only | Gate |

**Exit:** No unpaid burns solely due to fragmentation; deposit/out accounting clean.

---

### Sprint 3 — SPV economic bounds  **P1–P2**

| # | Task | Plan ID |
|---|------|---------|
| S3.1 | Value-tier confs enforced in **engine** not only portal | W2.1–W2.3 |
| S3.2 | Reorg policy: pre-mint buffer (done) + **post-mint freeze window design** (protocol change) | Phase 1 reorg |
| S3.3 | Risk budget: “max loss X% under deep reorg” → confs/bonds table | Phase 0 |
| S3.4 | Metrics: claim success rate, explorer errors, unpaid burns age (export for Prometheus) | W5.2 |

**Exit:** Written security target + confs/bonds sized to it.

---

### Sprint 4 — Economic & mainnet prep  **P2**

| # | Task | Plan ID |
|---|------|---------|
| S4.1 | Bonded header submitters / redeemer roles (design → testnet) | W5.1 |
| S4.2 | Bridge pause (mint/burn freeze) readable by portal | W5.3 |
| S4.3 | Independent watcher process (even external script) | W5.2 |
| S4.4 | External audit scope freeze + engage | W5.4 |
| S4.5 | Multi-day soak with realistic value; kill redeemer/header mid-soak | W5.5–W5.6 |

**Exit:** Audit in flight or complete; soak report with zero silent loss.

---

### Sprint 5 — Client secrets (parallel, lower bridge-block)  **P2–P3**

| # | Task | Plan ID |
|---|------|---------|
| S5.1 | Cold Falcon keygen / no export path | W4.1–W4.2 |
| S5.2 | Preimage never in portal | W4.4–W4.5 |
| S5.3 | CSP / SRI / dep audit on bridge surface | W4.6 |

Does **not** unblock peg-in/out if Sprint 0–2 incomplete.

---

## 4. Recommended “next 7 days” (only this)

1. **Pull origin/main** on portal (get `c3936e8` lag banner + policy).  
2. **Fix redeemer multi-input or consolidate** so #12764 pays.  
3. **Resolve #12744** (stale 45k pending) — pay, prove, or protocol-close.  
4. Write **STATE-MACHINE.md** (1–2 pages, sequence diagrams).  
5. Add **redeemer skip-reason metric** to journal/JSON status file.

Do **not** start BitVM or mainnet marketing language this week.

---

## 5. Mainnet readiness scorecard (four greens)

| # | Criterion | Today |
|---|-----------|--------|
| 1 | Headers resilient (multi-submit + lag SLO) | **Yellow** — dual ops daemons, lag 0, not permissionless/bonded |
| 2 | Claim path dual-source + Merkle + engine validation | **Yellow** — portal Merkle + dual explorers; engine parity incomplete |
| 3 | Peg-out always pays when solvent; no deposit cannibalization | **Red** — 90k stuck on fragmentation; prior unclaimed UTXO spent for out |
| 4 | Residual risk accepted or removed (covenant/challenge) | **Red** — free COMPLETE residual; race/prove model |

---

## 6. Ownership (suggested)

| Area | Owner |
|------|--------|
| Portal policy, lag UI, Merkle, trackers | Portal / faucet-wallet |
| Header daemons, redeemer, UTXO ops | Fleet SSH / ops |
| Multi-submitter, pause bit, engine validation, reorg claw | Protocol / qXRP rebuild |
| Bonds, audit, soak | Product + ops |

---

## 7. Changelog

| Date | Note |
|------|------|
| 2026-08-03 | Continuation plan written after fleet check (lag 0, #12764 stuck, portal hardening on origin/main) |

*Next implementation PR should reference Sprint 0 IDs (S0.1–S0.5).*
