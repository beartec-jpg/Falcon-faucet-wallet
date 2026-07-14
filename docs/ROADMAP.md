# Falcon Ledger Portal — Roadmap

**Last updated:** July 2026  
**Testnet:** Network ID 1001 · RPC `http://46.224.0.140:6005`

This roadmap covers the **web portal** (`Falcon-faucet-wallet`) and its integration with the Falcon Ledger protocol. Protocol-level milestones (consensus, treasury, slashing) are also tracked in the [whitepaper](/whitepaper) §10.

---

## Shipped — testnet live today

### Wallet & identity
- [x] Passkey-secured Falcon-512 wallet create / restore / unlock
- [x] Client-side Falcon transaction signing (WASM / liboqs)
- [x] Encrypted seed storage (IndexedDB + passkey-derived key)
- [x] FALCON send with address validation
- [x] F-USDC peer-to-peer send (IOU Payment)
- [x] QR code scanner for recipient addresses
- [x] Receive QR code display
- [x] Recent transactions with correct FALCON / F-USDC labels
- [x] PWA install prompt and service worker
- [x] Validator deploy one-liner (1,000 FALCON bond warning)

### Faucet & explorer
- [x] Rate-limited FALCON faucet drip
- [x] Ledger / transaction explorer (`/scan`)
- [x] Network switcher (testnet / mainnet placeholder)

### Swap & DEX
- [x] FALCON ↔ F-USDC instant AMM swap
- [x] DEX limit orders (OfferCreate / OfferCancel)
- [x] Default crossing behavior (immediate match against book)
- [x] Post-only passive orders (`TF_PASSIVE` opt-in)
- [x] Live order book panel
- [x] Open orders panel with persistence and cancel
- [x] Dust offer filtering on public book
- [x] Price inverse helper (FALCON per F-USDC semantics)
- [x] F-USDC labeling on swap UI (distinct from Sepolia USDC)

### Liquidity pool
- [x] AMM pool page (`/pool`)
- [x] Add liquidity (FALCON + F-USDC deposit)
- [x] Remove liquidity (partial / full LP withdraw)
- [x] Pool stats, LP share %, estimated withdrawal amounts
- [x] F-USDC labels on pool UI

### Sepolia bridge
- [x] Passkey-encrypted Sepolia EVM wallet (no MetaMask)
- [x] Bridge In: Sepolia USDC → F-USDC (lock contract + relay mint)
- [x] Bridge Out: F-USDC → Sepolia USDC (`sepolia-withdraw` memo + relay)
- [x] Send Out: Sepolia ETH / USDC to external `0x` addresses
- [x] Encrypted EVM wallet backup export/import
- [x] Bridge config manifest (`public/config/usdc-bridge.json`)
- [x] End-to-end verified on Sepolia + Falcon (see [TESTNET-E2E-REPORT.md](./TESTNET-E2E-REPORT.md))

### Validator & rewards
- [x] Validator register / bond / unbond UI
- [x] ClaimReward from portal
- [x] Bond status and composite score display

### Lending
- [x] `SingleAssetVault`, `LendingProtocol`, and `LendingCollateral` amendments enabled on testnet
- [x] Lend tab: balances, AMM price, health-factor calculator, APY panel
- [x] Portal wiring for `VaultDeposit` / `LoanSet` / `LoanPay` / `VaultWithdraw` / `ClaimLPReward`
- [x] FALCON collateral in `LoanSet` + on-chain health display (`LendingCollateral`)
- [x] Permissionless borrow path in portal (`LendingPermissionless` — no broker co-sign when amendment live)
- [x] On-chain liquidation via `LoanManage` (HF monitor daemon + `/api/lend/loan-manage`)
- [x] Risk monitor panel, borrow/repay/claim/withdraw preflight APIs, multi-loan Positions

### Protocol (testnet)
- [x] Falcon-512 account creation and transaction signing
- [x] Falcon validator consensus fleet upgrade (`validation_falcon_secret`, Falcon hex UNL)
- [x] Protocol treasury, CID epoch emission, participation-based LP split (1% per vault depositor, cap 50%)
- [x] Validator PoP scoring and ClaimReward
- [x] Double-sign slashing (100% bond)
- [x] On-chain governance proposals and voting
- [x] Sustained load testing (850k+ payments, 71+ hours)

### Message board
- [x] Neon Postgres-backed community board (`/board`)
- [x] Falcon sign-to-post authentication
- [x] Threaded replies (one level deep)
- [x] Per-wallet rate limit (10 posts/hour)

