// Carried state for network health alerts. Postgres (same DATABASE_URL as
// operator_epoch_work) when configured, in-memory otherwise.

import { getSql, isDbConfigured } from '@/lib/db'
import { emptyState, type HealthState } from '@/lib/network-health'

export interface HealthStore {
  load(): Promise<HealthState>
  save(s: HealthState): Promise<void>
}

export function memoryHealthStore(): HealthStore {
  let s = emptyState()
  return {
    async load() {
      return structuredClone(s)
    },
    async save(n) {
      s = structuredClone(n)
    },
  }
}

let ready = false
export function pgHealthStore(): HealthStore {
  const sql = getSql()
  const ensure = async () => {
    if (ready) return
    await sql`CREATE TABLE IF NOT EXISTS network_health_state (
      id TEXT PRIMARY KEY, state JSONB NOT NULL, updated_at BIGINT NOT NULL)`
    ready = true
  }
  return {
    async load() {
      await ensure()
      const rows = (await sql`SELECT state FROM network_health_state WHERE id = 'pl2300'`) as { state: unknown }[]
      const raw = rows[0]?.state
      const v = typeof raw === 'string' ? JSON.parse(raw) : raw
      return { ...emptyState(), ...(v && typeof v === 'object' ? (v as Partial<HealthState>) : {}) }
    },
    async save(s) {
      await ensure()
      await sql`INSERT INTO network_health_state (id, state, updated_at) VALUES ('pl2300', ${JSON.stringify(s)}::jsonb, ${s.updatedAt ?? Date.now()})
        ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at`
    },
  }
}

let store: HealthStore | null = null
export function healthStore(): HealthStore {
  if (!store) store = isDbConfigured() ? pgHealthStore() : memoryHealthStore()
  return store
}
