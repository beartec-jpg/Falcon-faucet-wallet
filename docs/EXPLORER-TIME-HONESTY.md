# Explorer time honesty (P0)

## Problem

Falcon PL ledgers carry **`sealed_at_ms` / `tip_sealed_at_ms`**: a **chain-physics** stamp used for packer pacing and relative ordering. It is **not** Unix wall-clock UTC. Mapping it with `new Date(sealed_at_ms).toISOString()` yields misleading dates (often **1970-03-14** on synthetic/dev stamps) and was shown as if it were wall UTC in explorer APIs.

Signed wall UTC is a separate field (`tip_sealed_utc_ms` / quality `utc_committed`) from the UTC header v5 work — still **unarmed** on production network 2300 (`H_utc = u64::MAX`).

## Rules (API v1)

| Field | Meaning |
|-------|---------|
| `sealed_at_ms` | Raw chain-physics ms. Retained. **Never** pass to `Date()` as UTC. |
| `sealed_at_quality` | `chain_physics` or `unavailable`. |
| `sealed_utc` / `sealed_utc_ms` | Wall UTC ISO / ms **only** when `sealed_utc_quality === "utc_committed"`. |
| `sealed_utc_source` | `signed_utc_v5` when UTC-quality; else `none`. |
| `sealed_at` | Legacy ISO field: set **only** to the signed-UTC ISO (same as `sealed_utc`), else **null**. Never `Date(physics)`. |
| `observed_at` | Wall clock when **this API** observed/mapped the tip. Separate from chain stamps. |

## Non-goals

- Does not activate UTC on 2300 or change Crypto #618 production.
- Does not imply `latest`/`limit=200` is an archive.
- Wallet activity already estimates times from tip distance (`pl-activity.ts`); that remains until signed UTC is armed.

## Tests

See `tests/explorer-api.test.ts` cases: *never treats chain-physics ms as UTC ISO*, *exposes signed UTC as UTC-quality only when utc_committed*.
