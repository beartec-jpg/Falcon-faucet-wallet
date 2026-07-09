# Falcon Ledger Testnet — End-to-End Test Report

> **Historical snapshot (pre-genesis, July 2026).** This report documents the first integrated E2E run at ledger ~83k with issuer `rfftKWu…` and AMM pool `rwwcutHZ…`. After a genesis wipe the live network uses issuer **`rsJoDhjVV78jr6huHxKjtT8uG8RGeGmd1N`**, epoch length **172,800 ledgers**, Falcon validator consensus, and lending amendments enabled. For current parameters see `public/config/testnet-stables.json`, the [whitepaper](/whitepaper), and [README](../README.md). On-ledger seq/hash references below are from the pre-genesis chain unless noted otherwise.

**Report date:** 2026-07-05
**Application:** Falcon-faucet-wallet (`qXRP-faucet-wallet` / `Falcon-faucet-wallet`)  
**See also:** [README](../README.md) · [ROADMAP](./ROADMAP.md) · [Whitepaper](/whitepaper)
**Network:** Falcon Ledger Testnet (Network ID **1001**)  
**RPC:** `http://46.224.0.140:6005`  
**Validated ledger at report time:** ~83,188

This document records manual end-to-end testing across wallet creation, P2P transfers, Sepolia bridge flows, liquidity pool operations, DEX limit orders, instant AMM swaps, and outbound transfers. All Falcon-ledger results below were verified on-ledger via `account_tx`, `account_info`, `account_lines`, and `amm_info`.

---

## Executive summary

| Area | Status | Notes |
|------|--------|-------|
| Passkey wallet create / unlock | **PASS** | Falcon keys generated client-side; seed encrypted with WebAuthn passkey |
| Faucet drip | **PASS** | 2,000 FALCON per request (configurable) |
| P2P FALCON send/receive | **PASS** | Including QR scan for recipient address |
| P2P F-USDC send/receive | **PASS** | Requires recipient trust line to issuer |
| Sepolia wallet (passkey EVM) | **PASS** | Created inside Bridge panel; keys device-encrypted |
| Sepolia ETH / USDC receive | **PASS** | Standard EVM deposits to derived `0x` address |
| Bridge In (Sepolia USDC → F-USDC) | **PASS** | Lock contract + relay mint verified (e.g. 90 F-USDC) |
| Bridge Out (F-USDC → Sepolia USDC) | **PASS** | Payment to issuer + `sepolia-withdraw` memo; relay releases USDC |
| Send Out (Sepolia USDC to external `0x`) | **PASS** | From in-app Sepolia wallet |
| AMM pool create / deposit / withdraw | **PASS** | FALCON + F-USDC pair; partial LP withdraw tested |
| DEX limit orders | **PASS** | Passive (`Post only`), crossing (default), partial fills, dust cancel |
| Instant swap (AMM path) | **PASS** | Buy and sell F-USDC via Payment/AMM |
| Tx history asset labels | **PASS** (fixed `5b5011f`) | F-USDC payments no longer show as `— FALCON` |

