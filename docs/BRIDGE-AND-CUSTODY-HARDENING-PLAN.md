# Falcon Bridge & Custody Hardening Plan

**Status:** Draft plan for implementation  
**Date:** 2026-08-02  
**Scope:** Bitcoin SPV bridge (headers, peg-in/out, shared reserve), portal safety, vault/cold key hygiene  
**Repos:** `Falcon-faucet-wallet` (+ protocol/fleet work in `qXRP` where noted)  
**Related:** [MULTI-CHAIN-IMPLEMENTATION.md](./MULTI-CHAIN-IMPLEMENTATION.md), [HARDENING.md](./HARDENING.md), [ROADMAP.md](./ROADMAP.md), [VAULT-COLD-SIGNER-IMPLEMENTATION-REPORT.md](./VAULT-COLD-SIGNER-IMPLEMENTATION-REPORT.md)

---

## 1. Why this plan exists

Testnet SPV and shared-reserve redeem are **live but operationally fragile**:

| Pain | Example |
|------|---------|
| Header lag | Falcon BTC tip thousands of blocks behind Bitcoin → Claim FBTC hits `tecNO_ENTRY` |
| Single-party trust | One header submitter / one redeemer can stall the bridge |
| Peg-out opacity | Burn succeeds; “reserve payout not found” until fleet pays FBTO |
| Confirmation policy | Fixed min confs ignores value and reorg risk |
| Challenge realism | CSV / challenge path incomplete vs product story |
| Key birth | Vault keys still born on hot portal then exported |
| Ops posture | Limited bonds, pause, soak under realistic value |

This document is the **implementation plan** for the next hardening wave. Items are ordered for dependency and risk reduction, not marketing order.

---

## 2. Goals

1. **Headers:** No single operator can quietly stop peg-in; lag is visible and actionable.  
2. **Deposits:** Confirmations and validation scale with value and reorg risk.  
3. **Peg-out / reserve:** Real challenge path, longer CSV where needed, scripts that match on-chain watch.  
4. **Keys:** Prefer hardware / WebAuthn paths; preimages and portal surfaces hardened.  
5. **Economic security:** Bonds, independent watchers, pause controls, audit, soak with real(ish) value.

**Non-goals (this plan):** Full BitVM output binding (tracked as later spike); making ETH/USDC/BNB fully trustless in the same PR set (separate corridor plan).

---

## 3. Workstreams (overview)

| # | Workstream | Primary outcome |
|---|------------|-----------------|
| **W1** | Permissionless / multi-party headers + independent Merkle checks + lag alerts | Header pipeline resilient; claims fail closed with clear UX |
| **W2** | Value-tiered confirmations + reorg window + extra deposit validation | Safer peg-in under reorgs and large amounts |
| **W3** | CSV lengthening + real challenge path + script equivalence | Peg-out challenge is real, not decorative |
| **W4** | Hardware / WebAuthn key path + preimage hygiene + portal hardening | Stronger key birth and less secret leakage |
| **W5** | Bonds, watchers, pause, external audit, testnet soak | Economic + process security before mainnet |

Each workstream has **protocol/fleet**, **portal**, and **ops** slices.

---

## 4. W1 — Permissionless / multi-party headers + independent Merkle checks + lag alerts

### 4.1 Problem

- Header ingest is effectively **ops-gated**.  
- Falcon tip can lag Bitcoin by **thousands of blocks** (observed on testnet).  
- Portal may fetch Merkle proofs from explorers without a second independent check.  
- Users see engine codes (`tecNO_ENTRY`) instead of “headers lag by N blocks.”

### 4.2 Target architecture

```
Bitcoin network
    │
    ├─► Header submitter A (bonded) ──┐
    ├─► Header submitter B (bonded) ──┼─► Falcon BTCHeaderSubmit / tip
    └─► Watcher C (read-only lag feed)┘

Portal claim path:
    explorer proof ──┐
    second source    ├─► independent Merkle verify ──► BTCDepositClaim
    Falcon tip check ┘
```

### 4.3 Deliverables

