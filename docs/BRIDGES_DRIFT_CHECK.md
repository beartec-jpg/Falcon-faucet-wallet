# Bridges drift check

**Rule:** public faucet docs + live bridge JSON must match Falcon-PL `BRIDGES_2300_STATUS.md` (product **2.9.43**), or explicitly document a verified intentional interim.

| Item | STATUS SoT | Public live |
|------|------------|-------------|
| Product version | 2.9.43 | docs + README must say 2.9.43 |
| ETH/USDC bridge | FalconQcBridge `0xf8F1471643792eb1cD5d0C31061629777E55bc48` | `pl-2300-bridge.json` `sepolia.bridge` + `pl-dest-lock.ts` fallback |
| Groth16 verifier | `0x9992cD8e45A2b7983E2b7f8fC725308a0E4845EC` | `sepolia.verifier` |
| USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | `sepolia.usdc_token` |
| BTC peg-in | even-Y `tb1pd6ltq2yu89h37zkwn9jsqcq0svf4pk2upnyf7sfw6rk2v59tkw8sfsdq34` | `btc-spv-bridge.json` `watch_address` + `BITVM2_INSTANCE_ADDRESS` |
| BTC peg-out | `BTC_EXIT_MODE=bitvm2` A1 operator-fronting — **not** custodialess | docs + landing copy must not say custodialess for live exits |
| FalconDestLock | legacy Kickoff only | `legacy_destlock` — never marketed as live peg-in |

Historical configs (`feth-bridge.json`, `usdc-bridge.json`, archive-1001) stay shipped but labeled **historical**.
