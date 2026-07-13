/**
 * Portal-side record of borrower-declared FALCON collateral per loan.
 * On-chain collateral lock is not yet wired in XLS-66 LoanSet — this tracks
 * intent for health-factor UX until escrow / collateral objects ship.
 */

import { Redis } from '@upstash/redis'
import { getSql, isDbConfigured } from '@/lib/db'

const REDIS_PREFIX = 'falcon:lend:collateral:v1'
const mem = new Map<string, number>()

let tableReady: Promise<void> | null = null

function redisClient(): Redis | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token || !url.startsWith('https://')) return null
  return new Redis({ url, token })
}

function normalizeLoanId(loanId: string): string {
  return loanId.trim().toUpperCase()
}

async function ensureTable(): Promise<void> {
  if (!isDbConfigured()) return
  if (!tableReady) {
    tableReady = (async () => {
      const sql = getSql()
      await sql`
        CREATE TABLE IF NOT EXISTS lend_loan_collateral (
          loan_id TEXT PRIMARY KEY,
          borrower TEXT NOT NULL,
          collateral_falcon DOUBLE PRECISION NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `
    })()
  }
  await tableReady
}

async function redisGet(id: string): Promise<number | null> {
  const redis = redisClient()
  if (!redis) return null
  try {
    const raw = await redis.get(`${REDIS_PREFIX}:${id}`)
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''))
    if (Number.isFinite(n) && n > 0) return n
  } catch {
    /* ignore */
  }
  return null
}

async function redisSet(id: string, collateralFalcon: number): Promise<void> {
  const redis = redisClient()
  if (!redis) return
  try {
    await redis.set(`${REDIS_PREFIX}:${id}`, collateralFalcon)
  } catch {
    /* ignore */
  }
}

export async function setLoanCollateral(
  loanId: string,
  borrower: string,
  collateralFalcon: number,
): Promise<void> {
  const id = normalizeLoanId(loanId)
  if (!id || !Number.isFinite(collateralFalcon) || collateralFalcon <= 0) return
  mem.set(id, collateralFalcon)
  if (isDbConfigured()) {
    try {
      await ensureTable()
      const sql = getSql()
      await sql`
        INSERT INTO lend_loan_collateral (loan_id, borrower, collateral_falcon, updated_at)
        VALUES (${id}, ${borrower}, ${collateralFalcon}, NOW())
        ON CONFLICT (loan_id) DO UPDATE SET
          collateral_falcon = EXCLUDED.collateral_falcon,
          borrower = EXCLUDED.borrower,
          updated_at = NOW()
      `
      return
    } catch {
      /* fall through to redis/memory */
    }
  }
  await redisSet(id, collateralFalcon)
}

export async function getLoanCollateral(loanId: string): Promise<number | null> {
  const id = normalizeLoanId(loanId)
  if (!id) return null
  if (mem.has(id)) return mem.get(id) ?? null

  if (isDbConfigured()) {
    try {
      await ensureTable()
      const sql = getSql()
      const rows = await sql`
        SELECT collateral_falcon FROM lend_loan_collateral WHERE loan_id = ${id} LIMIT 1
      `
      const v = rows[0]?.collateral_falcon
      const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
      if (Number.isFinite(n) && n > 0) {
        mem.set(id, n)
        return n
      }
    } catch {
      /* fall through */
    }
  }

  const redisVal = await redisGet(id)
  if (redisVal != null) {
    mem.set(id, redisVal)
    return redisVal
  }
  return null
}

export async function getCollateralMap(loanIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const ids = [...new Set(loanIds.map(normalizeLoanId).filter(Boolean))]
  if (ids.length === 0) return out

  for (const id of ids) {
    const v = await getLoanCollateral(id)
    if (v != null && v > 0) out[id] = v
  }
  return out
}

export async function sumCollateral(loanIds: string[]): Promise<number> {
  const map = await getCollateralMap(loanIds)
  return Object.values(map).reduce((s, v) => s + v, 0)
}