**Overall:** The integrated Falcon + Sepolia testnet stack is functioning end-to-end. Remaining caveats are documented in [Known issues](#known-issues).

---

## Test environment

### Falcon ledger

| Parameter | Value |
|-----------|-------|
| Network name | Falcon Ledger Testnet |
| Network ID | 1001 |
| Public RPC | `http://46.224.0.140:6005` |
| Native asset | FALCON (display); on-ledger XRP drops |
| F-USDC currency code | `QUC` |
| F-USDC issuer | `rfftKWuA7Dk7PF1YrH8NA7262oY3tejhqt` |
| Faucet account | `rwzhiWW4GYK2sQVR5Lw4iDpYLANB5krJXY` |
| AMM pool account | `rwwcutHZ17aRYZbgWGhZx7eGsRUyqRj1g5` |
| Signing | Client Falcon keys + optional signer proxy for server routes |

### Sepolia (EVM bridge)

| Parameter | Value |
|-----------|-------|
| Chain ID | 11155111 |
| RPC | `https://ethereum-sepolia-rpc.publicnode.com` |
| Explorer | `https://sepolia.etherscan.io` |
| Sepolia USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Lock contract | `0x2dae31Cbf2E3a418d617081985661fCD0117b75C` |
| USDC decimals | 6 |
| Withdraw memo type | `sepolia-withdraw` |
| Relay script | `scripts/bridge-withdraw-relay.py` |

### Labeling conventions (UI)

| Context | Label |
|---------|-------|
| Swap, DEX, Pool, Wallet P2P | **F-USDC** (Falcon-ledger IOU) |
| Bridge panel only | **Sepolia USDC** (EVM ERC-20) |
| Native | **FALCON** |

---

## Test wallets

### Primary (Wallet A)

| Field | Value |
|-------|-------|
| Falcon address | `rpUWZzFqJeZ5hmphWL6QuUbN8rux8SrdbU` |
| Balance at report | **8,000.87 FALCON**, **93.52 F-USDC** |
| Sequence | 22516 |
| Role | Main test wallet; pool LP (~57% share after tests); DEX/AMM/bridge actor |
| Creation | Passkey-secured Falcon wallet via Wallet tab |

### Secondary (Wallet B)

| Field | Value |
|-------|-------|
| Falcon address | `rLShrj7rvo2ZtjM9BkXNdh9GfnNT7YuC8i` |
| Balance at report | **1,010.99 FALCON**, **68 F-USDC** |
| Sequence | 23772 |
| Role | Counterparty for cross-wallet DEX limit orders and P2P sends |

### Sepolia (EVM)

| Field | Value |
|-------|-------|
| Address | `0x0521dda874c45a8a6a93311bc0a206678134f937` |
| Role | Bridge In source, Bridge Out destination, Send Out source |
| Creation | Passkey-encrypted EVM wallet inside Swap → Bridge panel |
| Funding | Test Sepolia ETH (gas) + Sepolia USDC from faucet/external |

### F-USDC issuer / bridge operator

| Field | Value |
|-------|-------|
| Address | `rfftKWuA7Dk7PF1YrH8NA7262oY3tejhqt` |
| Role | Mints F-USDC on bridge-in; receives F-USDC on bridge-out |

---

## 1. Wallet creation and unlock

### 1.1 Create Falcon wallet (passkey)

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| 1 | Open Wallet tab on HTTPS origin | Passkey API available | **PASS** |
| 2 | Choose create new wallet | Platform passkey prompt | **PASS** |
| 3 | Complete WebAuthn registration | Falcon keypair generated on-device; `falcon_secret` shown once | **PASS** |
| 4 | Save encrypted wallet to IndexedDB | Wallet listed; address derived | **PASS** |
| 5 | Reload page; unlock with passkey | Seed decrypted; dashboard loads | **PASS** |

**Security notes (testnet only):**

- Seed encrypted with passkey-derived key material (PRF when available).
- `falcon_secret` must be backed up manually; passkey alone re-opens stored wallet on same device/origin.
- Testnet passkey fallback (rawId) documented in `src/lib/passkey.ts` — not for mainnet funds.

### 1.2 Faucet bootstrap

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| 1 | Request faucet for new address | +2,000 FALCON (default drip) | **PASS** |
| 2 | Verify `account_info` | `tesSUCCESS`; balance increases | **PASS** |

Early faucet payments to Wallet A (examples):

| Ledger | Amount | Hash (prefix) |
|--------|--------|---------------|
| 22490 | 2,000 FALCON | `6A4DC733…` |
| 22912 | 2,000 FALCON | `9AD4D1B6…` |
| 72495 | 2,000 FALCON | `5D84D9C8…` |

### 1.3 Trust line for F-USDC

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| 1 | `TrustSet` to issuer `rfftKWu…` currency `QUC` | Trust line created | **PASS** (seq #22490, ledger 22501) |

---

## 2. Peer-to-peer transfers (Falcon ledger)

### 2.1 FALCON P2P

| Test | From | To | Amount | Seq | Ledger | Hash | Result |
|------|------|-----|--------|-----|--------|------|--------|
| B → A receive | `rLShr…` | `rpUWZ…` | 1,000 FALCON | 23770 | 83053 | `CF70300E…` | **PASS** |

**UI:** Wallet Send supports manual address entry and QR scan (`jsqr`). `Permissions-Policy: camera=(self)` set in `next.config.mjs`.

### 2.2 F-USDC P2P

| Test | From | To | Amount | Seq | Ledger | Hash | Result |
|------|------|-----|--------|-----|--------|------|--------|
| B → A receive | `rLShr…` | `rpUWZ…` | 50 F-USDC | 23771 | 83058 | `C6CDBD63…` | **PASS** |

**Precondition:** Recipient must have F-USDC trust line (Wallet A satisfied).

**Bug fixed (2026-07-05):** Recent Transactions showed `— FALCON` for F-USDC payments because `fmtDrops()` was applied to IOU `Amount` objects. Fix in commit `5b5011f` — `parseTxAmount()` in `src/lib/tx-display.ts` distinguishes drops vs `QUC` IOU.

**Expected UI after fix:**

- `+1,000 FALCON` (incoming Payment)
- `+50 F-USDC` (incoming Payment)

---

## 3. Sepolia wallet and inbound EVM funds

### 3.1 Create Sepolia wallet

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| 1 | Swap → Bridge → create Sepolia wallet with passkey | `0x0521…f937` derived | **PASS** |
| 2 | Keys encrypted and stored on device | No MetaMask required | **PASS** |

### 3.2 Receive Sepolia ETH and USDC

| Asset | Method | Result |
|-------|--------|--------|
| Sepolia ETH | External faucet / transfer to `0x0521…f937` | **PASS** (gas for approve/deposit/send) |
| Sepolia USDC | ERC-20 transfer to same address | **PASS** (used for bridge-in tests) |

Balances displayed in Bridge panel via `fetchSepoliaBalances()`; UI uses floor formatting to avoid rounding display errors (e.g. 259.99985 shown correctly).

---

## 4. Bridge In (Sepolia USDC → F-USDC)

### 4.1 Flow

1. Approve USDC spend on lock contract `0x2dae31C…`.
2. Call `deposit(amount, falconAccount)` on lock contract.
3. Relay observes `DepositCreated` event and sends F-USDC Payment from issuer to Falcon address.

### 4.2 Verified bridge-in (90 F-USDC)

| Leg | Account | Type | Amount | Seq | Ledger | Hash | Result |
|-----|---------|------|--------|-----|--------|------|--------|
| Bridge request | `rpUWZ…` | Payment → issuer | 90 F-USDC (bridge-out path N/A — this is user-initiated bridge **in** via EVM) | — | — | — | — |
| User bridge-out memo payment (see §5) | — | — | — | — | — | — | — |
| **Bridge in (mint)** | `rfftKWu…` (issuer) | Payment → `rpUWZ…` | 90 F-USDC | 5638 | 82676 | `2703FB8B…` | **PASS** |
| Prior bridge-in credits | issuer | Payment → `rpUWZ…` | 5, 75, 100, 259 F-USDC | 5632–5637 | various | see RPC | **PASS** |

**Round-trip context:** ~90 Sepolia USDC locked on Sepolia; relay minted 90 F-USDC on Falcon (seq #5638). Earlier smaller mints (5, 75, 100, 259) also verified.

---

## 5. Bridge Out (F-USDC → Sepolia USDC)

### 5.1 Flow

1. User signs F-USDC Payment to issuer `rfftKWu…` with `sepolia-withdraw` memo containing Sepolia `0x` destination.
2. `bridge-withdraw-relay.py` watches issuer account and calls lock contract `withdraw()` to release Sepolia USDC.

### 5.2 Verified bridge-out transactions

| Amount | Seq | Ledger | Hash | Sepolia dest | Result |
|--------|-----|--------|------|--------------|--------|
| 79.99985 F-USDC | 22494 | 72618 | `D64054CD…` | `0x0521…f937` | **PASS** |
| 170 F-USDC | 22501 | 79186 | `FEA9FD98…` | `0x0521…f937` | **PASS** |
| 10 F-USDC | 22503 | 79437 | `DCBD9B40…` | `0x0521…f937` | **PASS** |
| **35 F-USDC** | **22515** | **82770** | **`E470BE2F…`** | **`0x0521…f937`** | **PASS** |
| 90 F-USDC (bridge-in trigger) | 22512 | 82567 | `E51BCF4A…` | issuer payment | **PASS** |

**Note:** Bridge-out relay may take seconds to minutes depending on relay process polling; on-ledger Falcon payment succeeds immediately with `tesSUCCESS`.

---

## 6. Send Out (Sepolia USDC to external address)

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| 1 | Bridge panel → Send Out | ERC-20 `transfer` on Sepolia USDC | **PASS** |
| 2 | Send to external `0x` (not bridge wallet) | Recipient receives Sepolia USDC | **PASS** |

Tested as final step after pool withdraw and bridge-out: move remaining Sepolia USDC from in-app wallet to external Sepolia address.

---

## 7. Liquidity pool (AMM)

### 7.1 Pool state after testing

| Metric | Value |
|--------|-------|
| AMM account | `rwwcutHZ17aRYZbgWGhZx7eGsRUyqRj1g5` |
| FALCON reserves | ~966.02 FALCON |
| F-USDC reserves | ~182.48 F-USDC |
| LP token supply | ~419,734 LP |
| Wallet A LP share | ~57% (after 50% withdraw) |
| Trading fee | 0.5% (500 bps) |

### 7.2 Pool operations

| Operation | Details | Seq | Ledger | Hash | Result |
|-----------|---------|-----|--------|------|--------|
| Early deposits | 10 + 3,000 FALCON (bootstrap) | 22491–22492 | 25007, 26062 | `ACDD508A…`, `6C955236…` | **PASS** |
| AMM create | 1,000 FALCON | 22499 | 78562 | `049A540B…` | **PASS** |
| **Deposit** | **90 F-USDC + ~476.44 FALCON** | **22513** | **82694** | **`CB59367D…`** | **PASS** |
| **50% LP withdraw** | Burned ~166,752 LP tokens | **22514** | **82753** | **`06AE8C47…`** | **PASS** |
| Secondary deposit | 800 FALCON + F-USDC (Wallet B) | 23766 | 78701 | `221307BA…` | **PASS** |

**UI:** Pool page labels consistently use **F-USDC** (commit `09b4534`).

---

## 8. DEX limit orders

### 8.1 Price field semantics

- Order form price is **FALCON per F-USDC** (not F-USDC per FALCON).
- Example: “10 F-USDC per 1 FALCON” → enter **0.1** in the price field.
- UI shows inverse helper text (commit `ccd8e62`).

### 8.2 Order modes

| Mode | Flag | Behavior | Result |
|------|------|----------|--------|
| Default (crossing) | — | Order matches immediately against resting book | **PASS** |
| Post only | `TF_PASSIVE` | Order rests on book; rejected if would cross | **PASS** |

Default changed to cross book in commit `c772b21`; passive is opt-in via “Post only”.

### 8.3 Limit order test matrix

| Test | Wallet | Side | Taker gets | Taker pays | Seq | Result |
|------|--------|------|------------|------------|-----|--------|
| Passive ask ladder | A | Sell F-USDC | 10–12 FALCON | 10 F-USDC each | 22495–22497 | **PASS** (rested) |
| Cancel passive ask | A | Cancel | — | — | 22498 | **PASS** |
| Passive bid (seller) | A | Sell F-USDC | 10 F-USDC | 98.34 FALCON | 22505 | **PASS** (rested) |
| Crossing bid (buyer) | B | Buy F-USDC | 101 FALCON | 10 F-USDC | 23767 | **PASS** (filled #22505) |
| Partial fill sell | A | Sell F-USDC | 88.4 F-USDC | 892.84 FALCON | 22508 | **PASS** |
| Large bid | B | Buy F-USDC | 1010 FALCON | 100 F-USDC | 23769 | **PASS** |
| Ask/bid 8 F-USDC | A/B | Both | 8 F-USDC @ 80.8 FALCON | — | 22507 / 23768 | **PASS** |
| Dust cancel | A | Cancel remainder | ~0.0002 F-USDC dust | — | 22509 | **PASS** |

**Book hygiene:** Dust offers below display threshold filtered from public order book (commit `c51b185`). Open orders panel shows true remaining amounts (commit `9d670c8`).

---

## 9. Instant swap (AMM / Payment path)

Quick swap tab executes Payment transactions routed through the FALCON/F-USDC AMM.

| Direction | Input (approx) | Output (approx) | Seq | Ledger | Hash | Result |
|-----------|----------------|-----------------|-----|--------|------|--------|
| **Buy F-USDC** | ~995.5 FALCON | ~54 F-USDC | 22510 | 82511 | `89848F53…` | **PASS** |
| **Sell F-USDC** | ~99.55 F-USDC | ~1,328 FALCON | 22511 | 82544 | `AD5004F1…` | **PASS** |

**Slippage:** Thin pool caused ~5.4% effective price on buy; expected on testnet with low liquidity.

**UI labels:** Swap page uses **F-USDC** for Falcon IOU; **Sepolia USDC** only in Bridge (commit `ccd8e62`).

---

## 10. UI / UX fixes shipped during test cycle

| Commit | Change |
|--------|--------|
| `ccd8e62` | F-USDC labels on swap/DEX; limit price inverse helper |
| `9d670c8` | Limit orders UI persistence; open-order badge |
| `c772b21` | Default limit orders cross book; Post only opt-in |
| `c51b185` | Dust offers hidden from public book |
| `952c27f` | Wallet F-USDC P2P send |
| `09b4534` | Pool page F-USDC labels |
| `0640297` | QR scanner on wallet send (`jsqr`) |
| `e74c652` | `pnpm-lock.yaml` synced for `jsqr` |
| `5b5011f` | **Tx history F-USDC amount display fix** |

---

## Known issues and limitations

| Issue | Severity | Workaround |
|-------|----------|------------|
| AMM slippage on thin pool | Low (testnet) | Smaller trade sizes; add liquidity |
| Bridge-out relay latency | Low | Wait for relay poll; verify Sepolia balance |
| Partial-fill dust orders | Low | Cancel dust manually; filtered from public book |
| F-USDC requires trust line | Info | `TrustSet` before receive |
| Passkey rawId fallback | Medium (mainnet) | Testnet only per `passkey.ts` audit note |
| `pnpm` vs `npm` lockfile | CI | Always use `pnpm add` in this repo |
| Signer proxy dependency | Ops | Server routes need `SIGNER_PROXY_URL` on node1 |

---

## Appendix A — Primary wallet transaction index

Full history: 39 transactions on `rpUWZzFqJeZ5hmphWL6QuUbN8rux8SrdbU`. Key sequences:

| Seq | Type | Summary | Ledger | Result |
|-----|------|---------|--------|--------|
| 22490 | TrustSet | F-USDC trust line | 22501 | tesSUCCESS |
| 22495–22497 | OfferCreate | Passive ask ladder | 77160–77171 | tesSUCCESS |
| 22498 | OfferCancel | Cancel asks | 77272 | tesSUCCESS |
| 22499 | AMMCreate | Create pool | 78562 | tesSUCCESS |
| 22505 | OfferCreate | Passive sell 10 F-USDC | 79912 | tesSUCCESS |
| 22507 | OfferCreate | Sell 8 F-USDC | 82345 | tesSUCCESS |
| 22508 | OfferCreate | Partial-fill sell | 82394 | tesSUCCESS |
| 22509 | OfferCancel | Dust cancel | 82494 | tesSUCCESS |
| 22510 | Payment | AMM buy F-USDC | 82511 | tesSUCCESS |
| 22511 | Payment | AMM sell F-USDC | 82544 | tesSUCCESS |
| 22512 | Payment | Bridge (90 F-USDC to issuer) | 82567 | tesSUCCESS |
| 22513 | AMMDeposit | 90 F-USDC + 476.44 FALCON | 82694 | tesSUCCESS |
| 22514 | AMMWithdraw | ~50% LP | 82753 | tesSUCCESS |
| 22515 | Payment | Bridge out 35 F-USDC | 82770 | tesSUCCESS |
| — | Payment | Mint 90 F-USDC (issuer #5638) | 82676 | tesSUCCESS |
| — | Payment | +1000 FALCON from B (#23770) | 83053 | tesSUCCESS |
| — | Payment | +50 F-USDC from B (#23771) | 83058 | tesSUCCESS |

---

## Appendix B — Secondary wallet transaction index

12 transactions on `rLShrj7rvo2ZtjM9BkXNdh9GfnNT7YuC8i`:

| Seq | Type | Summary | Result |
|-----|------|---------|--------|
| 23765 | TrustSet | F-USDC trust line | tesSUCCESS |
| 23766 | AMMDeposit | 800 FALCON + F-USDC | tesSUCCESS |
| 23767 | OfferCreate | Crossing buy (filled A #22505) | tesSUCCESS |
| 23768 | OfferCreate | Bid 8 F-USDC | tesSUCCESS |
| 23769 | OfferCreate | Large bid 100 F-USDC | tesSUCCESS |
| 23770 | Payment | Send 1000 FALCON → A | tesSUCCESS |
| 23771 | Payment | Send 50 F-USDC → A | tesSUCCESS |

---

## Appendix C — Suggested regression checklist

Use this ordered checklist for future testnet releases:

- [ ] Create / unlock Falcon wallet with passkey
- [ ] Faucet drip and balance refresh
- [ ] Trust line + receive F-USDC
- [ ] P2P send FALCON and F-USDC (QR + manual)
- [ ] Verify Recent Transactions shows correct asset labels
- [ ] Create Sepolia passkey wallet; fund ETH + USDC
- [ ] Bridge In 10+ USDC
- [ ] Post-only limit order (rests)
- [ ] Crossing limit order (fills)
- [ ] Instant swap buy and sell F-USDC
- [ ] Pool deposit and partial withdraw
- [ ] Bridge Out to Sepolia address
- [ ] Send Out USDC to external `0x`

---

## Appendix D — RPC verification commands

```bash
# Account balance
curl -s http://46.224.0.140:6005 -H 'Content-Type: application/json' \
  -d '{"method":"account_info","params":[{"account":"rpUWZzFqJeZ5hmphWL6QuUbN8rux8SrdbU","ledger_index":"validated"}]}'

# Recent transactions
curl -s http://46.224.0.140:6005 -H 'Content-Type: application/json' \
  -d '{"method":"account_tx","params":[{"account":"rpUWZzFqJeZ5hmphWL6QuUbN8rux8SrdbU","limit":20}]}'

# F-USDC trust line balance
curl -s http://46.224.0.140:6005 -H 'Content-Type: application/json' \
  -d '{"method":"account_lines","params":[{"account":"rpUWZzFqJeZ5hmphWL6QuUbN8rux8SrdbU","ledger_index":"validated"}]}'

# AMM pool reserves
curl -s http://46.224.0.140:6005 -H 'Content-Type: application/json' \
  -d '{"method":"amm_info","params":[{"asset":{"currency":"XRP"},"asset2":{"currency":"QUC","issuer":"rfftKWuA7Dk7PF1YrH8NA7262oY3tejhqt"},"ledger_index":"validated"}]}'
```

---

*Generated from live testnet validation and on-ledger RPC queries. Update balances and sequences when re-running tests.*