# Falcon faucet wallet — 2300 bridges

**Product version 2.9.36.** Testnet.

| Rail | In | Out |
|------|----|-----|
| ETH Sepolia → FETH | `depositEth(dest20)` then mint | burn → header proof → `openClaim` / `take` to your 0x |
| USDC Sepolia → F-USDC | `depositUsdc` then mint | same |
| BTC testnet → FBTC | pay vault + FALC memo; mint after 6 confs | burn → Kickoff dest-lock → CSV=6 take |

`dest20 = sha256(lowercase PL account)[:20]`

| | |
|--|--|
| FalconBridge | `0x7eB72974F2d2a4AaDFabAf0975a29470fcd163E4` |
| Groth16Verifier | `0x7db9b1862AE7D04cE9ff85447390bDdfa972a9d0` |
| Sepolia USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| BTC vault | `tb1pj9d6d6eaayw7f7hc3mr2lm3xhuscuhtw6kpjqz5jvvuf4mh2lduq2pqytm` |

Config: `public/config/pl-2300-bridge.json` (live). `BTC_RAIL_LIVE = true` in `src/lib/pl-btc-rail.ts`.

Protocol status: Falcon-PL `falcon-pl-rs/crates/fd-pl/docs/BRIDGES_2300_STATUS.md`.
