# Falcon faucet wallet — 2300 bridges

**Product version 2.9.43.** Testnet. Auditable, not audited.

Aligned to Falcon-PL STATUS SoT: `docs/BRIDGES_2300_STATUS.md` (read-only copy on brain: `local-coder/docs-sot/BRIDGES_2300_STATUS.md`).

| Rail | In | Out |
|------|----|-----|
| ETH Sepolia → FETH | `depositEth(dest20)` on FalconQcBridge, then mint | burn → 4× OPEN=1 Groth16 Falcon-512 proofs → `openClaim` / `take` |
| USDC Sepolia → F-USDC | `depositUsdc` on FalconQcBridge, then mint | same |
| BTC testnet → FBTC | pay even-Y NUMS P2TR pool + FALC memo; mint after confs | burn → **BitVM2 A1 operator-fronting** (`BTC_EXIT_MODE=bitvm2`). **Not** Bitcoin Disprove. **Not** custodialess. |

`dest20 = sha256(lowercase PL account)[:20]`

| | |
|--|--|
| FalconQcBridge | `0xf8F1471643792eb1cD5d0C31061629777E55bc48` |
| Groth16Verifier | `0x9992cD8e45A2b7983E2b7f8fC725308a0E4845EC` |
| Sepolia USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| falconKeyRoot | `0x04a9ad1908569884ff307f63291c592af16fe345fb471c22104d0c0717bcfd8a` |
| BTC pool (even-Y, primary) | `tb1pd6ltq2yu89h37zkwn9jsqcq0svf4pk2upnyf7sfw6rk2v59tkw8sfsdq34` |
| FalconDestLock (legacy Kickoff only) | `0xdBF6855b00B78c047A729A21E13bfE5f4C991C05` |
| FalconQcBridgeV2 (interim, not STATUS live) | `0x811854827627024B38926Ea9DCc0f88ACd5fB23e` |
| BTC prior BitVM2 instance (historical) | `tb1pd6ltq2yu89h37zkwn9jsqcq0svf4pk2upnyf7sfw6rk2v59tkw8sfsdq34` |

**BTC trust:** live exits are operator-fronting inventory pays. Do not market live 2300 BTC exits as custodialess BitVM2.

Config: `public/config/pl-2300-bridge.json` (live). BTC: `public/config/btc-spv-bridge.json`. `BTC_RAIL_LIVE = true` in `src/lib/pl-btc-rail.ts`.

Protocol SoT: Falcon-PL `falcon-pl-rs/crates/fd-pl/docs/BRIDGES_2300_STATUS.md`.
Public drift check: [BRIDGES_DRIFT_CHECK.md](BRIDGES_DRIFT_CHECK.md).