### Documentation & QA
- [x] Comprehensive E2E test report with on-ledger references
- [x] Falcon signing verification script (`pnpm verify:sign`)
- [x] CI: `pnpm-lock.yaml` sync enforcement

---

## In progress — July 2026

### Protocol
- [x] `LendingPermissionless` + `LoanCollateralDeposit` fleet on `qxrp/xrpld:lending-v2` (7/7 nodes, July 2026)
- [ ] Real latency scoring (currently neutral floor at 5,000 bps)
- [ ] Additional slashing offenses (absence, invalid-vote — currently `temDISABLED` on testnet)

### Portal
- [x] Portal lend UI: permissionless borrow, duration picker (1–52 epochs), Positions add-collateral (`LoanCollateralDeposit`)
- [ ] Retire `TESTNET_LENDING_BROKER_SECRET` if legacy co-sign fully unused
- [ ] Live APY from epoch `EmissionRate` in overview (currently fixed APR display)
- [ ] Post-genesis E2E PDF report regeneration
- [ ] Mainnet network config and go-live toggle (`NEXT_PUBLIC_MAINNET_LIVE`)
- [ ] Production security audit for passkey + bridge flows
- [ ] Mobile-native wallet app (PWA is live; native TBD)
- [ ] Transaction history pagination and filtering
- [ ] Push notifications for incoming payments

### Liquidity
- [ ] Additional stablecoin pairs (USDT) on testnet
- [ ] Deeper AMM liquidity bootstrap program
- [ ] Cross-wallet order matching stress tests at scale

---

## Planned — mainnet prep

### Must-have before mainnet
- [ ] Mainnet genesis validator set finalized
- [ ] External security audit (wallet crypto, bridge relay, signer proxy)
- [ ] Mainnet Network ID and RPC endpoints published
- [ ] Faucet disabled or capped on mainnet; real economic flows only
- [ ] PRF-only passkey mode enforced (drop rawId fallback)
- [ ] Bridge production contracts (Ethereum L1 or chosen L2)
- [ ] MPT-native USDC on Falcon ledger (reduce IOU trust-line friction)

### Nice-to-have
- [ ] Hardware wallet integration
- [ ] Multi-account passkey profiles
- [ ] Fiat on-ramp partner integration
- [ ] Validator fleet dashboard in portal
- [ ] Governance proposal UI (read + vote)
- [ ] NFT / MPT marketplace expansion

---

## Known limitations (testnet)

| Area | Limitation | Tracking |
|------|------------|----------|
| AMM | High slippage on thin pool | Add LP before large swaps |
| Bridge | Relay polling latency (seconds–minutes) | Monitor relay process |
| DEX | Partial-fill dust remainders | Cancel manually; hidden from book |
| F-USDC | Requires trust line before receive / bridge mint | Explicit TrustSet step on Bridge tab (and Swap tab for P2P) |
| Lend | `LendingPermissionless` not yet enabled on all validators | Fleet docker rebuild + amendment vote in progress |
| Lend | Broker co-sign path legacy only | Remove `TESTNET_LENDING_BROKER_SECRET` once permissionless live |
| Passkeys | rawId fallback weaker than PRF | Testnet only — see `src/lib/passkey.ts` |
| Signing | Server routes need signer proxy on node1 | Documented in `.env.example` |

---

## How to contribute / test

1. Clone repo, `pnpm install`, `pnpm dev`
2. Create a passkey wallet on testnet
3. Fund via faucet; run through [E2E regression checklist](./TESTNET-E2E-REPORT.md#appendix-c--suggested-regression-checklist)
4. File issues on [GitHub](https://github.com/beartec-jpg/Falcon-faucet-wallet/issues)

---

## Version history (portal)

| Date | Highlights |
|------|------------|
| Jul 2026 | Permissionless lending, HF liquidation, multi-loan Positions, lending preflight APIs, whitepaper v2.5 |
| Jul 2026 | Post-genesis issuer, lending amendments, bridge trust-line gate, PoPL LP participation, whitepaper v2.3 |
| Jul 2026 | Bridge, pool, DEX limit orders, F-USDC P2P, QR scanner, tx label fix, E2E report |
| Jun 2026 | Client-side Falcon signing, passkey PWA wallet |
| Earlier | Faucet, explorer, validator onboarding, whitepaper |