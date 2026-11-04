<!-- Copyright (c) BEARTEC. All Rights Reserved. Proprietary — see LICENSE. -->
# Falcon PL Explorer API v1

Public, read-only, additive. Served by the site at `https://falcon-fpl.com/v1/*` (rewritten to `src/app/api/v1/*`).
Spec: `GET /v1/openapi.json` (OpenAPI 3.1, source `src/lib/explorer-api/openapi.ts`).

- Node access reuses `src/lib/pl-rpc.ts` (`FALCON_PL_RPC` wire gateway) via `statusExact`, with a 1 s single-flight status cache.
- Amounts: `{ asset, raw, decimals, value }` — `raw`/`value` are strings (FPL 0, BTC/BTC4 8, USDC 6, ETH 18).
- Pagination: `?limit=` (1–100, default 25) and opaque `?cursor=` from `page.next_cursor`.
- Caching: weak `ETag` + `If-None-Match` → 304; `Cache-Control`, `CDN-Cache-Control`, `Vercel-CDN-Cache-Control` per endpoint (live 2 s, short 5 s, medium 30 s, static 1 h). `/v1/health` is `no-store`; errors are `no-store`.
- Errors: `{ "error": { "code", "message" } }`; node errors are logged, never echoed.
- Order book: uses node v2.10.4 wire RPC `order_book_query` / `fills_query` / `open_orders_query`. Before activation (height 800,000) → 200 with empty data and `active: false`; if the node/gateway does not expose the RPC → 501 `not_implemented`.
- Gateway-ready: versioned prefix, CORS `*`, `x-api-version` header, handlers in `src/lib/explorer-api/handlers.ts` are framework-agnostic (`Request` → `Response`).
