# qXRP Web Portal

Official public portal for the qXRP Falcon testnet (Network ID **1001**):

- Faucet (get testnet qXRP)
- Passkey-secured Falcon wallet (create, restore, send, receive)
- DEX marketplace
- Explorer (scan)
- **One-click "Run a Validator Node"** — generates the correct one-liner with your address pre-filled as `--payout`, plus the required 1,000 qXRP bond warning

## Current Public Node (recommended)

- **Primary (full history)**: `http://46.224.0.140:6005` (public port only)
- **Network ID**: `1001` (Falcon Ledger — post-quantum Falcon-512 accounts)
- **Faucet**: dedicated Falcon account funded from bootstrap supply

## Falcon Signing

User accounts and the faucet use **Falcon-512** keys. Browser-side `ripple-keypairs` cannot sign Falcon transactions. Signing is delegated to a small HTTP proxy on node1 (`SIGNER_PROXY_URL`) that calls the local admin RPC.

## Local Development

```bash
cp .env.example .env.local
# Set FAUCET_SECRET, SIGNER_PROXY_TOKEN from node1 bootstrap secrets
pnpm install
pnpm dev
```

## Environment Variables

See `.env.example` for the full list. The important ones:

- `XRPLD_RPC_URL` — public node on port 6005
- `FAUCET_ACCOUNT` / `FAUCET_SECRET` — Falcon faucet (`falcon_secret` hex, not a classical seed)
- `SIGNER_PROXY_URL` / `SIGNER_PROXY_TOKEN` — Falcon signing proxy on node1
- `NEXT_PUBLIC_NETWORK_ID` — `1001`
- Upstash Redis credentials for rate limiting (when deployed on Vercel)

## Deploy to Vercel

1. Import the repo in [Vercel](https://vercel.com).
2. Set **Package Manager** to `pnpm`.
3. Add environment variables (Production + Preview) — see `.env.example`.
4. Deploy.

## Notes

- Always use public RPC ports (6005). Admin ports (5005) stay on localhost via the signing proxy.
- Marketplace swaps require stablecoin issuers to be configured (`NEXT_PUBLIC_QUSDC_ISSUER`, etc.).
- Store your `falcon_secret` securely when creating a wallet — it cannot be recovered from a seed.

## Becoming a Validator (Recommended Path)

Inside the **Wallet** tab:

1. Load your address (or create one).
2. Click the **node / server icon** button in the action bar.
3. You will see a prominent warning: **"You need 1,000 qXRP to bond."**
4. Copy the ready-to-paste one-liner (your wallet address is automatically used as `--payout`).
5. Run it on any Ubuntu 22.04/24.04 VPS with Docker.

Full instructions: see the main qXRP repo → [docs/validator-onboarding.md](https://github.com/beartec-jpg/qXRP/blob/develop/docs/validator-onboarding.md)