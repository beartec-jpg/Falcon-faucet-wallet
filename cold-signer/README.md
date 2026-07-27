# Falcon Cold Signer

Air-gapped PWA for Falcon Ledger vault keys. Signs Payments offline via multi-part QR with the portal **Vault** page.

## Security rules

| State | Allowed? |
|-------|----------|
| Browser tab (not installed) | Install only — **no vault import** |
| Installed PWA, no vault | Online OK — import vault file |
| Installed PWA, vault loaded | Offline required for unlock/sign |

**First screen (no vault):** big **Install app** button (or iOS Share → Add to Home Screen). Import UI only after opening from the home-screen icon (`display-mode: standalone`).

Dev-only overrides (never ship to users):  
- `localStorage.setItem('falcon-cold-allow-online', '1')` — unlock online  
- `localStorage.setItem('falcon-cold-allow-browser', '1')` — import in a normal tab

---

## Two ways to get the PWA onto an offline phone

### Path A — One-time online, then airplane (simplest)

1. On the dedicated phone (factory-reset preferred, no SIM):
   - Connect Wi‑Fi temporarily.
   - Open `https://<your-portal>/cold-signer/`
   - **Add to Home Screen** / Install (PWA).
   - Wait until assets are cached (open the app once so the service worker finishes).
2. Turn on **airplane mode** (Wi‑Fi + mobile data off).
3. Open Cold Signer from the home screen — badge must say **Offline**.
4. Import the encrypted vault JSON from SD/USB.
5. Keep this phone offline forever. Do not reconnect.

### Path B — USB / SD package (never need portal on the cold phone)

1. On a trusted computer, build the cold signer:

   ```bash
   cd cold-signer
   npm install
   npm run build
   ```

2. Copy `cold-signer/dist/` **plus** your `falcon-vault-….json` onto an SD card or USB stick.
3. On the offline phone (already offline), open the static files if the OS allows local web apps, or host the `dist/` folder from a **local-only** machine on a one-time LAN (then airplane again). Prefer Path A if local static hosting is awkward on mobile.
4. Import the vault JSON from the same media.
5. Store a second copy of the vault JSON in a safe offline place (recovery).

Path A is recommended for Android/iOS. Path B is for air-gap purists with a controlled offline transfer.

---

## Pair with hot portal Vault

| Hot (`/vault`) | Cold (this app) |
|----------------|-----------------|
| Create vault → download encrypted JSON | Import JSON offline |
| Keep **public** address only | Holds secret under cold password |
| Locked: Receive + Unlock | Action list: Unlock vault / Sign tx |
| Unlock: show challenge multi-QR | Scan challenge → show response multi-QR |
| Send: show unsigned Payment multi-QR | Scan → preview → sign → show signed multi-QR |
| Submit `tx_blob` | Never talks to network |

---

## Dev

```bash
# From Falcon-faucet-wallet root (needs parent node_modules / wasm)
cd cold-signer
npm install
npm run dev   # http://localhost:3001/cold-signer/
```

Production package into portal static files:

```bash
npm run build
# copy dist → ../public/cold-signer/
```

Root helper scripts (portal `package.json`):

- `npm run dev:cold`
- `npm run build:cold`

---

## Cold unlock methods

On import, choose:

- **Passkey** (recommended) — platform authenticator + PRF when available
- **Password** — PBKDF2 + AES-GCM local password

## What this does **not** do yet

- Non-Payment tx types (swap, lend, bridge, …)
- Automatic USB “package” zip builder on the portal create-vault step (manual download is enough for MVP)
- Hardware security keys beyond platform passkeys
