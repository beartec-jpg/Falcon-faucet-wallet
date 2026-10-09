# Falcon Ledger Web Portal

Official web portal for **Falcon Ledger (FPL)**, a quantum-safe L1 focused on lending and AMM pools across chains. This is the **experimental Falcon Ledger testnet**: passkey wallet, faucet, explorer, AMM pools, lending, and non-custodial ETH, USDC and BTC bridges. Test tokens have no cash value.

**Live:** [falcon-ledger.com](https://falcon-ledger.com) · **Repo:** [Falcon-faucet-wallet](https://github.com/beartec-jpg/Falcon-faucet-wallet)

---

## Features

### Faucet
- Rate-limited testnet **FPL** drip (default 2,000 per request)
- Falcon Ledger named accounts, not classic `r…` XRPL addresses

### Wallet (passkey-secured)
- **Create** Falcon-512 wallets with WebAuthn passkeys — keys generated on-device
- **Restore** from saved `falcon_secret` or unlock an existing passkey-encrypted wallet
- **Send / receive FPL** — named Falcon Ledger accounts or QR
- **Send / receive FETH, F-USDC and FBTC** — bridged test assets
- **Recent transactions** — FPL and rail-asset labels
- **PWA** — installable progressive web app with offline shell

### Swap
- **Instant swap** on the F-USDC/FPL, FETH/FPL and FBTC/FPL AMM pools

### Bridges (Sepolia / Bitcoin testnet ↔ Falcon Ledger testnet)

Non-custodial bridges, working end to end on an experimental testnet; test assets only. Addresses: [docs/BRIDGES-2300.md](docs/BRIDGES-2300.md).

- **ETH / USDC (Sepolia) — FalconQcBridge:** `depositEth(bytes20)` / `depositUsdc` on `0xf8F1471643792eb1cD5d0C31061629777E55bc48`. No owner and no admin withdraw; withdrawals are released only by a Groth16 proof of Falcon quorum certificates. Groth16 verifier `0x9992cD8e45A2b7983E2b7f8fC725308a0E4845EC`. Peg-out: burn → Falcon-512 proofs → `openClaim` / `take`. `dest20 = sha256(lowercase PL account)[:20]`. Config: `public/config/pl-2300-bridge.json`.
- **Legacy DestLock (Kickoff only):** `0xdBF6855b00B78c047A729A21E13bfE5f4C991C05` — not the live peg-in.
- **BTC (Bitcoin testnet) — BitVM2:** even-Y NUMS pool `tb1pd6ltq2yu89h37zkwn9jsqcq0svf4pk2upnyf7sfw6rk2v59tkw8sfsdq34` (primary). Exit mode `BTC_EXIT_MODE=bitvm2`. `BTC_RAIL_LIVE = true`. Prior instance `tb1p2xuekx55w9llxe023y070lf32kk0z873nv6pse0awg75ll7l930suzcgn5` is historical.
- **Classic XRPL FXRP** — separate corridor; not the 1001 Falcon Ledger fork.
- **Passkey Sepolia wallet** — no MetaMask; EVM keys encrypted on-device.
- **Send Out** — move Sepolia ETH or USDC to any external `0x` address.
- **EVM backup** — encrypted export/import of Sepolia private key.

Do **not** send to old FalconCollateralLock `0x2dae31…` / `0x11808B…` (`public/config/usdc-bridge.json` is the retired 1001 lock, kept for FXRP notes only).

### Pool
- **Add / withdraw liquidity** on the F-USDC/FPL, FETH/FPL and FBTC/FPL AMM pools
- Earn an LP share of epoch rewards; live pool stats and LP share %

### Lend
- **Markets** — F-USDC, FETH and FBTC lending markets on testnet
- **Supply / Borrow / Repay** — supply to a market, borrow against FPL collateral, repay, all settled on chain
- **Positions** — on-chain collateral and health factor

### Explorer
- Ledger and transaction lookup by hash or address

### Rewards / Validator
- Register, bond (1,000 FPL), unbond, and **ClaimReward** from the portal
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
| **FPL** | Native Falcon Ledger asset | Wallet, Swap, Pool, DEX |
| **F-USDC / FETH** | Bridged Sepolia USDC / ETH (testnet) | Wallet, Bridge |
| **FBTC** | Bridged Bitcoin testnet BTC (`BTC_RAIL_LIVE`) | Wallet, Bridge |
| **Sepolia USDC** | Circle ERC-20 on Ethereum Sepolia | Multi-chain / Bridge |
| **FXRP** | Classic XRPL XRP corridor | Bridge (not 1001) |

F-USDC and Sepolia USDC are **not** the same token — the bridge converts between them.

---

## Network

| Item | Value |
|------|-------|
| Name | Falcon Ledger testnet (experimental) |
| Product | Falcon Consensus · Falcon-512 (`product_version` 2.9.60) |
| Validators | 7 bonded seats |
| Epoch | 7 days; first claimable epoch **1** on testnet |
| Min validator bond | 1,000 FPL |
| Bridges | Non-custodial ETH/USDC (Groth16 Falcon-QC) + BTC (BitVM2) — [docs/BRIDGES-2300.md](docs/BRIDGES-2300.md) |

Network **1001** (Falcon Ledger / XRPL fork) is shut down. Do not use `:6005`, `r…` issuers, or `FalconCollateralLock`. Admin is a unix `--admin-sock`, not a public TCP admin port.

---

## Falcon signing

User accounts and the faucet use **Falcon-512** keys. There is no classical signing path for Falcon Ledger testnet txs.

- **Browser:** Client-side signing via `@openforge-sh/liboqs` WASM
- Store your `falcon_secret` when creating a wallet — it cannot be derived from a passkey afterwards.

---

## Documentation

Current docs: [docs/README.md](docs/README.md).

| Doc | Description |
|-----|-------------|
| [docs/BRIDGES-2300.md](docs/BRIDGES-2300.md) | ETH / USDC / BTC bridges (current) |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Shipped features and mainnet plan |
| [docs/archive-1001/README.md](docs/archive-1001/README.md) | Historical 1001 PDFs (retired network) |
| [public/config/pl-2300-bridge.json](public/config/pl-2300-bridge.json) | Live Sepolia bridge manifest |
| [public/config/usdc-bridge.json](public/config/usdc-bridge.json) | Retired 1001 lock + FXRP notes only |
| [docs/sql/board-schema.sql](docs/sql/board-schema.sql) | Neon SQL schema for the message board |
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

Public validator nodes are coming next. Today the testnet runs on seven bonded validator seats; see [falcon-ledger.com/validator](https://falcon-ledger.com/validator) for how bonding and joining work.

---

## Recent releases

- **Oct 2026:** seven-seat validator set; Release A (2.9.60: Sepolia Gloas light-client fix, 7-day ETH header window); non-custodial ETH/USDC (Groth16 Falcon-QC) and BTC (BitVM2) bridges working end to end; AMM pools (F-USDC/FPL, FETH/FPL, FBTC/FPL) and lending on testnet
- **Aug 2026:** ETH/USDC Groth16 Falcon-QC bridge e2e on Sepolia; BTC rail on Bitcoin testnet (`BTC_RAIL_LIVE`); named FPL accounts
- July 2026 (1001, archived): permissionless lending, passkey wallet, lock-mint USDC bridge — see [docs/archive-1001/README.md](docs/archive-1001/README.md)

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full feature timeline.