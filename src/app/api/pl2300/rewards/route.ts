import { NextResponse } from 'next/server'
import { plRpc } from '@/lib/pl-rpc'
import {
  big,
  bigMap,
  emissionPctPerYear,
  parseBigJson,
  projectSettle,
  projectSettleV2,
  settleEtaMs,
  stringifyBigs,
} from '@/lib/pl-rewards-model'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function accountName(raw: string | null): string {
  const s = (raw || '').trim().toLowerCase()
  return /^[a-z0-9._-]{1,64}$/.test(s) ? s : ''
}

function lineBody(r: { type?: string; raw?: unknown; body?: unknown }): Record<string, unknown> {
  if (typeof r.raw === 'string' && r.raw.trim().startsWith('{')) {
    const m = parseBigJson(r.raw) as { body?: Record<string, unknown> }
    if (m && typeof m === 'object' && m.body) return m.body
  }
  return (r.body ?? {}) as Record<string, unknown>
}

async function account(id: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await plRpc({ type: 'account_query', account: id }, { timeoutMs: 12_000 })
    if (r.type !== 'account') return null
    return lineBody(r)
  } catch {
    return null
  }
}

type Validator = { id?: string; bond?: unknown; jailed?: boolean; pack_count?: unknown; jail_count?: unknown }

/**
 * Falcon PL 2300 rewards: epoch, emission, buckets, projected settle and
 * (optionally) one account's claimable + projected share. Read-only.
 */
