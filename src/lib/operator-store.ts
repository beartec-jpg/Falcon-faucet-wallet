// Per-epoch operator work, sampled by the metrics cron. Postgres when configured,
// in-memory otherwise (same pattern as activity-index.ts).

import { getSql, isDbConfigured } from '@/lib/db'
import type { EpochWork } from '@/lib/operator-score'

export interface OperatorStore {
  /** Upsert this epoch's rows: latest share wins; jailed / locked stick once seen. */
  record(rows: EpochWork[], at: number): Promise<void>
  since(windowStart: string): Promise<EpochWork[]>
}

export function memoryOperatorStore(): OperatorStore {
  const m = new Map<string, EpochWork & { at: number }>()
  return {
    async record(rows, at) {
      for (const r of rows) {
        const k = `${r.epoch}|${r.validator}`
        const p = m.get(k)
        m.set(k, { ...r, jailed: r.jailed || !!p?.jailed, locked: r.locked || !!p?.locked, at: p?.at ?? at })
      }
    },
    async since(start) {
      const t = Date.parse(`${start}T00:00:00Z`)
      return [...m.values()].filter((r) => r.at >= t).map(({ at: _at, ...r }) => r)
    },
  }
}

let ready = false
export function pgOperatorStore(): OperatorStore {
  const sql = getSql()
  const ensure = async () => {
    if (ready) return
    await sql`CREATE TABLE IF NOT EXISTS operator_epoch_work (
      epoch BIGINT NOT NULL, validator TEXT NOT NULL, work_share DOUBLE PRECISION NOT NULL DEFAULT 0,
      jailed BOOLEAN NOT NULL DEFAULT FALSE, locked BOOLEAN NOT NULL DEFAULT FALSE,
      first_seen BIGINT NOT NULL, last_seen BIGINT NOT NULL, PRIMARY KEY (epoch, validator))`
    ready = true
  }
  return {
    async record(rows, at) {
      await ensure()
      for (const r of rows) {
        await sql`INSERT INTO operator_epoch_work (epoch, validator, work_share, jailed, locked, first_seen, last_seen)
          VALUES (${r.epoch}, ${r.validator}, ${r.workShare}, ${r.jailed}, ${r.locked}, ${at}, ${at})
          ON CONFLICT (epoch, validator) DO UPDATE SET work_share = EXCLUDED.work_share,
            jailed = operator_epoch_work.jailed OR EXCLUDED.jailed, locked = operator_epoch_work.locked OR EXCLUDED.locked,
            last_seen = EXCLUDED.last_seen`
      }
    },
    async since(start) {
      await ensure()
      const t = Date.parse(`${start}T00:00:00Z`)
      const rows = (await sql`SELECT epoch, validator, work_share, jailed, locked FROM operator_epoch_work WHERE first_seen >= ${t}`) as Record<string, unknown>[]
      return rows.map((r) => ({ epoch: Number(r.epoch), validator: String(r.validator), workShare: Number(r.work_share), jailed: !!r.jailed, locked: !!r.locked }))
    },
  }
}

let store: OperatorStore | null = null
export function operatorStore(): OperatorStore {
  if (!store) store = isDbConfigured() ? pgOperatorStore() : memoryOperatorStore()
  return store
}
