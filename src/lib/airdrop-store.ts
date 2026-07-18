import { getSql, isDbConfigured } from '@/lib/db'
import { faucetEngagementScore, AIRDROP_POOL_FALCON, AIRDROP_WINDOW_DAYS } from '@/lib/airdrop-score'

export interface AirdropOverview {
  configured: boolean
  network: string
  genesisAt: string | null
  windowDays: number
  poolFalcon: number
  firstEmissionEpoch: number
  windowOpen: boolean
  windowEndsAt: string | null
  daysElapsed: number | null
  notes: string | null
  totalAddresses: number
  totalAllocatedFalcon: number
}

export interface AirdropAddressView {
  address: string
  scoreFaucet: number
  faucetActiveDays: number
  faucetClaims: number
  scoreValidator: number
  scoreSetup: number
  scoreDexLp: number
  scoreTotal: number
  falconAmount: number
  claimed: boolean
  claimsByDay: Record<string, number>
}

export async function getAirdropOverview(network = 'mainnet'): Promise<AirdropOverview> {
  const base: AirdropOverview = {
    configured: isDbConfigured(),
    network,
    genesisAt: null,
    windowDays: AIRDROP_WINDOW_DAYS,
    poolFalcon: AIRDROP_POOL_FALCON,
    firstEmissionEpoch: 8,
    windowOpen: false,
    windowEndsAt: null,
    daysElapsed: null,
    notes:
      'Contribution window starts at mainnet genesis for 60 days. Faucet: 5/day + 1h cooldown. Emissions from epoch 8.',
    totalAddresses: 0,
    totalAllocatedFalcon: 0,
  }

  if (!isDbConfigured()) return base

  try {
    const sql = getSql()
    const cfg = await sql`
      SELECT network, genesis_at, window_days, pool_falcon, first_emission_epoch, notes
      FROM airdrop_config WHERE id = 1 LIMIT 1
    `
    if (cfg[0]) {
      const row = cfg[0] as {
        network: string
        genesis_at: string | null
        window_days: number
        pool_falcon: number
        first_emission_epoch: number
        notes: string | null
      }
      base.network = row.network ?? network
      base.genesisAt = row.genesis_at
      base.windowDays = Number(row.window_days) || AIRDROP_WINDOW_DAYS
      base.poolFalcon = Number(row.pool_falcon) || AIRDROP_POOL_FALCON
      base.firstEmissionEpoch = Number(row.first_emission_epoch) || 8
      base.notes = row.notes
      if (row.genesis_at) {
        const start = new Date(row.genesis_at).getTime()
        const end = start + base.windowDays * 86400_000
        const now = Date.now()
        base.windowOpen = now >= start && now < end
        base.windowEndsAt = new Date(end).toISOString()
        base.daysElapsed = Math.max(0, Math.min(base.windowDays, Math.floor((now - start) / 86400_000)))
      }
    }

    const totals = await sql`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(falcon_amount), 0)::float AS falcon
      FROM airdrop_allocations WHERE network = ${base.network}
    `
    if (totals[0]) {
      base.totalAddresses = Number((totals[0] as { n: number }).n) || 0
      base.totalAllocatedFalcon = Number((totals[0] as { falcon: number }).falcon) || 0
    }
  } catch (e) {
    console.warn('[airdrop] overview:', e)
  }

  return base
}

export async function getAirdropForAddress(
  address: string,
  network = 'mainnet',
): Promise<AirdropAddressView> {
  const empty: AirdropAddressView = {
    address,
    scoreFaucet: 0,
    faucetActiveDays: 0,
    faucetClaims: 0,
    scoreValidator: 0,
    scoreSetup: 0,
    scoreDexLp: 0,
    scoreTotal: 0,
    falconAmount: 0,
    claimed: false,
    claimsByDay: {},
  }

  if (!isDbConfigured()) {
    // Still compute live faucet score from logs if table exists later
    return empty
  }

  try {
    const sql = getSql()
    const overview = await getAirdropOverview(network)
    const windowDays = overview.windowDays

    const rows = await sql`
      SELECT day_utc::text AS day, COUNT(*)::int AS n
      FROM faucet_claims
      WHERE network = ${network} AND address = ${address}
      GROUP BY day_utc
      ORDER BY day_utc
    `
    const claimsByDay: Record<string, number> = {}
    for (const r of rows as Array<{ day: string; n: number }>) {
      claimsByDay[r.day.slice(0, 10)] = Number(r.n)
    }
    const eng = faucetEngagementScore({ windowDays, claimsByDay })

    const alloc = await sql`
      SELECT score_validator, score_setup, score_dex_lp, score_faucet, score_total,
             falcon_amount, claimed
      FROM airdrop_allocations
      WHERE network = ${network} AND address = ${address}
      LIMIT 1
    `

    if (alloc[0]) {
      const a = alloc[0] as Record<string, unknown>
      return {
        address,
        scoreValidator: Number(a.score_validator) || 0,
        scoreSetup: Number(a.score_setup) || 0,
        scoreDexLp: Number(a.score_dex_lp) || 0,
        scoreFaucet: Number(a.score_faucet) || eng.score,
        scoreTotal: Number(a.score_total) || 0,
        falconAmount: Number(a.falcon_amount) || 0,
        claimed: !!a.claimed,
        faucetActiveDays: eng.activeDays,
        faucetClaims: eng.totalClaims,
        claimsByDay,
      }
    }

    return {
      ...empty,
      scoreFaucet: eng.score,
      faucetActiveDays: eng.activeDays,
      faucetClaims: eng.totalClaims,
      claimsByDay,
    }
  } catch (e) {
    console.warn('[airdrop] address:', e)
    return empty
  }
}
