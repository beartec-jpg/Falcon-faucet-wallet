/**
 * On-chain snapshot helpers for airdrop scoring (validators + DEX AMM LP).
 */

import type { NetworkKey } from '@/lib/networks'
import { serverRpcCall } from '@/lib/network-server'
import { loadStableToken } from '@/lib/swap/token-config'
import { getSql, isDbConfigured } from '@/lib/db'

const DROPS = 1_000_000

export interface ValidatorSnap {
  address: string
  bonded: boolean
  bondFalcon: number
  status: number | null
  compositeScore: number | null
}

export interface DexLpSnap {
  address: string
  lpBalance: number
  lpShare: number
  pool: string
}

async function ensureSnapshotTables(): Promise<void> {
  if (!isDbConfigured()) return
  const sql = getSql()
  await sql`
    CREATE TABLE IF NOT EXISTS airdrop_snapshots (
      id BIGSERIAL PRIMARY KEY,
      network TEXT NOT NULL,
      snap_day DATE NOT NULL,
      kind TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (network, snap_day, kind)
    )
  `
}

/** Best-effort: list validator bond objects via ledger_data is heavy; use account_objects on known set or ledger_entry patterns.
 *  For fleet ops we accept a list of candidate addresses (UNL operators) or scan via server-provided list.
 */
export async function snapshotValidators(
  networkKey: NetworkKey,
  candidateAddresses: string[],
): Promise<ValidatorSnap[]> {
  const out: ValidatorSnap[] = []
  for (const address of candidateAddresses) {
    try {
      const r = await serverRpcCall<{
        account_objects?: Array<Record<string, unknown>>
      }>(
        networkKey,
        'account_objects',
        { account: address, ledger_index: 'validated', type: 'state' },
        { allowError: true },
      )
      const objs = r.account_objects ?? []
      const bond = objs.find(
        (o) =>
          o.LedgerEntryType === 'ValidatorBond' ||
          String(o.LedgerEntryType ?? '').includes('Bond'),
      )
      if (!bond) {
        out.push({
          address,
          bonded: false,
          bondFalcon: 0,
          status: null,
          compositeScore: null,
        })
        continue
      }
      const raw =
        bond.BondedAmount ?? bond.Balance ?? bond.Amount ?? '0'
      let bondFalcon = 0
      if (typeof raw === 'string' || typeof raw === 'number') {
        const n = Number(raw)
        bondFalcon = n > 1e6 ? n / DROPS : n
      }
      const status = bond.BondStatus != null ? Number(bond.BondStatus) : null
      const score =
        bond.CompositeScore != null ? Number(bond.CompositeScore) : null
      out.push({
        address,
        bonded: status === 1 || bondFalcon >= 1000,
        bondFalcon,
        status,
        compositeScore: Number.isFinite(score) ? score : null,
      })
    } catch {
      out.push({
        address,
        bonded: false,
        bondFalcon: 0,
        status: null,
        compositeScore: null,
      })
    }
  }
  return out
}

/** Snapshot FALCON/IOU AMM LP token holders if we can resolve LP currency from amm_info. */
export async function snapshotDexLp(networkKey: NetworkKey): Promise<DexLpSnap[]> {
  const stable = await loadStableToken()
  if (!stable.issuer) return []

  const amm = await serverRpcCall<{
    amm?: Record<string, unknown>
    error?: string
  }>(
    networkKey,
    'amm_info',
    {
      asset: { currency: 'XRP' },
      asset2: { currency: stable.currency, issuer: stable.issuer },
      ledger_index: 'validated',
    },
    { allowError: true },
  )
  if (amm?.error || !amm?.amm) return []

  const lpToken = amm.amm.lp_token as
    | { currency?: string; issuer?: string; value?: string }
    | undefined
  if (!lpToken?.currency || !lpToken?.issuer) {
    // Native AMM LP may use different shape — store pool size only
    return []
  }

  // Without a full ledger scan of trust lines, LP holders must be provided via
  // known set or future ledger_data job. Return empty holder list with pool meta.
  void lpToken
  return []
}

export async function persistSnapshot(
  network: string,
  kind: 'validators' | 'dex_lp' | 'meta',
  payload: unknown,
  dayUtc = new Date().toISOString().slice(0, 10),
): Promise<void> {
  if (!isDbConfigured()) {
    console.info('[airdrop-snap]', kind, dayUtc, JSON.stringify(payload).slice(0, 200))
    return
  }
  await ensureSnapshotTables()
  const sql = getSql()
  await sql`
    INSERT INTO airdrop_snapshots (network, snap_day, kind, payload)
    VALUES (${network}, ${dayUtc}::date, ${kind}, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (network, snap_day, kind)
    DO UPDATE SET payload = EXCLUDED.payload, created_at = NOW()
  `
}