| ID | Task | Owner | Repo |
|----|------|-------|------|
| W1.1 | Spec multi-submitter model: any bonded account may submit headers; tip selection by work/height rules | Protocol | qXRP |
| W1.2 | Permissionless or multi-party header submit path (replace single fleet-only daemon) | Fleet | qXRP + ops |
| W1.3 | Client-side **independent Merkle proof verify** before `BTCDepositClaim` (not trust explorer alone) | Portal | faucet-wallet |
| W1.4 | Second proof source (alternate explorer / node) when primary lags | Portal | faucet-wallet |
| W1.5 | **Lag alerts:** portal banner + API (`falconTip`, `btcTip`, `gap`, `claimSafe`) | Portal | faucet-wallet |
| W1.6 | Ops alert when gap &gt; threshold (e.g. 50 / 100 / 500 blocks) | Ops | monitoring |
| W1.7 | Claim preflight hard-block when deposit height &gt; Falcon tip (already partially shipped — extend to UI banner) | Portal | faucet-wallet |

### 4.4 Acceptance criteria

- [ ] Two independent submitters can advance tip if one dies.  
- [ ] Gap &gt; 100 blocks → red banner on Bridge BTC (In/Out).  
- [ ] Claim path verifies Merkle locally; corrupt explorer response rejected.  
- [ ] User never sees bare `tecNO_ENTRY` without “header lag / wrong watch” copy.

### 4.5 Dependencies

Bridge state / amendment support for multi-submitter rules (protocol).

---

## 5. W2 — Value-tiered confirmations + reorg window + extra deposit validation

### 5.1 Problem

- Single global min confs (e.g. 6) for all amounts.  
- Large deposits and dust treated the same.  
- Limited validation that deposit pays **current** watch script + FALC OP_RETURN.

### 5.2 Target policy (testnet draft — tune with audit)

| Deposit value (testnet BTC) | Min BTC confs | Extra checks |
|-----------------------------|---------------|--------------|
| &lt; 0.001 | 3 | Watch + FALC memo |
| 0.001 – 0.01 | 6 | + reorg depth vs Falcon tip |
| &gt; 0.01 | 12+ | + optional delay window; ops notify |

**Reorg window:** do not allow claim until  
`btc_tip - deposit_height + 1 ≥ tier_confs` **and**  
`falcon_btc_tip ≥ deposit_height` **and**  
`falcon_btc_tip - deposit_height ≥ reorg_buffer` (e.g. 1–3 for small, higher for large).

### 5.3 Deliverables

| ID | Task | Owner | Repo |
|----|------|-------|------|
| W2.1 | Config table for value tiers (`public/config/btc-spv-bridge.json` or protocol) | Portal + protocol | both |
| W2.2 | Portal enforces tier confs before enabling Claim FBTC | Portal | faucet-wallet |
| W2.3 | Reorg buffer check in claim preflight API | Portal | faucet-wallet |
| W2.4 | Extra deposit validation: vout → live watch SPK/address; FALC‖AccountID20; dust floor | Portal | faucet-wallet |
| W2.5 | Reject retired holds (mxuam…, previous tb1q… from protocol-reserve.json) with explicit error | Portal | faucet-wallet |
| W2.6 | Engine-side validation parity (claim fails closed if memo/watch mismatch) | Protocol | qXRP |

### 5.4 Acceptance criteria

- [ ] Dust and large peg-ins use different conf thresholds.  
- [ ] Wrong watch address never reaches passkey claim.  
- [ ] Documented reorg policy in bridge UI help (one short sentence).

---

## 6. W3 — CSV lengthening + real challenge path + script equivalence

### 6.1 Problem

- Shared-reserve COMPLETE / challenge CSV may be short or incomplete vs whitepaper story.  
- “Challenge path” partially product-policy only.  
- Watch script hash / hold program / portal config can **drift** (v2 → v3 cutovers).  
- Peg-out: burn on Falcon, redeemer lag, Finish waits on FBTO.

### 6.2 Target

1. **CSV lengthening** to a policy agreed for testnet soak (e.g. 16 → higher for large instances).  
2. **Real challenge path:** published preimages, timed challenge, fraud path that is exercisable in e2e (not only documented).  
3. **Script equivalence:** single source of truth for hold program, watch hash, SPK, address; portal and fleet must match on-chain `BtcBridgeState`.

### 6.3 Deliverables

