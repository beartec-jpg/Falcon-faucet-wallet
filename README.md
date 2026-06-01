# qXRP Web Portal

Official public portal for the qXRP testnet:

- Faucet (get testnet qXRP)
- Passkey-secured wallet (create, restore, send, receive)
- DEX marketplace
- Explorer (scan)
- **One-click "Run a Validator Node"** — generates the correct one-liner with your address pre-filled as `--payout`, plus the required 1,000 qXRP bond warning

The "Open Node" flow inside the Wallet is the recommended way for normal users to become bonded validators. It uses the modern `install-qxrp-validator.sh` (Docker + auto-bond after funding + reward claimer).

## Current Public Node (recommended)

> **Note for new testnet launch**: The values below are examples from a previous testnet. For the current clean testnet, use the values published in the official deployment docs or your own nodes.

- **Primary (full history)**: Use your deployed node(s)
- Network ID: 1001 (example for new clean testnet)
- Faucet uses a **dedicated funded account** (never the genesis/bootstrap account)

## Local Development

```bash
cp .env.example .env.local
# Edit XRPLD_RPC_URL if you want a different public node
npm install
npm run dev
```

## Environment Variables

See `.env.example` for the full list. The important ones:

- `XRPLD_RPC_URL` — must be a **public** node on port 6005 (never use admin ports from the internet)
- `FAUCET_ACCOUNT` / `FAUCET_SECRET` — funded account used to drip testnet qXRP
- Upstash Redis credentials for rate limiting (when deployed on Vercel)

## Deploy to Vercel

1. Import the repo in [Vercel](https://vercel.com).
2. In **Project Settings → General**, set **Package Manager** to `pnpm`.
3. Add these **Environment Variables** (Production + Preview):

   - `XRPLD_RPC_URL` → `http://46.224.0.140:6005`
   - `FAUCET_ACCOUNT` → `rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh`
   - `FAUCET_SECRET` → (your secret — **never commit this**)
   - `DRIP_AMOUNT_QXRP` → `100`
   - `NEXT_PUBLIC_NETWORK_ID` → `999`
   - `NEXT_PUBLIC_NETWORK_NAME` → `qXRP Testnet`
   - (Optional but recommended) Add Upstash Redis keys for production rate limiting:
     - `KV_REST_API_URL`
     - `KV_REST_API_TOKEN`

4. Deploy. The repo is configured to use pnpm + frozen lockfile.

## Notes

- Always use public RPC ports (6005). Admin ports (5005 etc.) are intentionally restricted.
- After node infrastructure changes, make sure the faucet account actually exists on the current ledger. Use a dedicated funded account (never the old genesis account).

## Becoming a Validator (Recommended Path)

Inside the **Wallet** tab:

1. Load your address (or create one).
2. Click the **node / server icon** button in the action bar.
3. You will see a prominent warning: **"You need 1,000 qXRP to bond."**
4. Copy the ready-to-paste one-liner (your wallet address is automatically used as `--payout`).
5. Run it on any Ubuntu 22.04/24.04 VPS with Docker.

The command:
- Starts the official Docker validator
- Generates keys
- Prints a **separate validator r-address** you must fund with ≥1,100 qXRP
- Automatically submits `ValidatorRegister` + `ValidatorBond(1000)` once funded
- Installs a reward claimer (claims land in the validator account)
- Remembers your payout address for future withdrawals

Full instructions: see the main qXRP repo → [docs/validator-onboarding.md](https://github.com/beartec-jpg/qXRP/blob/develop/docs/validator-onboarding.md)
