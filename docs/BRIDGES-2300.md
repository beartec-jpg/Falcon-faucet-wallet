# Falcon faucet wallet — 2300 bridges

**Product version 2.9.36.** Testnet.

| Rail | In | Out |
|------|----|-----|
| ETH Sepolia → FETH | `depositEth(dest20)` then mint | burn → dest-lock Kickoff (no n-of-n) → CSV=6 dest take |
| USDC Sepolia → F-USDC | `depositUsdc` then mint | same |
| BTC testnet → FBTC | pay BitVM2 instance + FALC memo; mint after 1 conf | burn → dest-lock Kickoff (no FROST) → CSV=6 take |

`dest20 = sha256(lowercase PL account)[:20]`

| | |
|--|--|
| FalconDestLock | `0xdBF6855b00B78c047A729A21E13bfE5f4C991C05` |
| Sepolia USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| BTC instance | `tb1p2xuekx55w9llxe023y070lf32kk0z873nv6pse0awg75ll7l930suzcgn5` |

Config: `public/config/pl-2300-bridge.json` (live). `BTC_RAIL_LIVE = true` in `src/lib/pl-btc-rail.ts`.

Protocol status: Falcon-PL `falcon-pl-rs/crates/fd-pl/docs/BRIDGES_2300_STATUS.md`.