| ID | Task | Owner | Repo |
|----|------|-------|------|
| W3.1 | Raise / parameterize challenge CSV; document impact on peg-out latency | Protocol + product | qXRP + docs |
| W3.2 | E2E “challenge succeeds” and “challenge fails / timeout COMPLETE” scripts | Fleet | qXRP |
| W3.3 | Instance commit / fund-instance-only policy enforced in redeemer | Fleet | ops/qXRP |
| W3.4 | Script equivalence CI: `protocol-reserve.json` + `btc-spv-bridge.json` ↔ on-chain watch hash | Portal CI | faucet-wallet |
| W3.5 | Redeemer health API: last pay time, queue depth, last burn seq paid | Fleet + portal | both |
| W3.6 | Portal peg-out card: burn seq, amount, challenge end, redeemer status (not only “wait 30s”) | Portal | faucet-wallet |

### 6.4 Acceptance criteria

- [ ] Config hash mismatch fails CI and shows Bridge banner.  
- [ ] Challenge path demoed on testnet with recorded txs.  
- [ ] Open burn without FBTO shows burn-safe + redeemer lag, not user error.

---

## 7. W4 — Hardware / WebAuthn key path + preimage hygiene + portal hardening

### 7.1 Problem

- Vault keys still **generated on hot portal** then moved via encrypted JSON (see vault report).  
- Coldcard-class lesson: **entropy and key birth** dominate; encoding (hex vs mnemonic) does not.  
- COMPLETE / burn preimages and secrets must not leak into logs, analytics, or loose localStorage.  
- Portal attack surface: XSS, bad deps, over-verbose errors, CSP.

### 7.2 Target key model

| Tier | Generation | Secret location | Use |
|------|------------|-----------------|-----|
| Hot wallet | Browser CSPRNG + passkey wrap | Device | Daily / small |
| Vault (improved) | **Cold signer or WebAuthn/hardware-assisted** | Cold only | High value |
| Ideal | Offline cold gen → address only to hot | Cold | Same as above |

### 7.3 Deliverables

| ID | Task | Owner | Repo |
|----|------|-------|------|
| W4.1 | Cold-side Falcon-512 keygen in cold-signer PWA; portal only stores public record | Portal | faucet-wallet |
| W4.2 | Optional WebAuthn / platform authenticator binding for cold unlock (no secret export in clear) | Portal | faucet-wallet |
| W4.3 | Hardware path spike (e.g. export-restricted or external signer interface) — design only if no SE | Research | docs |
| W4.4 | Preimage hygiene: never log preimages; wipe memory where possible; no preimage in Sentry | Portal + fleet | both |
| W4.5 | COMPLETE preimage storage: fleet-only secrets; portal never fetches full preimage | Fleet | ops |
| W4.6 | Portal hardening: CSP review, dependency audit, strip secrets from client bundles | Portal | faucet-wallet |
| W4.7 | Backup UX: vault JSON treated as seed (warnings, no auto cloud) | Portal | faucet-wallet |

### 7.4 Acceptance criteria

- [ ] New vaults can be created with **zero** secret ever on hot after first cold gen path ships.  
- [ ] Grep CI fails if known preimage env keys appear in client bundles.  
- [ ] Security notes updated in HARDENING.md.

---

## 8. W5 — Bonds, watchers, pause, external audit, testnet soak

### 8.1 Problem

- Header submitters and redeemers can stall without economic penalty.  
- No clear global **pause** for bridge under incident.  
- Limited soak with realistic value; audit not yet external.

### 8.2 Deliverables

| ID | Task | Owner | Repo |
|----|------|-------|------|
| W5.1 | Bond requirements for header submitters and redeemers (slash / jail policy) | Protocol | qXRP |
| W5.2 | Independent **watchers**: tip lag, unredeemed burns &gt; T, mint cap, hold balance | Ops + portal | both |
| W5.3 | Bridge **pause** switch (protocol flag or fleet freeze) with portal read-only mode | Protocol + portal | both |
| W5.4 | External security review scope: SPV claim/prove, reserve COMPLETE, portal bridge UI, vault | Product | process |
| W5.5 | Testnet soak: multi-day peg-in/out, concurrent users, redeemer restart, header gap recovery | Ops + QA | process |
| W5.6 | Soak with **realistic value** bands (not only dust); runbook for stuck burns | Ops | process |
| W5.7 | Public status page or Explorer BTC Bridge suite: tip lag, redeemer queue, last COMPLETE | Portal | faucet-wallet |

