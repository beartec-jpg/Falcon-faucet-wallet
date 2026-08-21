# Falcon PL Web Portal

Official public portal for **Falcon PL** testnet (network ID **2300**) — Falcon Consensus + Falcon-512. The old Falcon Ledger / XRPL fork (network **1001**) is shut down; those balances are lost.

**Live:** [falcon-ledger.com](https://falcon-ledger.com) · **Repo:** [Falcon-faucet-wallet](https://github.com/beartec-jpg/Falcon-faucet-wallet)

---

## Features

### Faucet
- Rate-limited testnet **FPL** drip (default 2,000 per request)
- Falcon PL named accounts (network **2300**), not classic `r…` XRPL addresses

### Wallet (passkey-secured)
- **Create** Falcon-512 wallets with WebAuthn passkeys — keys generated on-device
- **Restore** from saved `falcon_secret` or unlock an existing passkey-encrypted wallet
- **Send / receive FPL** — named Falcon PL accounts or QR
- **Send / receive F-USDC** — dest-lock USDC on 2300 (peg-in live)
- **Recent transactions** — FPL and rail-asset labels
- **Validator onboarding** — one-click deploy command with your address as `--payout` (1,000 FALCON bond)
- **PWA** — installable progressive web app with offline shell

### Swap
- **Instant swap** — buy/sell **F-USDC** via the on-chain AMM (FALCON ↔ F-USDC)
- **Limit orders** — DEX order book with crossing fills by default; **Post only** for passive resting orders
- **Order book** — live bids/asks; dust remainders filtered from public book
- **Open orders** — persistent panel with cancel and fill status
- Price field is **FALCON per F-USDC** (inverse helper shown in UI)

### Bridge (Sepolia ↔ Falcon PL 2300)

Paperwork: [docs/BRIDGES-2300.md](docs/BRIDGES-2300.md).

- **Dest-lock ETH/USDC** — `FalconBridge` `depositEth(bytes20)` / `depositUsdc` auto-mints on Falcon PL. `openClaim` / `take` for peg-out (operator e2e green; wallet take next). `dest20 = sha256(lowercase PL account)[:20]`. Config: `public/config/pl-2300-bridge.json` (`status: live`).
- **Live contract:** `0x7eB72974F2d2a4AaDFabAf0975a29470fcd163E4` (Sepolia). Groth16 verifier `0x7db9b1862AE7D04cE9ff85447390bDdfa972a9d0`.
- **BTC** — BitVM dest-lock + FROST vault on 2300. Wallet flag `BTC_RAIL_LIVE = false`.
- **Classic XRPL FXRP** — separate corridor; not the 1001 Falcon Ledger fork.
- **Passkey Sepolia wallet** — no MetaMask; EVM keys encrypted on-device.
- **Send Out** — move Sepolia ETH or USDC to any external `0x` address.
- **EVM backup** — encrypted export/import of Sepolia private key.

Do **not** send to old FalconCollateralLock `0x2dae31…` / `0x11808B…` (`public/config/usdc-bridge.json` is the retired 1001 lock, kept for FXRP notes only).

### Pool
- **Add liquidity** — deposit FALCON + F-USDC into the FALCON/F-USDC AMM
- **Withdraw liquidity** — partial or full LP burn
- Live pool stats, LP share %, and estimated withdrawal amounts

### Lend
- **Protocol live** — `SingleAssetVault`, `LendingProtocol`, `LendingCollateral`, and `LendingPermissionless` (fleet rollout) on testnet
- **Permissionless borrow** — post FALCON collateral (150% min health factor at AMM price); no broker `CounterpartySignature` when `LendingPermissionless` is enabled
- **Overview** — pool utilization, AMM mid price, APY panel, risk monitor, health-factor preview
- **Supply / Borrow / Repay** — portal-signed `VaultDeposit`, `LoanSet`, `LoanPay`, `VaultWithdraw`, and `ClaimLPReward`
- **Positions** — multi-loan selector, on-chain collateral + health factor, repay preflight, claim estimates
- **Liquidation** — on-chain `LoanManage` (HF breach or late payment); **FALCON is not sold** — forfeited collateral goes to the vault **LP claim pot** (`VaultClaimCollateral`); LPs stay in F-USDC for interest via share value
- **LP yield** — borrower interest returns as F-USDC to the vault; epoch FALCON emissions via `ClaimLPReward` (PoPL participation split)
- **Legacy broker path** — pre-permissionless borrows still use `POST /api/lend/cosign` + broker cover (testnet only)

### Explorer
- Ledger and transaction lookup by hash or address

### Rewards / Validator
- Register, bond (1,000 FALCON), unbond, and **ClaimReward** from the portal
- Composite score and epoch emission visibility

### Message Board
- **Community board** at `/board` — wallet address is your identity
- **Sign to post** — Falcon signature proves ownership before publishing
- **Threaded replies** — reply to any top-level post
- Backed by **Neon Postgres** (`DATABASE_URL`)

### Whitepaper
- In-app protocol overview at `/whitepaper`

---

## Asset labeling

| UI label | What it is | Where used |
|----------|------------|------------|
| **FPL** | Native Falcon PL asset (network 2300) | Wallet, Swap, Pool, DEX |
| **F-USDC / FETH** | Bridged USDC / ETH on Falcon PL (dest-lock rail; not live) | Wallet, Bridge |
| **Sepolia USDC** | ERC-20 on Ethereum Sepolia | Multi-chain / Bridge |
| **FXRP** | Classic XRPL XRP corridor | Bridge (not 1001) |

F-USDC and Sepolia USDC are **not** the same token — the bridge converts between them.

---

## Network

| Item | Value |
|------|-------|
| Name | Falcon Ledger Testnet |
| Network ID | `1001` |
| Public RPC | `http://46.224.0.140:6005` |
| F-USDC issuer | `rsJoDhjVV78jr6huHxKjtT8uG8RGeGmd1N` (currency `QUC`) |
| F-USDC liquidity | DEX offers + AMM (see Pool / Swap tabs) |
| Faucet | `rwzhiWW4GYK2sQVR5Lw4iDpYLANB5krJXY` |
| Epoch length | 172,800 ledgers (~7 days) |
| Min validator bond | 1,000 FALCON |
| Lending | `SingleAssetVault` + `LendingProtocol` + `LendingCollateral`; `LendingPermissionless` rolling out |

Always use the **public RPC port (6005)**. Admin ports (5005) stay on localhost via the signing proxy.

---

## Falcon signing

User accounts and the faucet use **Falcon-512** keys. Classical `ripple-keypairs` cannot sign Falcon transactions.

- **Browser:** Client-side signing via `@openforge-sh/liboqs` WASM (`src/lib/falcon-tx-sign.ts`)
- **Server routes:** Optional signer proxy on node1 (`SIGNER_PROXY_URL`) for faucet and legacy API paths

Store your `falcon_secret` when creating a wallet — it cannot be derived from a classical seed.

---

## Documentation

| Doc | Description |
|-----|-------------|
| [Docs/FALCON-TESTNET-E2E-REPORT.pdf](Docs/FALCON-TESTNET-E2E-REPORT.pdf) | Testnet E2E report (PDF) — also on [Whitepaper](/whitepaper) |
| [Docs/FALCON-SECURITY-REPORT-wallet-send-receive-backup-restore.pdf](Docs/FALCON-SECURITY-REPORT-wallet-send-receive-backup-restore.pdf) | Wallet security report (PDF) |
| [docs/sql/board-schema.sql](docs/sql/board-schema.sql) | Neon SQL schema for the message board |
| [docs/TESTNET-E2E-REPORT.md](docs/TESTNET-E2E-REPORT.md) | Full end-to-end test report with on-ledger seq/hash references |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Shipped features, in-progress work, and mainnet plan |
| [public/config/usdc-bridge.json](public/config/usdc-bridge.json) | Sepolia bridge manifest |
| [public/config/testnet-stables.json](public/config/testnet-stables.json) | F-USDC issuer config |
| [.env.example](.env.example) | Environment variable reference |

---

## Local development

```bash
cp .env.example .env.local
# Set TESTNET_FAUCET_SECRET, SIGNER_PROXY_TOKEN from node bootstrap secrets
pnpm install   # not npm — keeps pnpm-lock.yaml in sync
pnpm dev
```

### Scripts

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build (copies Falcon WASM) |
| `pnpm type-check` | TypeScript validation |
| `pnpm verify:sign` | Falcon signing smoke test |

---

## Environment variables

See [.env.example](.env.example) for the full list. Key variables:

| Variable | Purpose |
|----------|---------|
| `XRPLD_RPC_URL` | Public node on port 6005 |
| `TESTNET_FAUCET_ACCOUNT` / `TESTNET_FAUCET_SECRET` | Falcon faucet (`falcon_secret` hex) |
| `SIGNER_PROXY_URL` / `SIGNER_PROXY_TOKEN` | Falcon signing proxy on node1 |
| `NEXT_PUBLIC_TESTNET_USDC_ISSUER` | F-USDC issuer (or auto from `testnet-stables.json`) |
| `NEXT_PUBLIC_SEPOLIA_LOCK_CONTRACT` | Sepolia bridge lock contract |
| `DATABASE_URL` | Neon Postgres connection string (message board) |
| Upstash Redis | Rate limiting (Vercel production) |

Use **`pnpm add`** for new dependencies — `npm install` will desync `pnpm-lock.yaml` and break CI.

---

## Deploy to Vercel

1. Import the repo in [Vercel](https://vercel.com).
2. Set **Package Manager** to `pnpm`.
3. Add environment variables (Production + Preview) — see `.env.example`.
4. Set `ALLOW_INSECURE_TRANSPORT=true` if the signer proxy is `http://`.
5. Deploy.

`next.config.mjs` sets `Permissions-Policy: camera=(self)` for the wallet QR scanner.

---

## Becoming a validator

Inside the **Wallet** tab:

1. Load your address (or create one).
2. Click the **node / server icon** in the action bar.
3. Confirm you have **1,000 FALCON** to bond.
4. Copy the one-liner (your wallet address is pre-filled as `--payout`).
5. Run on Ubuntu 22.04/24.04 with Docker.

Full instructions: [qXRP validator onboarding](https://github.com/beartec-jpg/qXRP/blob/develop/docs/validator-onboarding.md)

---

## Recent releases (July 2026)

- Permissionless lending (`LendingPermissionless`): collateral-only borrow, HF liquidation, multi-loan Positions
- Lend risk monitor + borrow/repay/claim/withdraw preflight APIs
- Passkey-secured Falcon wallet with client-side Falcon-512 signing
- F-USDC swap, limit orders, and AMM instant swap
- Sepolia USDC ↔ F-USDC bridge (passkey EVM wallet)
- Pool LP deposit/withdraw
- Wallet F-USDC P2P send + QR scanner
- Comprehensive E2E test documentation

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full feature timeline.