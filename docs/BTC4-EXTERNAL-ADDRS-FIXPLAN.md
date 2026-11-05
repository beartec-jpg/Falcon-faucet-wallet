# BTC4 / external_addrs fix plan (2026-11-05)

Scott: every Falcon wallet should have a BTC4 (Testnet4) receive address available
for faucet / name-resolved native BTC sends / bridge. Investigation notes.

## Product meaning

**"BTC4 wallet on every Falcon wallet" means (a) + UI awareness of (b):**

1. **Linked Testnet4 BTC receive address** (`external_addrs.btc` / Multi-chain
   `btcAddress`, typically P2PKH `m…`/`n…` today) — required for faucet-by-name
   and Multi-chain send-to-name.
2. **On-ledger BTC4 asset balance** (FBTC) — already shown; scott.reynolds.123
   has BTC4 ≈ 1,099,334 sats. This is *not* the gap that blocked the send.

## Current gap

1. **On-chain `Account.external_addrs` is empty for every checked account**
   (scott.reynolds.123, dave, sally, alice, mmtreasury01, nodesafe, …) even
   though tip ≈ 810,159 on product 2.10.4 and `SetExternalAddrs` activated at
   height 755,000. Nobody has ever successfully published on-chain links.
2. **Off-chain walletd name store already has BTC for some names** (e.g.
   scott.reynolds.123 → `miqBrMMrH3nz2cfHLj14ySukPGBJ5GwBpn`) via
   `name-set-addrs`, but portal **never submits** `SetExternalAddrs` after
   provisioning. Signer helper existed with **wrong serde kind**
   (`SetExternalAddr` PascalCase) — node expects `set_external_addrs`.
3. **Repo `pl-walletd.py` lags live falcon1** (live has `name-set-addrs` since
   2026-10-25; Falcon-PL checkout does not) — risk of silent regression on
   next walletd deploy from git.

## How an address is obtained today

| Step | What happens |
|------|----------------|
| Wallet create | Client generates Falcon + EVM + **BTC P2PKH testnet** + XRPL keys |
| Dashboard | Auto-provisions missing BTC via passkey if older wallet |
| Sync | `POST /api/wallet/name` `set-addrs` → walletd `name-set-addrs` (off-chain JSON) |
| On-chain | **Not wired** (and signer kind was wrong) |
| Faucet / send-by-name | Prefer on-chain `external_addrs.btc`, else walletd name-status |

## Recommended fix path (smallest → complete)

### A. Falcon-faucet-wallet (primary)

1. Fix `signPlSetExternalAddr` kind → `set_external_addrs` (draft on this branch).
2. After Multi-chain BTC exists + account has a sequence, **publish on-chain**
   with passkey (helper `publishExternalAddrsOnChain`). Prefer:
   - one-shot button on Multi-chain / Falcon face: “Link BTC on Falcon PL”
   - and/or auto after name activate / first unlock when on-chain empty.
3. Keep walletd `name-set-addrs` sync (fast path for faucet while mempool seals).
4. Optional UI copy: distinguish “Testnet4 BTC receive” vs “FBTC / BTC4 on PL”.

### B. Falcon-PL / walletd

1. Land live `name-set-addrs` + activate-with-externalAddrs into
   `crates/fd-pl/scripts/pl-walletd.py` so git matches falcon1.
2. No ledger change required — feature already live.

### C. Backfill existing accounts

- **Browser wallets**: owner opens wallet → Link on-chain (needs their Falcon secret).
- **Script/treasury names without Multi-chain keys** (e.g. mmtreasury01): either
  generate+store BTC keys in an operator process Scott owns, or leave
  faucet/sends requiring a pasted `tb1`/`m`/`n` address.
- Do **not** forge SetExternalAddrs for accounts we do not hold keys for.

## Scott decisions

1. Approve faucet-wallet PR for signer fix + on-chain publish UX?
2. Auto-publish on first dashboard unlock, or explicit button only?
3. Also link eth/bnb/xrp on-chain in the same pass, or BTC-only for now?
4. Backfill mmtreasury01 / dave / sally (no name-store BTC) — generate keys, or skip?
5. Merge Falcon-PL walletd sync PR separately?

## Explicit non-actions this investigation

- No funds sent, no PR opened, no Tailscale restart, no merge.
