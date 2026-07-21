# Falcon portal + fleet hardening checklist

Companion to the security hardening work. **Repos are public; secrets and open ports are not.**

## Phase 0 — Vercel Production env (do now)

| Variable | Value |
|----------|--------|
| `NEXT_PUBLIC_ARCADE_URL` | `https://falcon-arcade-lake.vercel.app` |
| `ALLOWED_ORIGINS` | `https://falcon-ledger.com` (+ preview hosts if needed) |
| `TESTNET_FAUCET_UNLIMITED` | `false` (or unset — default is limited) |
| `ALLOW_INSECURE_TRANSPORT` | unset or `false` |
| `ENABLE_LEGACY_SIGN` | unset / false |
| `ENABLE_SERVER_DERIVE` | unset / false |
| `CRON_SECRET` | `openssl rand -hex 32` + Vercel Cron Bearer header |
| `LEND_HF_MONITOR_TOKEN` | `openssl rand -hex 32` for HF monitor daemon |
| `ALLOWED_DASHBOARD_HOSTS` | comma hosts if using node dashboard proxy |

**Arcade project:**

| Variable | Value |
|----------|--------|
| `VITE_PARENT_ORIGINS` | `https://falcon-ledger.com` |
| `VITE_PORTAL_API_URL` | `https://falcon-ledger.com` |

Redeploy after changing any `NEXT_PUBLIC_*` / `VITE_*`.

## Code safeguards shipped

- `POST /api/wallet/propose` → **410** (no secret mint)
- `POST /api/wallet/derive` → **410** in prod unless `ENABLE_SERVER_DERIVE=true`
- LoanManage → daemon token only (no browser origin)
- Cron → requires `CRON_SECRET` in production
- Faucet unlimited → opt-in only
- Game claim → **server best score only**; reserve-before-pay; IP + global caps
- RPC `serverRpcCall` → HTTPS required in production
- Cosign → field allow-list
- Airdrop admin → timing-safe Bearer
- Node dashboard → allow-list required in production
- CSP production → no localhost arcade origins

## Node firewall (validators)

```
ALLOW:  51235/tcp          # peer
ALLOW:  22/tcp from admin  # SSH
DENY:   5005, 3001, 8080, 3000, 9090, 9093
```

**Full-history / API:** also public RPC (`6005` or `443→RPC`).  
**Signer:** TLS reverse-proxy only; never world-open raw `:3001`.

## Still open / follow-ups

1. Wallet ownership challenge (sign-to-claim) — planned, not in this pass  
2. Arcade play session + pts/sec anti-script — planned  
3. Installer scripts: stop publishing host `5005`  
4. Enable GitHub secret scanning + push protection  

## Rotate if compromised

1. `SIGNER_PROXY_TOKEN`  
2. `TESTNET_FAUCET_SECRET` / fund new faucet  
3. `LEND_HF_MONITOR_TOKEN`, `AIRDROP_ADMIN_TOKEN`, `CRON_SECRET`  
4. Neon `DATABASE_URL` if leaked  
5. SSH keys on fleet  
