# Falcon Vault + Cold Signer — Implementation Report

**Date:** 2026-07-28 (updated after two-device offline field test)  
**Repo:** `Falcon-faucet-wallet` (`main`)  
**Scope:** Air-gapped vault custody on Falcon Ledger (hot portal + cold PWA)  
**Status:** Single-device (copy/paste) **and** two-device live barcode / offline cold path **tested and working**.

---

## 1. Summary

A separate **Vault** surface was added to the Falcon portal so user keys can live on an offline cold device while the online browser only holds **public** vault metadata. Signing uses multi-part QR (or copy/paste of the same protocol JSON for one-device testing). Hot wallet create/send/restore was left unchanged.

| Component | Path / URL |
|-----------|------------|
| Hot vault UI | `/vault` (entry from Wallet → **Vault**) |
| Cold signer PWA | `/cold-signer/` (static build under `public/cold-signer/`) |
| Source cold app | `cold-signer/` (Vite + PWA) |

---

## 2. Goals and non-goals

### Goals (met)

- Keep existing hot wallet infrastructure as-is  
- Vault secret never stored on hot after create (encrypted export file only)  
- Cold device: password (default) or passkey local unlock  
- Multi-part QR transport for large Falcon payloads  
- One-device testing via **Copy full payload** / **Paste payload**  
- Payment (FALCON + F-USDC), named destinations, F-USDC TrustSet via cold sign  
- Last-known FALCON + F-USDC balances on cold after vault unlock with hot  

### Non-goals (this phase)

- Shamir secret sharing  
- Cold-sign for swap / AMM / lend / bridge / names / rewards  
- Replacing hot wallet with vault-only  
- Crypto/qBTC cold-signer port (reference only)  

---

## 3. Architecture

