/** Lending implementation report — rendered on /whitepaper (July 2026). */

export const LENDING_REPORT_DATE = '2026-07-14'

export const LENDING_REPORT_SECTIONS: { id: string; title: string; body: string }[] = [
  {
    id: 'lending-report',
    title: '12. Lending — Implementation Report',
    body: `**Date:** ${LENDING_REPORT_DATE} · **Network:** Falcon Ledger Testnet (ID \`1001\`, RPC \`http://46.224.0.140:6005\`) · **Status:** Permissionless borrow, repay, and liquidation verified on-ledger via coordinator E2E scripts; HF monitor deployed on coordinator. **Full report (PDF):** see **Lending Implementation Report** in Downloads above.

**Borrowers do not need a broker.** On testnet today (\`LendingPermissionless\` live), you post FALCON collateral (≥150% HF), sign \`LoanSet\` yourself — no co-sign, no broker first-loss cover. Legacy broker paths below are historical only.

Falcon Ledger lending is built on upstream **XRPL XLS-66** primitives (\`SingleAssetVault\`, \`LendingProtocol\`, \`MPTokensV1\`) plus qXRP extensions: \`ClaimLPReward\` (Proof-of-Participation LP emissions), \`LendingCollateral\` (FALCON locked in \`LoanSet\`), and \`LendingPermissionless\` (collateral-only borrow without broker co-sign). Protocol code lives in **qXRP**; the user-facing loop is wired in this portal.

| Capability | Portal | On-chain |
|------------|--------|----------|
| Supply F-USDC to vault | Yes — \`VaultDeposit\` | Yes |
| Borrow F-USDC (**current — permissionless**) | Yes — \`LoanSet\` + FALCON collateral | Yes — live on testnet |
| Borrow F-USDC (legacy broker — retired) | Co-sign path in code only | Pre-July 2026; not required |
| Repay loan | Yes — \`LoanPay\` (Pay full amount) | Yes |
| Withdraw supply | Yes — \`VaultWithdraw\` | Yes |
| Claim LP epoch rewards | Yes — \`ClaimLPReward\` | Yes — FALCON (PoPL) |
| FALCON collateral in \`LoanSet\` | Yes — locked on-chain | Yes — \`LendingCollateral\` |
| Health factor display (AMM price) | Yes — borrow preview + Positions + risk monitor | UI + daemon |
| On-chain liquidation | Yes — \`LoanManage\` + HF monitor | Yes — anyone can default on HF breach or late payment |
| Borrow / repay / claim / withdraw preflight | Yes — \`/api/lend/*-preflight\` | simulate before sign |
| Multi-loan Positions UI | Yes — loan selector | filters paid/closed loans |

**Economics:** LPs supply **F-USDC** to the vault. Borrowers pay **interest in F-USDC** via \`LoanPay\` — this increases vault \`AssetsTotal\`, so LP share value rises (no separate interest claim). Epoch **FALCON** emissions go to LPs via \`ClaimLPReward\` under the PoPL participation split. On default, the **liquidator receives FALCON collateral**; the vault books an AMM-price offset for collateral value and absorbs any residual shortfall in F-USDC accounting.

Liquidity in the lend pool is **real F-USDC** (QUC IOU from issuer \`rsJoDhjVV78jr6huHxKjtT8uG8RGeGmd1N\`), not bootstrap-minted supply.`,
  },
  {
    id: 'lending-architecture',
    title: '12.1 Architecture',
    body: `**Permissionless flow (target mainnet path):** Browser \`/lend\` → client WASM signing (\`falcon-lend-tx-sign.ts\`) → \`POST /api/lend/borrow-preflight\` → \`POST /api/wallet/submit\` → Falcon RPC. No server co-sign; borrower posts FALCON collateral meeting the 150% minimum health factor at AMM price.

**Legacy broker flow (retired):** Pre-\`LendingPermissionless\` only — required broker co-sign and first-loss cover. Not used for new borrows on testnet today.

| Repo | Role |
|------|------|
| qXRP | xrpld fork: transactors, \`LendingHelpers\`, \`LendingPermissionless\`, HF monitor scripts, fleet amendment enablement |
| qXRP-faucet-wallet | Portal: \`/lend\` UI, overview aggregation, preflight APIs, client tx signing, optional broker co-sign |

**Amendments (enable order):** (1) \`MPTokensV1\` — vault share MPT for LPs; (2) \`SingleAssetVault\`; (3) \`LendingProtocol\`; (4) \`LendingCollateral\` — collateral field on \`LoanSet\`; (5) \`LendingPermissionless\` — collateral-only borrow, permissionless liquidation. Fleet scripts: \`enable-lending-fleet.sh\`, \`enable-lending-permissionless-fleet.sh\`.`,
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
| Broker owner (legacy) | \`rJePmBhHoerhB4gJPAPEqvVBgQ7xbmY6bh\` — not an operator gate once permissionless is live |
| Interest | \`500\` tenth-bips = **5% APR** |
| Payment interval | \`86400\` s (1 day) |
| Payment total | \`1\` (single-installment test loans) |
| Grace period | \`3600\` s (1 hour) |

**Collateral rules (\`LendingPermissionless\`):** minimum health factor **1.5** (15,000 bps) at borrow; liquidation threshold **1.1** (11,000 bps) on outstanding debt. Price from FALCON/F-USDC AMM. Loans opened without broker co-sign carry \`lsfLoanPermissionless\`.`,
  },
  {
    id: 'lending-protocol',
    title: '12.3 Protocol Rules',
    body: `### Vault (supply side)

- **VaultDeposit** — LP sends F-USDC; receives vault share MPT
- **VaultWithdraw** — LP burns share MPT; receives F-USDC (FCFS)
- **ClaimLPReward** — LP claims FALCON epoch emission by vault share balance

### Permissionless borrow (\`LendingPermissionless\` + \`LendingCollateral\`)

- **LoanSet** — borrower signs only; posts \`Collateral\` (FALCON drops); no \`CounterpartySignature\`
- Protocol checks HF ≥ 1.5 at AMM price; skips broker cover requirement
- Sets \`lsfLoanPermissionless\` on the \`Loan\` object

### Legacy broker borrow (retired — historical)

- Previously required broker \`CounterpartySignature\` and broker cover ≥ 1% of debt
- Replaced by permissionless collateral on testnet

### Loan lifecycle

- **LoanPay** — installment must be ≥ periodic payment (principal + interest/fees). Principal-only repay → \`tecINSUFFICIENT_PAYMENT\`.
- **LoanManage** — on permissionless loans, **any account** may \`impair\` (HF &lt; 1.1) or \`default\` (HF breach or payment past grace). Default transfers FALCON collateral to the liquidator and offsets vault loss at AMM price.

**Rate encoding:** 1 tenth-bip = 0.0001%; 100,000 tenth-bips = 100%.`,
  },
  {
    id: 'lending-portal',
    title: '12.4 Portal Implementation',
    body: `### UI (\`/lend\`)

| Tab | Panel | Transaction |
|-----|-------|-------------|
| Overview | Pool stats, APY, risk monitor | Read-only |
| Supply | \`LendSupplyPanel\` | \`VaultDeposit\` |
| Borrow | \`LendBorrowPanel\` | \`LoanSet\` (permissionless or co-sign) |
| Positions | \`LendPositionsPanel\` | \`VaultWithdraw\`, \`LoanPay\`, \`ClaimLPReward\` |

**Wallet auth:** passkey → decrypt Falcon seed in browser → WASM sign → \`POST /api/wallet/submit\`.

### API routes

- **\`GET /api/lend/overview\`** — vault, broker, epoch/PoP, AMM price, loans, LP positions, \`lendingPermissionless\` flag
- **\`POST /api/lend/borrow-preflight\`** — collateral HF, vault liquidity, cosign requirement
- **\`POST /api/lend/repay-preflight\`**, **\`claim-preflight\`**, **\`withdraw-preflight\`**, **\`supply-preflight\`**
- **\`GET /api/lend/risk-monitor\`** — fleet-wide HF scan
- **\`POST /api/lend/loan-manage\`** — broker/HF daemon submits \`LoanManage\`
- **\`POST /api/lend/cosign\`** (legacy testnet) — broker \`CounterpartySignature\`

### Repay UX

Positions auto-fills exact installment due and exposes **Pay full amount**. Verified loan: 10 F-USDC at 5% APR, 1-day interval → **10.000137 F-USDC** due.`,
  },
  {
    id: 'lending-flows',
    title: '12.5 End-to-End Flows',
    body: `**Supply:** User holds F-USDC + trust line → Supply → \`VaultDeposit\` → vault share MPT → vault \`AssetsAvailable\` increases.

**Borrow (permissionless):** Portal checks collateral (150% HF), vault liquidity → borrower signs \`LoanSet\` with \`Collateral\` → submit → F-USDC to borrower; FALCON locked on loan.

**Borrow (legacy — retired):** Historical broker co-sign path; not required when permissionless is enabled.

**Repay:** \`LoanPay\` with full installment → F-USDC returns to vault (LP yield via share value).

**Withdraw supply:** \`VaultWithdraw\` burns share MPT, returns F-USDC.

**Claim LP rewards:** \`ClaimLPReward\` → FALCON from epoch emission.

**Liquidation:** HF monitor (\`lend-hf-monitor.py\`) or any party calls \`LoanManage\` default → liquidator receives FALCON; vault loss offset at AMM price.`,
  },
  {
    id: 'lending-verified',
    title: '12.6 Coordinator E2E Verification',
    body: `Scripts on coordinator (\`qXRP/scripts/\`): \`lend-e2e-permissionless.py\`, \`lend-e2e-liquidation.py\`, \`lend-hf-monitor.py\`. Fleet amendment \`LendingPermissionless\` enabled at ledger ~**126464**.

### Test A — Permissionless borrow + repay

| Wallet | Address |
|--------|---------|
| Borrower | \`rPxzyo4FdL7Pt7LekxpvTLTK2bLHZQBum8\` |

| Step | Tx hash | Result |
|------|---------|--------|
| Borrow 5 F-USDC (875 FALCON collateral) | \`78E3A2528B1C40FD09082D6249B65FC6EE1ECE9FE6F8B106E3E20F3FF81AC172\` | tesSUCCESS |
| Repay **5.000069** F-USDC | \`93B058510F90402CD34F12BF83C83BBDF684C6D2F8E06749AF3310892097E719\` | tesSUCCESS |

### Test B — HF breach liquidation

| Wallet | Address |
|--------|---------|
| Borrower | \`r3XK65UbcEhsif3UjWbqNdKeD28TBeSc62\` |
| Liquidator | \`rJM5vq5umHp82iztWHsZySAoUSMuD5VbgT\` |

| Step | HF | Tx hash | Result |
|------|-----|---------|--------|
| Borrow 5 F-USDC | 1.501 | \`0834FB47C0FB9CDE0D32E57FCD7666D54AD31A972BDB07FDF97C3601A63ED645\` | tesSUCCESS |
| AMM dump 4000 FALCON | 1.231 | \`43E459BC0FB5C36B5D0CFAE7053E29DBDD0E40A72A4B7F5C8603B17D075A1984\` | tesSUCCESS |
| AMM dump 8000 FALCON | 0.856 | \`989B04758E4BC7AFE598B73496DBCE48ABDA99CF002BFFF854E8898514734DBE\` | tesSUCCESS |
| Liquidator \`LoanManage\` default | — | \`BA1C8431CEBDE5812DC9315EDE6B56FAAB4FCF0A592C0911303A3949DFA6588D\` | tesSUCCESS (+1928 FALCON to liquidator) |

### Portal session (legacy broker, 2026-07-10)

Wallet \`rwcYXAAXe7unkEwPVFWMbyzXE2ajG3juqR\`: vault deposit, borrow 10 F-USDC (broker co-sign), repay **10.000137** F-USDC (ledger **30899**).

**Lesson:** \`LoanPay\` requires the **full installment** (principal + interest/fees), rounded up to 6 dp — not principal alone.`,
  },
  {
    id: 'lending-ops-security',
    title: '12.7 Operations & Security',
    body: `### Bootstrap (coordinator)

\`\`\`
bash scripts/enable-lending-fleet.sh --wait
bash scripts/enable-lending-permissionless-fleet.sh --wait   # after lending-permissionless docker build
python3 scripts/issue-testnet-stables.py
python3 scripts/bootstrap-testnet-lending.py
\`\`\`

HF monitor: \`scripts/lend-hf-monitor.py\` + \`deploy-lend-hf-monitor.sh\` on coordinator.

### Portal env (Vercel)

| Variable | Required for |
|----------|----------------|
| Testnet RPC | Overview + submit |
| \`TESTNET_LENDING_BROKER_SECRET\` | Legacy borrow co-sign + HF daemon only (remove after permissionless live) |
| \`SIGNER_PROXY_URL\` / \`SIGNER_PROXY_TOKEN\` | Legacy co-sign + daemon |
| \`LEND_HF_MONITOR_TOKEN\` | HF monitor → \`loan-manage\` |

### Security model

| Asset | Model |
|-------|--------|
| User Falcon seed | Passkey-encrypted; browser-only signing |
| Broker secret | Server-only; legacy co-sign + daemon — not required for permissionless borrow |
| Permissionless borrow | No gatekeeper signature; collateral + HF enforced on-ledger |`,
  },
  {
    id: 'lending-gaps',
    title: '12.8 Gaps & Next Steps',
    body: `### Remaining

- Payment-default liquidation E2E (24h payment interval + grace — not quick-script friendly)
- Portal liquidator UX for third-party \`LoanManage\` default
- Vercel redeploy; retire \`TESTNET_LENDING_BROKER_SECRET\` if legacy co-sign unused
- Live APY from epoch \`EmissionRate\` in overview

### Mainnet considerations

- Permissionless collateral-only borrow — no broker operator or HSM co-sign
- Do not bootstrap-mint F-USDC into vault (bridge-only policy)
- Liquidation under thin AMM depth / manipulation resistance

**Conclusion:** Falcon Ledger lending is **verified on testnet** — permissionless borrow/repay, HF-breach liquidation, HF monitor daemon, portal \`/lend\`, and real F-USDC vault liquidity. See the PDF download for the complete implementation reference.`,
  },
]