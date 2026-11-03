# NOTICE — Falcon wallet / faucet site (falcon-fpl.com)

Copyright (c) 2025-2026 BEARTEC. All rights reserved. See `LICENSE`.

Exception: `falcon-sign/` (Falcon Sign SDK) is licensed under Apache-2.0; see
`falcon-sign/LICENSE` and `falcon-sign/NOTICE`.

Original code in this repository was written by or for BEARTEC (including
AI-assisted commits made under the BEARTEC GitHub account `beartec-jpg`).

## Vendored third-party files (committed, kept under their own licences)
- `cold-signer/public/wasm/falcon-512.min.js` and
  `public/cold-signer/wasm/falcon-512.min.js`: Falcon-512 WebAssembly build
  of liboqs from `@openforge-sh/liboqs` (MIT, Copyright (c) 2025 openforge-sh;
  liboqs, MIT, Open Quantum Safe project).
- `public/cold-signer/assets/*`, `public/cold-signer/workbox-*.js`,
  `public/cold-signer/sw.js`: built bundle of `cold-signer/`, which includes
  the npm packages listed below (React MIT, Workbox MIT, etc.).

## Linked npm dependencies (production, from node_modules)
All permissive; no GPL/AGPL/LGPL/MPL in the production tree.

| Licence | Count | Notable |
|---|---|---|
| MIT | 112 | next, react, three, ethers, @noble/*, @scure/* |
| ISC | 21 | xrpl, ripple-address-codec, ripple-binary-codec, ripple-keypairs, @xrplf/* (XRPL Foundation) |
| Apache-2.0 | 9 | jsqr, @upstash/*, … |
| BSD-3-Clause | 3 | |
| 0BSD | 2 | tslib |
| Zlib | 1 | postprocessing |
| CC-BY-4.0 | 1 | caniuse-lite (data, build-time) |
| MIT* (inferred) | 1 | webgl-constants |

XRPL-derived parts: `src/lib/falcon-codec-definitions.ts` extends the
`ripple-binary-codec` definitions (ISC) at runtime via import; no upstream
source is copied into this repository.
