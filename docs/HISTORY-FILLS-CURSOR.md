# Explorer fill history cursor (P2 draft)

## Scope
Durable **fill_id** + opaque cursor over an ingested index. Stacked on explorer time honesty (#187).

## Non-claims
- **Not** a full-chain archive. Node `RECENT_FILLS=200` remains the live ring (`/v1/.../trades` latest200 compatibility unchanged).
- Coverage reports `is_full_archive: false` and a ring-limit note. Sparse heights are samples, not proof of missing ledgers.

## fill_id
`f_<height>_<height_index>_<content12>` where `height_index` preserves **identical-fill multiplicity** at the same height; `content12` is a fingerprint of fill fields.

## Ordering & cursor
Deterministic: height ascending for storage; pages are **newest-first**. Cursor is opaque base64url `h1:<fill_id>` meaning “continue after this id”.

## Time fields
Uses honesty helpers: `sealed_at_ms` = chain physics; ISO UTC only when `utc_committed` / `signed_utc_v5`. No retroactive verified UTC for old blocks without signed stamps. `observed_at` is ingest wall clock.

## Restart
`dump()` / `load()` retain the index across process restart when the host persists the dump (file path left to deploy config — not activated here).

## HTTP (draft)
- `GET /v1/explorer/trades` — **unchanged** live latest200 from node `fills_query`.
- `GET /v1/explorer/fills/history?limit=&cursor=&pair=` — durable index page + coverage.
- `POST /v1/explorer/fills/history/backfill?pair=` — pull ≤200 from node into index (idempotent by fill_id).
- `GET /v1/explorer/fills/history/coverage` — coverage only.
- Optional restart retention: set `FPL_FILL_HISTORY_DUMP_PATH` (not activated in production by this PR).

## Stacking
Branch `draft/history-fills-cursor-p2` is stacked on `draft/explorer-time-honesty-p0` (#187 @ 6c10e19).