```
┌──────────────────────────── Hot portal (online) ────────────────────────────┐
│  Hot wallet (unchanged)     │  /vault                                         │
│                             │  • public VaultPublicRecord (IndexedDB)         │
│                             │  • create → download falcon-vault-export JSON   │
│                             │  • unlock session (challenge → cold response)   │
│                             │  • build unsigned Payment / TrustSet            │
│                             │  • submit tx_blob only                          │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │ multi-QR or copy/paste protocol JSON
┌─────────────────────────────▼───────────────────────────────────────────────┐
│  Cold signer PWA (/cold-signer/)                                             │
│  • install required before vault import                                      │
│  • secret under password or passkey (device unlock)                          │
│  • last-known balances (from hot unlock snapshot)                            │
│  • sign Payment / TrustSet offline (airplane recommended for spend)            │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Custody model

| Layer | Holds secrets? | Role |
|-------|----------------|------|
| Hot `/vault` | **No** (after create) | Public address, build/submit, session unlock |
| Encrypted vault file | Yes (passphrase) | Offline backup / cold import (`falcon-vault-export`) |
| Cold device | Yes (re-encrypted under cold password/passkey) | Sign; never talks to chain for secrets |

### Protocol (v1)

Shared types in `src/lib/vault-protocol.ts` + multi-part framing in `src/lib/multi-qr.ts`.

| Direction | Content type | Payload |
|-----------|--------------|---------|
| Hot → cold | `vault-unlock-chal` | Challenge + optional on-chain snapshot (FALCON + F-USDC) |
| Cold → hot | `vault-unlock-resp` | Falcon-signed challenge proof |
| Hot → cold | `unsigned-tx` | Payment or TrustSet `tx_json` + human display |
| Cold → hot | `signed-tx` | `tx_blob` |

One-device testing uses the same JSON bodies via **Copy full payload** / **Paste payload** (no barcode required).

---

## 4. Feature checklist (implemented)

### 4.1 Hot portal (`/vault`)

- [x] Separate vault page + Wallet **Vault** entry  
- [x] Create vault → generate Falcon-512 keys → passphrase-encrypted export download  
- [x] Hot keeps public record only (`vault-store`)  
- [x] Import public metadata from existing vault file  
- [x] Locked: Receive + Unlock vault  
- [x] Unlock: live account fetch → multi-QR challenge (includes FALCON + F-USDC snapshot)  
- [x] Unlock response verify (`vault-unlock-verify` + Falcon WASM verify)  
- [x] Time-boxed session (`vault-session`, ~10 min)  
- [x] Send FALCON / F-USDC with cold sign  
- [x] Named destinations (`alice.bob` via `/api/wallet/name`)  
- [x] **Add F-USDC trust line (cold sign)** when no trust line  
- [x] Multi-QR display with **Copy full payload**  
- [x] Multi-QR scanner with **Paste payload**  

### 4.2 Cold signer (`/cold-signer/`)

- [x] PWA install first (real PNG icons; SW ready before install prompt)  
- [x] Online allowed until vault imported; ops banners for online after load  
- [x] Vault import via **file upload only** (password recommended; passkey optional/hardened)  
- [x] Device unlock (password / passkey) → read-only last-known balances  
- [x] Unlock vault (hot challenge): camera + **Paste payload** button on same screen  
- [x] Sign transaction: camera + **Paste payload**; preview Payment or TrustSet  
- [x] Copy signed / unlock-response payloads for one-device handoff  
- [x] Cache last-known FALCON + F-USDC from unlock challenge snapshot  

### 4.3 Infra / CI fixes along the way

- [x] `pnpm-lock.yaml` synced for `qrcode` (Vercel frozen lockfile)  
- [x] Exclude `cold-signer/` from Next.js `tsconfig` (`import.meta.env`)  
- [x] Fixed invalid base64-as-PNG icons that blocked install  
- [x] Fixed camera flash-and-close (online handler unmounting scan UI)  

---

## 5. User flows

### 5.1 Create + load cold (first time)

1. Hot: `/vault` → Create vault → set export password → download JSON → ack → public record saved  
2. Cold phone: open `/cold-signer/` online → **Install app** → open from home screen  
3. Cold: import vault **file** → set **Password (recommended)** cold unlock  
4. Move export file to offline media (SD) as recovery; do not re-import secret to hot  

### 5.2 Unlock portal session (hot needs cold)

1. Hot: Unlock vault (fetches live balances into challenge)  
2. Cold: device unlock → **1. Unlock vault** → scan **or Paste payload**  
3. Cold: **Copy full payload** response  
4. Hot: paste/scan response → session open (Send / live balances)  

### 5.3 Send FALCON or F-USDC

1. Hot vault unlocked → Send → asset toggle → dest (r… or name) → amount  
2. Prepare → cold **2. Sign** → preview → approve  
3. Hot paste/scan signed blob → submit  

### 5.4 Add F-USDC trust line

1. Hot vault unlocked, funded, **No trust line** on F-USDC  
2. **Add F-USDC trust line (cold sign)**  
3. Cold sign TrustSet (issuer + limit shown on preview)  
4. Hot submit → refresh → F-USDC ready  

---

## 6. Testing status

### 6.1 Single-device (copy/paste) — **PASS**

Tested end-to-end on one device using **Copy full payload** / **Paste payload** (and file import for vault). Confirmed working:

| Area | Result |
|------|--------|
| Vault create + encrypted file download | Pass |
| Cold PWA install + file import + password unlock | Pass |
| Unlock challenge / response payloads | Pass |
| Hot session after cold unlock | Pass |
| Send FALCON (cold sign + submit) | Pass |
| Send F-USDC (when trust line present) | Pass |
| Named destination resolution | Pass |
| Receive (address QR / copy) | Pass |
| TrustSet for F-USDC trust line | Pass |
| Last-known FALCON + F-USDC on cold after unlock | Pass |
| Multi-part payload reassembly via paste | Pass |

**Note:** Passkey import may still fail on some Android Credential Manager builds; password path is the recommended cold unlock method.

### 6.2 Two-device live barcodes — **PENDING**

Not yet fully field-tested. Checklist for the remaining test:

#### Devices

- **Hot:** online browser (desktop or phone A) at production `/vault`  
- **Cold:** installed PWA on phone B, preferably airplane mode after import for signing  

#### Barcode tests

| # | Scenario | Steps | Pass? |
|---|----------|-------|-------|
| B1 | Unlock multi-QR | Hot shows challenge animation; cold camera reassembles all frames; cold shows response animation; hot camera reassembles | ☐ |
| B2 | Payment FALCON multi-QR | Hot unsigned animation → cold scan → cold signed animation → hot scan → submit | ☐ |
| B3 | Payment F-USDC multi-QR | Same as B2 with F-USDC asset | ☐ |
| B4 | TrustSet multi-QR | Hot “Add F-USDC trust line” → cold TrustSet preview → signed → hot submit | ☐ |
| B5 | Frame loss / CRC | Partial scan then full rescan; confirm CRC error recovery | ☐ |
| B6 | Low light / distance | Real-world camera conditions | ☐ |
| B7 | Sequence expiry | Delay sign past LastLedgerSequence; confirm rebuild UX | ☐ |

#### Environment notes to record when testing

- Browser/OS on hot and cold  
- Network (testnet) and portal deploy commit  
- Approximate frame count for unlock vs Payment vs TrustSet  
- Any install / camera permission issues  

---

## 7. Security notes

| Control | Behavior |
|---------|----------|
| Hot secret after create | Not stored; only public vault record |
| Cold import | Installed PWA only (standalone); file upload |
| Device unlock | Password or passkey; shows last-known balances only |
| Spend / TrustSet sign | Prefer offline; payment sign still asserts airplane mode where enforced |
| Unlock challenge | Snapshot is display-only (not in signed challenge bytes) |
| User review | Cold always shows human fields before approve |

**Still user-dependent:** verifying dest/amount/issuer on cold; physical security of cold device + password; recovery file on offline media.

---

## 8. Key files

| Area | Path |
|------|------|
| Vault UI | `src/app/vault/page.tsx` |
| Multi-QR | `src/lib/multi-qr.ts`, `src/components/MultiQrDisplay.tsx`, `MultiQrScanner.tsx` |
| Protocol | `src/lib/vault-protocol.ts` |
| Vault export / store / session | `src/lib/vault-export.ts`, `vault-store.ts`, `vault-session.ts` |
| Unlock verify | `src/lib/vault-unlock-verify.ts` |
| Build unsigned txs | `src/lib/falcon-tx-sign.ts` (`buildPaymentTxJson`, `buildFusdcPaymentTxJson`, `buildTrustSetTxJson`, `signTxJson`) |
| Cold app | `cold-signer/src/App.tsx`, `cold-signer/src/components/MultiQr.tsx` |
| Cold storage | `cold-signer/src/lib/coldVaultDb.ts` |
| Shipped PWA | `public/cold-signer/` |

### Scripts

```bash
npm run dev:cold       # cold PWA dev server
npm run build:cold     # build + copy to public/cold-signer
npm run verify:multi-qr
```

---

## 9. Remaining work

1. **Complete §6.2** two-device live barcode matrix; tick boxes and note any failures  
2. Optional: passkey reliability on more Android devices  
3. Optional: cold-sign for more tx types (TrustSet for other IOUs, OfferCreate, etc.)  
4. Optional: automatic install package zip (vault file + cold dist) for USB path  

---

## 10. Conclusion

The vault + cold-signer system is **feature-complete for the Payment / TrustSet MVP** and **validated on single-device copy/paste**. Live **two-device barcode** testing is the last validation step before calling the camera path production-ready under field conditions.

**Latest related commits (selection):**  
`3b04f07` … `3e32565` (vault feature through TrustSet cold sign).

---

*Report maintained in-repo. Update §6.2 when two-device barcode testing is finished.*