export async function GET(req: Request) {
  try {
    const who = accountName(new URL(req.url).searchParams.get('account'))
    const r = await plRpc({ type: 'status_req', include_accounts: false, brief: true })
    if (r.type === 'err') throw new Error(String(r.msg ?? 'status error'))
    const st = lineBody(r)
    const validators = (Array.isArray(st.validators) ? st.validators : []) as Validator[]
    const eligible = validators
      .filter((v) => v.id && !v.jailed && big(v.bond) > 0n)
      .map((v) => String(v.id))
    // Node 2.9.62+: `rewards_v2.active_epoch` switches to the v2 settle.
    const rv2 = (st.rewards_v2 ?? {}) as Record<string, unknown>
    const isV2 = rv2.active_epoch === true
    const proj = isV2
      ? projectSettleV2({
          treasury: big(st.treasury),
          emissionBps: big(st.emission_bps),
          epochClaimable: st.epoch_claimable !== false,
          ammLp: bigMap(rv2.amm_lp_value_weights),
          lendLp: bigMap(rv2.lend_lp_value_weights),
          watcherWork: bigMap(st.watcher_work),
          watcherSlots: bigMap(st.watcher_slots),
          proposerCredit: bigMap(rv2.epoch_proposer_credit),
          voteCredit: bigMap(rv2.epoch_vote_credit),
          floorWeights: bigMap(rv2.floor_weights),
          feePool: big(rv2.epoch_fee_reward_pool),
        })
      : projectSettle({
          treasury: big(st.treasury),
          emissionBps: big(st.emission_bps),
          epochClaimable: st.epoch_claimable !== false,
          ammLp: bigMap(st.amm_lp_weights),
          lendLp: bigMap(st.lend_lp_weights),
          watcherWork: bigMap(st.watcher_work),
          watcherSlots: bigMap(st.watcher_slots),
          packTxs: bigMap(st.epoch_pack_txs),
          eligibleValidators: eligible,
        })
    const epoch = Number(st.epoch ?? 0)
    const epochMs = Number(st.epoch_ms ?? 0)
    const genesisMs = Number(st.genesis_ms ?? 0)
    const nowMs = Number(st.now_ms ?? 0)
    const bps = Number(st.emission_bps ?? 0)

    const ids = validators.map((v) => String(v.id ?? '')).filter(Boolean)
    const lookups = Array.from(new Set([...ids, ...(who ? [who] : [])]))
    const accts = await Promise.all(lookups.map((id) => account(id)))
    const byId = new Map(lookups.map((id, i) => [id, accts[i]]))

    const seats = validators.map((v) => {
      const id = String(v.id ?? '')
      const a = byId.get(id)
      return {
        id,
        bond: big(v.bond),
        jailed: Boolean(v.jailed),
        jailCount: Number(v.jail_count ?? 0),
        packTxsEpoch: bigMap(st.epoch_pack_txs)[id] ?? 0n,
        claimable: a ? big(a.claimable) : null,
        projected: proj.validatorPays[id] ?? 0n,
      }
    })

    let me: Record<string, unknown> | null = null
    if (who) {
      const a = byId.get(who)
      const lp = Array.isArray(a?.lp) ? (a!.lp as unknown[]) : []
      const lend = Array.isArray(a?.lend_positions) ? (a!.lend_positions as unknown[]) : []
      me = {
        account: who,
        exists: Boolean(a?.exists),
        balance: a ? big(a.balance) : 0n,
        sequence: a ? Number(a.sequence ?? 0) : 0,
        claimable: a ? big(a.claimable) : 0n,
        watcherWork: a ? big(a.watcher_work) : 0n,
        watcherSlots: a ? big(a.watcher_slots) : 0n,
        lpPositions: lp.length,
        lendPositions: lend.length,
        projected: {
          total: proj.pays[who] ?? 0n,
          validator: proj.validatorPays[who] ?? 0n,
          watcher: proj.watcherPays[who] ?? 0n,
          amm: proj.ammPays[who] ?? 0n,
          lend: proj.lendPays[who] ?? 0n,
        },
        ammWeight: bigMap(isV2 ? rv2.amm_lp_value_weights : st.amm_lp_weights)[who] ?? 0n,
        lendWeight: bigMap(isV2 ? rv2.lend_lp_value_weights : st.lend_lp_weights)[who] ?? 0n,
        watcherWeight: proj.watcherWeights[who] ?? 0n,
      }
    }

    return NextResponse.json(
      stringifyBigs({
        ok: true,
        source: 'falcon-pl-2300',
        tip: Number(st.tip_height ?? 0),
        product: String(st.product_version ?? ''),
        epoch,
        lastSettledEpoch: Number(st.last_settled_epoch ?? 0),
        firstClaimEpoch: Number(st.first_claim_epoch ?? 1),
        epochMs,
        settleInMs: settleEtaMs(epoch, epochMs, genesisMs, nowMs),
        watcherCurrentSlot: Number(st.watcher_current_slot ?? 0),
        treasury: big(st.treasury),
        emissionBps: bps,
        emissionPctPerYear: emissionPctPerYear(bps, epochMs || undefined),
        emit: proj.emit,
        buckets: proj.buckets,
        lpCap: proj.lpCap,
        watcherCap: proj.watcherCap,
        validatorPot: proj.validatorPot,
        packHalf: proj.packHalf,
        checkHalf: proj.checkHalf,
        packTxsTotal: 'packTxsTotal' in proj ? proj.packTxsTotal : 0n,
        formula: isV2 ? 'v2' : 'v1',
        v2: isV2 && 'propPool' in proj
          ? {
              propPool: proj.propPool,
              votePool: proj.votePool,
              floorPool: proj.floorPool,
              feePool: proj.feePool,
              proposerCredit: bigMap(rv2.epoch_proposer_credit),
              voteCredit: bigMap(rv2.epoch_vote_credit),
            }
          : null,
        eligibleValidators: eligible.length,
        watchers: Object.keys(bigMap(st.watcher_work)).map((id) => ({
          id,
          work: bigMap(st.watcher_work)[id],
          slots: bigMap(st.watcher_slots)[id] ?? 0n,
          weight: proj.watcherWeights[id] ?? 0n,
          projected: proj.watcherPays[id] ?? 0n,
        })),
        lps: Array.from(
          new Set([...Object.keys(proj.ammPays), ...Object.keys(proj.lendPays)]),
        ).map((id) => ({ id, amm: proj.ammPays[id] ?? 0n, lend: proj.lendPays[id] ?? 0n })),
        seats,
        me,
        notes: [
          'Projection = settle with the counters as they are now; the real payout uses the counters at the epoch boundary.',
          isV2
            ? 'Rewards v2: validator pot = 55% bucket + unpaid LP/watcher caps + 20% of fees; 50% by proposer credit, 40% by votes, 10% equal floor (archive 105).'
            : 'Fee share of the validator pot is not exposed by status and is not included (lower bound).',
          'Lending has no interest yet: lenders earn the 20% lend emission bucket pro rata, capped at 0.5% of emission per account.',
        ],
      }),
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'rewards failed' },
      { status: 502 },
    )
  }
}
