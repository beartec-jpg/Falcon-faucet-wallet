# Falcon Ledger roadmap

**Network:** experimental Falcon Ledger testnet (test tokens, no cash value)

Falcon Ledger is a quantum-safe L1 focused on lending and AMM pools across chains. Ticker **FPL**.

Bridge addresses: [BRIDGES-2300.md](./BRIDGES-2300.md). Protocol paper: in-app [whitepaper](https://falcon-ledger.com/whitepaper).

## Done (on testnet)
- [x] Falcon Consensus with Falcon-512 signatures from genesis
- [x] Seven bonded validator seats
- [x] Passkey wallet, faucet and explorer
- [x] AMM pools: F-USDC/FPL, FETH/FPL, FBTC/FPL
- [x] Lending markets for F-USDC, FETH and FBTC (supply, borrow against FPL collateral, repay)
- [x] PoPL epoch rewards for validators, watchers, AMM LPs and lending LPs
- [x] Non-custodial ETH and USDC bridge (Ethereum Sepolia): withdrawals released only by a Groth16 proof of Falcon quorum certificates; no owner and no admin withdraw
- [x] Non-custodial BTC bridge (Bitcoin testnet) on BitVM2
- [x] Release A (2.9.60): Sepolia Gloas light-client fix and 7-day ETH header window

## Next (no dates yet)
- [ ] Public validator nodes
- [ ] External security audit before mainnet (whitepaper §12)
- [ ] Mainnet: published ceremony, freeze pin, genesis validator set, network config and RPC endpoints
- [ ] Portal: PRF-only passkey mode; mainnet go-live toggle

## Later / ideas
- [ ] Hardware wallet integration
- [ ] Governance proposal UI
- [ ] Native mobile app (PWA is live)

## History
The current Falcon Ledger testnet replaced the retired network 1001 (the earlier XRPL-fork implementation), which is shut down. Archive: [archive-1001/README.md](archive-1001/README.md).