### 8.3 Acceptance criteria

- [ ] Kill one submitter → tip still advances (or pause + alert within SLO).  
- [ ] Pause stops new claims/burns in portal within one deploy.  
- [ ] External audit report filed; P0/P1 tracked to close.  
- [ ] Soak report: zero silent fund loss; stuck burns documented with recovery.

---

## 9. Suggested phases

### Phase A — Visibility & fail-closed (1–2 weeks)

- W1.5–W1.7 lag alerts + claim preflight polish  
- W2.4–W2.5 deposit validation  
- W3.6 peg-out card honesty  
- W5.2 watcher metrics (even if manual alerts)

**Exit:** Users always know *why* claim/finish is blocked.

### Phase B — Pipeline resilience (2–4 weeks)

- W1.1–W1.4 multi-party headers + Merkle verify  
- W2.1–W2.3 value-tiered confs + reorg buffer  
- W3.4 script equivalence CI  
- W3.5 redeemer health  

**Exit:** Header lag &lt; 100 blocks under normal ops; claims reliable for current watch.

### Phase C — Challenge & keys (3–6 weeks)

- W3.1–W3.3 CSV + real challenge e2e  
- W4.1–W4.7 cold keygen + preimage + portal hardening  

**Exit:** Cold vault gen path live; challenge demo green.

### Phase D — Economic security & audit (ongoing)

- W5.1 bonds  
- W5.3 pause  
- W5.4–W5.6 audit + soak  
- W5.7 public suite  

**Exit:** Ready for larger testnet TVL / mainnet design freeze.

---

## 10. Risk register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Header lag returns | Peg-in dead | Multi-submitter + alerts + pause |
| Redeemer insolvency | Peg-out stuck (burns orphaned) | Solvency checks, bonds, hold migration runbooks |
| Config/script drift | Silent claim failures | Equivalence CI + on-chain hash display |
| Weak keygen | Coldcard-class loss | Cold birth + entropy audit |
| Premature “permissionless” marketing | Trust damage | Ship W1–W3 before language change |

---

## 11. Metrics (dashboard)

| Metric | Warning | Critical |
|--------|---------|----------|
| `btc_tip - falcon_btc_tip` | &gt; 50 | &gt; 100 |
| Unpaid burns (challenge past, no FBTO) &gt; 15m | &gt; 0 | &gt; 3 |
| Claim success rate (7d) | &lt; 95% | &lt; 80% |
| Redeemer pay latency p95 | &gt; 5m | &gt; 30m |
| Hold balance vs open liability | margin &lt; 20% | margin &lt; 0 |

---

## 12. Doc & product language

Until Phase B exit:

- Prefer **“SPV light client + fleet redeemer (testnet)”** over “fully permissionless bridge.”  
- BTC: non-custodial **claim** path when headers live; peg-out still depends on reserve COMPLETE.  
- ETH/USDC/BNB remain lock–mint + relay (separate plan).

Update whitepaper / marketing only after W1 lag SLO and W3 challenge e2e pass.

---

## 13. Open questions

1. Bond sizes for header submitters vs redeemers (FALCON)?  
2. Final testnet CSV and value-tier table for soak?  
3. Hardware wallet scope for Falcon-512 (possible at all without custom SE)?  
4. Who runs second header submitter (community vs Falcon ops)?  

---

## 14. Tracking

| Workstream | Tracking issue (fill when filed) | Phase |
|------------|----------------------------------|-------|
| W1 Headers + Merkle + lag | TBD | A–B |
| W2 Confs + reorg + validation | TBD | A–B |
| W3 CSV + challenge + scripts | TBD | B–C |
| W4 Keys + preimage + portal | TBD | C |
| W5 Bonds + audit + soak | TBD | D |

**Changelog**

| Date | Note |
|------|------|
| 2026-08-02 | Initial plan document created and pushed |

---

*End of plan. Implementation PRs should reference workstream IDs (e.g. `W1.5`, `W3.4`).*
