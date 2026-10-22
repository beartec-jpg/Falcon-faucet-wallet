# Network health (/network/health) and Discord alerts

**Page**: `/network/health` (linked under Community → Network health). It polls `GET /api/network/health` every 30 s; the API caches for 15 s.

**Data**, all from sources the site already has. No node ports are opened:
- The brief `status_req` the site already makes (`statusExact`): tip, epoch, and per-validator `last_advertised_tip`, `jailed`, `v2.inactive`, `v2.missed_turns`, `pack_count`, `pong_fresh`, plus `online_seats` and `lottery_winner_next`.
- Epoch activity: `operatorsBoard` work share, the same figure the `operator_epoch_work` cron records.
- Block rate: the 24 h `blocks_min` series in the metric store.
- Carried state in Postgres table `network_health_state` (memory when there is no DB), updated by `/api/cron/sample-metrics` every 5 min. It holds the tip-advance time, per-seat pack_count (last proposal = the sample where it rose), and active alerts.
- Version is blank: seats do not report their version in the public status. Last proposal is blank until a seat's pack_count rises after the first sample. It has 5-min resolution.

**Alert rules** (evaluated in each cron run):

| key | severity | condition |
|---|---|---|
| `chain:stall` | critical | tip unchanged > 3 min |
| `proposer:<id>:<h>` | critical | during a stall, the same `lottery_winner_next` for height h for > 3 min |
| `seat:<id>:jailed` | critical | seat jailed |
| `seat:<id>:inactive` | warning | seat `v2.inactive` |
| `seat:<id>:lag` | warning | tip − `last_advertised_tip` > 20 (not jailed or inactive) |

**Delivery**:
- Each alert posts once to `DISCORD_HEALTH_WEBHOOK_URL` and keeps its `since` time while it stays active.
- When it clears, one ✅ recovery message is sent.
- A failed post is retried on the next run.
- If the env var is unset, nothing is posted. Alerts still show on the page, and turning the webhook on later does not replay them.
- Mentions are disabled.
- Optional mirror: if `GROKBOT_ALERT_URL` is set, each message that Discord accepted is also POSTed there as the same JSON, with `GROKBOT_ALERT_AUTH` (if set) as the whole `Authorization` header. Best effort: a mirror failure is ignored and never causes a Discord retry.
- Detection runs on the 5-min cron, so a stall is reported 3–8 min after the last block.

**Retired seats**:
- `src/config/retired-seats.ts` (v2, v4, v5, v7, v8, v9) plus an optional comma-separated env `RETIRED_SEATS`. These seats can't be deregistered on chain.
- They are hidden from the table, KPIs and seat alerts.
- Their stored alerts are dropped silently, with no recovery post.

**Missed turns**: shown only for v2 seats (`v2.v2_seat`) or when the count is non-zero. Legacy seats report 0, meaning the count isn't tracked.

**Height blank**: a seat whose own `last_advertised_tip` is 0 (for example scottdog on 2026-10-21) has no height. That value comes from the node's pong tip, so it is not a site issue.