/**
 * Recompute airdrop_allocations from faucet_claims + latest validator snapshot.
 * DEX LP filled when snapshots include holders.
 */
export async function recomputeAllocations(network: string): Promise<{
  addresses: number
  totalFalcon: number
}> {
  if (!isDbConfigured()) {
    return { addresses: 0, totalFalcon: 0 }
  }
  const sql = getSql()
  const { faucetEngagementScore, AIRDROP_WEIGHTS, AIRDROP_POOL_FALCON, AIRDROP_WINDOW_DAYS } =
    await import('@/lib/airdrop-score')

  // Faucet claims
  const claimRows = await sql`
    SELECT address, day_utc::text AS day, COUNT(*)::int AS n
    FROM faucet_claims
    WHERE network = ${network}
    GROUP BY address, day_utc
  `

  const byAddr: Record<string, Record<string, number>> = {}
  for (const r of claimRows as Array<{ address: string; day: string; n: number }>) {
    const a = r.address
    if (!byAddr[a]) byAddr[a] = {}
    byAddr[a][r.day.slice(0, 10)] = Number(r.n)
  }

  // Latest validator snapshot
  const valSnap = await sql`
    SELECT payload FROM airdrop_snapshots
    WHERE network = ${network} AND kind = 'validators'
    ORDER BY snap_day DESC LIMIT 1
  `
  const validators = (valSnap[0] as { payload?: ValidatorSnap[] } | undefined)?.payload ?? []
  const bonded = new Set(
    (Array.isArray(validators) ? validators : [])
      .filter((v) => v.bonded)
      .map((v) => v.address),
  )

  const allAddresses = new Set<string>([...Object.keys(byAddr), ...bonded])

  type Row = {
    address: string
    score_validator: number
    score_setup: number
    score_dex_lp: number
    score_faucet: number
    score_total: number
    faucet_active_days: number
    faucet_claims: number
  }
  const rows: Row[] = []

  for (const address of allAddresses) {
    const eng = faucetEngagementScore({
      windowDays: AIRDROP_WINDOW_DAYS,
      claimsByDay: byAddr[address] ?? {},
    })
    const score_validator = bonded.has(address) ? 1 : 0
    const score_setup = score_validator // setup implied by bond for v1
    const score_dex_lp = 0
    const score_faucet = eng.score
    const score_total =
      AIRDROP_WEIGHTS.validator * score_validator +
      AIRDROP_WEIGHTS.setup * score_setup +
      AIRDROP_WEIGHTS.dexLp * score_dex_lp +
      AIRDROP_WEIGHTS.faucet * score_faucet
    rows.push({
      address,
      score_validator,
      score_setup,
      score_dex_lp,
      score_faucet,
      score_total,
      faucet_active_days: eng.activeDays,
      faucet_claims: eng.totalClaims,
    })
  }

  const sum = rows.reduce((s, r) => s + r.score_total, 0) || 1
  const pool = AIRDROP_POOL_FALCON * (1 - AIRDROP_WEIGHTS.buffer)

  for (const r of rows) {
    const falcon = (r.score_total / sum) * pool
    await sql`
      INSERT INTO airdrop_allocations (
        network, address, score_validator, score_setup, score_dex_lp, score_faucet,
        score_total, falcon_amount, faucet_active_days, faucet_claims, updated_at
      ) VALUES (
        ${network}, ${r.address}, ${r.score_validator}, ${r.score_setup}, ${r.score_dex_lp},
        ${r.score_faucet}, ${r.score_total}, ${falcon}, ${r.faucet_active_days},
        ${r.faucet_claims}, NOW()
      )
      ON CONFLICT (network, address) DO UPDATE SET
        score_validator = EXCLUDED.score_validator,
        score_setup = EXCLUDED.score_setup,
        score_dex_lp = EXCLUDED.score_dex_lp,
        score_faucet = EXCLUDED.score_faucet,
        score_total = EXCLUDED.score_total,
        falcon_amount = EXCLUDED.falcon_amount,
        faucet_active_days = EXCLUDED.faucet_active_days,
        faucet_claims = EXCLUDED.faucet_claims,
        updated_at = NOW()
    `
  }

  return {
    addresses: rows.length,
    totalFalcon: rows.reduce((s, r) => s + (r.score_total / sum) * pool, 0),
  }
}
