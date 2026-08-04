# SPV FBTC MPT pool (FALCON / FBTC)

Portal `/pool` and `/swap` prefer **live SPV FBTC** (`BtcBridgeState.MPTokenIssuanceID`) over the legacy IOU FBTC in `testnet-stables.json`.

## Current fleet (as of portal wiring)

| Item | Status |
|------|--------|
| SPV MPT issuance | Live — e.g. `000000012493B776B55105598934E2E9254EB48C4D03A9B1` |
| `MPTokensV1` | Enabled (hold/transfer MPT) |
| `MPTokensV2` | **Not on fleet image yet** (needed for MPT as AMM Asset2) |
| FALCON+FBTC AMM | **Not seeded** (`amm_info` → actNotFound) |

## Portal behavior

- **FBTC tab** loads MPT id via `GET /api/swap?symbol=FBTC` → `ledger_entry` `btc_bridge_state`.
- Balances use `account_objects` MPToken (sats → BTC display).
- No TrustSet for SPV FBTC — claim/authorize is on the bridge path.
- AMM create/deposit/withdraw/swap sign with `{ mpt_issuance_id, value }` integer sats.
- Limit orders disabled for FBTC MPT until order books support MPT.

## Ops: enable pool

1. **Rebuild Falcon** with `MPTokensV2` `Supported::Yes` (and enable via amendment/UNL when ready).
2. Confirm: `feature` RPC lists `MPTokensV2` supported (then enabled).
3. **Seed AMM** from an account that holds FALCON + SPV FBTC:

   ```bash
   # Example seed amounts (set price intentionally)
   # Amount  = FALCON drops
   # Amount2 = MPT { mpt_issuance_id, value: sats }
   pnpm exec tsx scripts/seed-fbtc-mpt-amm.mts
   ```

4. Verify:

   ```bash
   curl -s -X POST "$RPC" -H 'Content-Type: application/json' -d '{
     "method":"amm_info",
     "params":[{
       "asset":{"currency":"XRP"},
       "asset2":{"mpt_issuance_id":"'"$MPT_ID"'"},
       "ledger_index":"validated"
     }]
   }'
   ```

5. Portal `/pool` FBTC should show live reserves; Create Pool button works for first seeder if none exists.

## Related code

- `src/lib/swap/token-config.ts` — `loadSpvFbtcToken` / `resolveStableToken`
- `src/lib/swap/quote.ts` — MPT `amm_info` + sats pool parse
- `src/lib/falcon-tx-sign.ts` — `ammTokenSide` for AMMCreate/Deposit/Withdraw
- `src/app/pool/page.tsx`, `src/app/swap/page.tsx` — UI
- `src/components/MarketLiquidityPanel.tsx` — create/deposit/withdraw
