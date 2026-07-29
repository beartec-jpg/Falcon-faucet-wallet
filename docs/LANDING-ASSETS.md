# Falcon Ledger — Assets to supply

This site is the **root landing page** for your `.com` (`/` → `index.html`).

All media paths already point at files under `assets/`. Labeled SVG placeholders ship with the repo so the page looks complete today. **Overwrite the same filenames** (or drop final PNG/WebP next to them and update the `src` in `index.html`).

When final assets are in, you can hide the small “Replace: …” badges by adding `class="assets-final"` on `<body>`.

---

## Priority 1 — Brand (required)

| File path | Purpose | Suggested format / size | Notes |
|-----------|---------|-------------------------|--------|
| `assets/images/brand/logo.svg` | Nav + footer wordmark | SVG preferred, or PNG @2x ~320×72 | Transparent, works on dark navy |
| `assets/images/brand/logo-mark.svg` | Icon-only mark (optional) | SVG, square 64–128px | Use if logo is too wide on mobile |
| `assets/images/brand/favicon.svg` | Browser tab icon | SVG or `favicon.ico` 32×32 | Also works as PNG |
| `assets/images/brand/apple-touch-icon.svg` | iOS home-screen | PNG **180×180** preferred | Replace SVG with real PNG when ready |
| `assets/images/brand/og-image.svg` | Social share (OG/Twitter) | PNG **1200×630** | Update meta tags in `index.html` if you switch to `.png` |

---

## Priority 2 — “What is Falcon?” icons (5)

Small icons in the intro grid. Style: simple line or soft filled, cyan/teal on dark, consistent stroke weight.

| File path | Card |
|-----------|------|
| `assets/images/icons/icon-quantum.svg` | Post-Quantum Secure |
| `assets/images/icons/icon-treasury.svg` | Protocol-Controlled Treasury |
| `assets/images/icons/icon-popl.svg` | Proof of Participation & Liquidity |
| `assets/images/icons/icon-validators.svg` | Validators Get Paid |
| `assets/images/icons/icon-liquidity.svg` | Liquidity Providers Get Paid |

**Suggested size:** 96×96 SVG (or PNG @2x 96–128px).  
**Do not** need photorealism — clean product icons.

---

## Priority 3 — “One Roof” platform icons (5)

Larger, more illustrative icons for the platform row.

| File path | Label |
|-----------|--------|
| `assets/images/platform/platform-wallet.svg` | Multichain Wallet |
| `assets/images/platform/platform-bridge.svg` | Permissionless Bridge |
| `assets/images/platform/platform-pools.svg` | Liquidity Pools |
| `assets/images/platform/platform-lending.svg` | Collateralized Lending |
| `assets/images/platform/platform-rewards.svg` | Participation & Arcade Rewards |

**Suggested size:** 160×160 SVG or PNG. Soft glow / geometric style matches the site.

---

## Priority 4 — Feature section illustrations (5)

Main visual for each alternating feature block. These are the highest-impact visuals after the logo.

| File path | Section | Suggested size |
|-----------|---------|----------------|
| `assets/images/features/feature-wallet.png` | Multichain Wallet | **720×520** (or 1440×1040 @2x) |
| `assets/images/features/feature-bridge.png` | Permissionless Bridge | same |
| `assets/images/features/feature-pools.png` | Liquidity Pools | same |
| `assets/images/features/feature-lending.png` | Lending & Borrowing | same |
| `assets/images/features/feature-earn.png` | Earn by Participating | same |

Placeholders currently use `.svg` with the same base names. When you add PNGs:

1. Add files under `assets/images/features/`
2. Change `src` in `index.html` from `.svg` → `.png` (or `.webp`)
3. Optionally delete the placeholder SVGs

**Content guidance (no real product screenshots required):**  
abstract UI mockups, dark glass cards, cyan accents — or stylized illustrations of wallet / bridge / pools. Avoid trademark-heavy chain logos unless licensed.

---

## Priority 5 — Optional extras

| File path | Purpose | Required? |
|-----------|---------|-----------|
| `assets/images/hero-visual.svg` (or `.png`) | Extra hero illustration under CTAs | Optional — hero already has canvas particles |
| `assets/images/why-pattern.svg` | Decorative texture for “Built Differently” | Optional |
| `assets/animations/*` | Lottie / short loop videos | **Not wired yet** — only if you want more than CSS/canvas motion |

### Animations already built-in (no files needed)

- Hero **network particles + geometric rings** (canvas, `js/main.js`)
- **Page-load** title → subtitle → buttons
- **Scroll-triggered** fade-up on sections/cards
- Button / card **hover** states
- Mobile nav open/close

### Animations you *could* add later (optional)

| Idea | Where | Format | Effort |
|------|--------|--------|--------|
| Soft particle loop video | Hero background behind canvas | MP4/WebM 10–15s muted loop | Low — add `<video>` if you want |
| Logo subtle entrance | Nav | CSS only | Already fine |
| Feature mock “live” UI | Feature blocks | Short Lottie or CSS | Medium |
| Confetti / arcade sparkle | Rewards card | Lottie JSON | Optional / playful |

**Recommendation:** ship with current CSS + canvas motion first. Only add Lottie/video if you want a signature hero moment.

---

## How to swap an asset (GitHub-friendly)

```bash
# Example: replace logo
cp ~/Downloads/falcon-logo.svg assets/images/brand/logo.svg

# Example: add feature screenshots as PNG
cp wallet-mock.png assets/images/features/feature-wallet.png
# then edit index.html: feature-wallet.svg → feature-wallet.png
```

Commit paths stay stable — overwriting in place is enough for SVG→SVG. For format changes, update the matching `src` / meta tags once.

---

## Deploy note: root `.com` vs faucet

| URL | Should show |
|-----|-------------|
| `https://yourdomain.com/` | **This landing page** (`index.html`) |
| `https://yourdomain.com/faucet/` (or subdomain) | Existing faucet app |

Move or re-route the faucet off `/` so it no longer owns the domain root. Typical options:

- Static host: put this folder as the site root; deploy faucet under `/faucet`
- Subdomain: `faucet.yourdomain.com`
- Reverse proxy: `/` → landing, `/faucet` → faucet service

See `README.md` for a minimal static deploy outline.
