/** Lending implementation report — rendered on /whitepaper (July 2026). */

export const LENDING_REPORT_DATE = '2026-07-10'

export const LENDING_REPORT_SECTIONS: { id: string; title: string; body: string }[] = [
  {
    id: 'lending-report',
    title: '12. Lending — Implementation Report',
    body: `**Date:** ${LENDING_REPORT_DATE} · **Network:** Falcon Ledger Testnet (ID \`1001\`, RPC \`http://46.224.0.140:6005\`) · **Status:** End-to-end supply, borrow, and repay verified via the portal at \`/lend\`.

Falcon Ledger lending is built on upstream **XRPL XLS-66** primitives (\`SingleAssetVault\`, \`LendingProtocol\`, \`MPTokensV1\`) plus qXRP extensions (\`ClaimLPReward\` for Proof-of-Participation LP emissions). Protocol code lives in the **qXRP** repository; the user-facing loop is wired in this portal.

| Capability | Portal | On-chain |
|------------|--------|----------|
| Supply F-USDC to vault | Yes — \`VaultDeposit\` | Yes |
| Borrow F-USDC from vault | Yes — \`LoanSet\` + broker co-sign | Yes |
| Repay loan | Yes — \`LoanPay\` (Pay full amount) | Yes |
| Withdraw supply | Yes — \`VaultWithdraw\` | Yes |
| Claim LP epoch rewards | Yes — \`ClaimLPReward\` | Yes |
| FALCON collateral in \`LoanSet\` | Yes — locked on-chain (\`LendingCollateral\`) | Yes |
| Health factor display (AMM price) | Yes — borrow preview + Positions | UI math only |
| On-chain liquidation | No | \`LoanManage\` not wired in portal |

Liquidity in the lend pool is **real F-USDC** (QUC IOU from issuer \`rsJoDhjVV78jr6huHxKjtT8uG8RGeGmd1N\`), not bootstrap-minted supply. Borrowers require **broker first-loss cover** before \`LoanSet\` succeeds.

**Verified round-trip** (wallet \`rwcYXAAXe7unkEwPVFWMbyzXE2ajG3juqR\`): borrow **10 F-USDC**; failed repay at **10** and **5** (\`tecINSUFFICIENT_PAYMENT\`); successful repay at **10.000137 F-USDC** (\`tesSUCCESS\`, ledger **30899**).`,
  },
  {
    id: 'lending-architecture',
    title: '12.1 Architecture',
    body: `**Flow:** Browser \`/lend\` UI → client WASM signing (\`falcon-lend-tx-sign.ts\`) → \`POST /api/wallet/submit\` → Falcon RPC. Borrows additionally call \`POST /api/lend/cosign\`, which signs the broker \`CounterpartySignature\` via the validator signer proxy using \`TESTNET_LENDING_BROKER_SECRET\` (never sent to the browser).

| Repo | Role |
|------|------|
| qXRP | xrpld fork: transactors, invariants, \`LendingHelpers\`, bootstrap scripts, fleet amendment enablement |
| qXRP-faucet-wallet | Portal: \`/lend\` UI, overview aggregation, client tx signing, broker co-sign API |

**Amendments (enable order):** (1) \`MPTokensV1\` — vault share MPT for LPs; (2) \`SingleAssetVault\` — \`VaultCreate\`, \`VaultDeposit\`, \`VaultWithdraw\`; (3) \`LendingProtocol\` — \`LoanBrokerSet\`, \`LoanSet\`, \`LoanPay\`, \`LoanManage\`. Fleet script: \`qXRP/scripts/enable-lending-fleet.sh\`.`,
  },
  {
    id: 'lending-onchain',
    title: '12.2 On-Chain Objects (Testnet)',
    body: `Authoritative manifest: \`public/config/lending.json\`

| Item | Value |
|------|-------|
| Network ID | \`1001\` |
| F-USDC currency | \`QUC\` |
| F-USDC issuer | \`rsJoDhjVV78jr6huHxKjtT8uG8RGeGmd1N\` |
| Vault ID | \`0DB363B417A560EDD7EA8306188F5592F2388A054BF7F6AC1FB5A99A30BC99B2\` |
| Loan broker ID | \`0DF028DFE8928921B9474B5EB09531E1E7A3655441C53ECFECF41C82F374D334\` |
| Broker owner | \`rJePmBhHoerhB4gJPAPEqvVBgQ7xbmY6bh\` |
| Interest | \`500\` tenth-bips = **5% APR** |
| Payment interval | \`86400\` s (1 day) |
| Payment total | \`1\` (single-installment test loans) |
| Grace period | \`3600\` s (1 hour) |

**Snapshot after verified repay (ledger 30899):**

| Metric | Value |
|--------|-------|
| Vault \`AssetsTotal\` / \`AssetsAvailable\` | **200.000137** F-USDC |
| Broker \`CoverAvailable\` | **30** F-USDC |
| Broker \`DebtTotal\` | **0** |
| Wallet F-USDC (test wallet) | **~60** F-USDC |

Bootstrap starts with zero vault seed and zero genesis broker cover. LPs fund the vault via the portal; the operator posts cover via \`deposit-testnet-broker-cover.py\`.`,
  },
  {
    id: 'lending-protocol',
    title: '12.3 Protocol Rules',
    body: `### Vault (supply side)

- **VaultCreate** — one asset per vault (testnet: QUC IOU); issues share MPT to LPs
- **VaultDeposit** — LP sends F-USDC to vault pseudo-account; receives vault share MPT
- **VaultWithdraw** — LP burns share MPT; receives F-USDC (FCFS policy)
- **ClaimLPReward** (qXRP) — LP claims FALCON emission by vault share balance and epoch state

### Loan broker (operator)

- **LoanBrokerSet** — \`CoverRateMinimum\` 1000 tenth-bips (**1%** of debt covered), \`CoverRateLiquidation\` 2500 (2.5%), \`ManagementFeeRate\` 100 (0.1% of interest)
- **LoanBrokerCoverDeposit** — broker owner deposits F-USDC into \`CoverAvailable\`
- **Borrow gate:** at \`LoanSet\`, if cover &lt; 1% × (debt + new principal + interest) → \`tecINSUFFICIENT_FUNDS\` (not a vault liquidity error)

### Loan lifecycle

- **LoanSet** — requires broker \`CounterpartySignature\`, vault \`AssetsAvailable ≥ principal\`; creates \`Loan\` object
- **LoanPay** — installment must be ≥ periodic payment (principal + interest/fees). Paying principal only (e.g. \`10\` when due is \`10.000137\`) → \`tecINSUFFICIENT_PAYMENT\`. Partial payments below the installment minimum are not supported for regular \`LoanPay\`.
- **LoanManage** — default / impairment (not exposed in portal UI)

**Rate encoding:** 1 tenth-bip = 0.0001%; 100,000 tenth-bips = 100%.`,
  },
  {
    id: 'lending-portal',
    title: '12.4 Portal Implementation',
    body: `### UI (\`/lend\`)

| Tab | Panel | Transaction |
|-----|-------|-------------|
| Overview | \`LendPoolOverviewPanel\` | Read-only pool stats |
| Supply | \`LendSupplyPanel\` | \`VaultDeposit\` |
| Borrow | \`LendBorrowPanel\` | \`LoanSet\` |
| Positions | \`LendPositionsPanel\` | \`VaultWithdraw\`, \`LoanPay\`, \`ClaimLPReward\` |

**Wallet auth:** passkey → decrypt Falcon seed in browser → WASM sign → \`POST /api/wallet/submit\`.

### API routes

- **\`GET /api/lend/overview\`** — vault, broker, epoch/PoP, AMM price, wallet F-USDC, loans, LP positions, pool stats
- **\`POST /api/lend/cosign\`** (testnet) — broker \`CounterpartySignature\` via signer proxy; \`LoanSet\` only; broker ID must match manifest
- **\`POST /api/wallet/submit\`** — submits signed \`tx_blob\` via public RPC

### Repay UX

The Positions panel auto-fills the exact installment due and exposes a **Pay full amount** button (principal + interest/fees, rounded up to 6 decimal places). Pre-flight checks block underpayment before passkey signing. On the verified loan: 10 F-USDC at 5% APR, 1-day interval → **10.000137 F-USDC** due.

| Helper (\`lend-borrow-errors.ts\`) | Purpose |
|-----------------------------------|---------|
| \`borrowBlockedReason\` | Pre-flight: cosign, vault liquidity, broker cover |
| \`repayBlockedReason\` | Pre-flight: installment ≥ periodic payment, wallet balance |
| \`fullRepayAmount\` | Exact due for auto-fill and Pay full amount |
| \`explainLendSubmitError\` | Maps \`tecINSUFFICIENT_FUNDS\`, \`tecINSUFFICIENT_PAYMENT\`, etc. |`,
  },
  {
    id: 'lending-flows',
    title: '12.5 End-to-End Flows',
    body: `**Supply:** User holds F-USDC + trust line → Lend → Supply → passkey → \`VaultDeposit\` → vault share MPT (shown as “Lend share” on wallet dashboard) → vault \`AssetsAvailable\` increases.

**Borrow:** Portal checks \`borrowBlockedReason\` → borrower signs \`LoanSet\` → \`POST /api/lend/cosign\` adds broker signature → submit → F-USDC to borrower; broker \`DebtTotal\` increases.

**Repay:** Overview loads \`PeriodicPayment\` → UI auto-fills full due → **Pay full amount** → \`LoanPay\` → vault receives F-USDC; loan closed when fully paid.

**Withdraw supply:** Positions → \`VaultWithdraw\` burns share MPT, returns F-USDC.

**Claim LP rewards:** Positions → \`ClaimLPReward\` for configured vault ID.`,
  },
  {
    id: 'lending-verified',
    title: '12.6 Verified Testnet Session',
    body: `Wallet: \`rwcYXAAXe7unkEwPVFWMbyzXE2ajG3juqR\` · Sepolia bridge: \`0x1e6838624c6538cfb39eb2d223064ce524178f03\`

| Step | Result | Notes |
|------|--------|-------|
| Bridge in / F-USDC mint | Success | ~300 F-USDC received from issuer |
| Vault deposit | Success | 100 F-USDC to lend pool |
| AMM create | Success | 15,000 FALCON + 150 F-USDC pool |
| Borrow 10 F-USDC | Success | \`LoanSet\` + broker co-sign |
| Repay 10 F-USDC | Failed | \`tecINSUFFICIENT_PAYMENT\` — principal only |
| Repay 5 F-USDC | Failed | \`tecINSUFFICIENT_PAYMENT\` — below minimum |
| Repay 10.000137 F-USDC | Success | Full installment; loan repaid |
| Bridge out 70 F-USDC | Success | Sepolia USDC released |

**Successful repay transaction:**

| Field | Value |
|-------|-------|
| Type | \`LoanPay\` |
| Amount | \`10.000137\` F-USDC |
| Result | \`tesSUCCESS\` |
| Ledger | **30899** |
| Tx hash | \`71307F0BA93F8062D3F80056B7E33802753CE2BF1DCD0E664B24EC9CFF843DF5\` |
| Vault effect | \`AssetsAvailable\` 190 → **200.000137** |
| Broker effect | \`DebtTotal\` 10.000137 → **0** |

**Lesson:** wallet F-USDC balance was sufficient; repay must match the **installment due** (principal + interest/fees), not principal alone.`,
  },
  {
    id: 'lending-ops-security',
    title: '12.7 Operations & Security',
    body: `### Bootstrap (coordinator)

\`\`\`
bash scripts/enable-lending-fleet.sh --wait
python3 scripts/issue-testnet-stables.py
python3 scripts/bootstrap-testnet-lending.py
python3 scripts/deposit-testnet-broker-cover.py --amount 30
\`\`\`

### Portal env (Vercel)

| Variable | Required for |
|----------|----------------|
| \`TESTNET_LENDING_BROKER_SECRET\` | Borrow (co-sign) |
| \`SIGNER_PROXY_URL\` | Borrow |
| \`SIGNER_PROXY_TOKEN\` | Borrow |
| Testnet RPC | Overview + submit |
| \`ALLOWED_ORIGINS\` | Cosign/submit CSRF |

### Security model

| Asset | Model |
|-------|--------|
| User Falcon seed | Passkey-encrypted in IndexedDB; browser-only signing |
| Broker owner secret | Server-only; co-sign route only |
| Co-sign route | Testnet-only, origin-checked, \`LoanSet\` only |
| Submit route | Rate-limited; no private keys |

**First-loss cover:** broker posts F-USDC that absorbs losses before vault LP principal. Minimum cover scales with outstanding broker debt (1% on testnet).`,
  },
  {
    id: 'lending-gaps',
    title: '12.8 Gaps & Next Steps',
    body: `### Not yet in portal

- On-chain liquidation (\`LoanManage\` + daemon HF enforcement)
- Multi-loan repay UI (only first active loan)
- Claim rewards UX polish (\`canClaim\`, estimated reward)
- Withdraw/supply preflight (share balance, vault utilization)
- Mainnet broker co-sign / HSM flow

### Mainnet considerations

- Do not bootstrap-mint F-USDC into vault (bridge-only policy)
- Broker cover must be operator-funded, not protocol-inflated
- Production-grade key management for broker co-sign

**Conclusion:** Falcon Ledger lending on testnet is a working vertical slice — real F-USDC vault liquidity, broker-gated borrows with server co-sign, FALCON collateral locked in \`LoanSet\`, health display from on-chain collateral + AMM price, and interest-aware repay via **Pay full amount**. Next priorities: on-chain liquidation, claim/withdraw validation, and mainnet key management.`,
  },
]