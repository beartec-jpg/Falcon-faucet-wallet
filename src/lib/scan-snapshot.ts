import { cidEmissionPct, cidYearlyAvgPct } from '@/lib/epoch-model'
import { meshHeadFromStatus, num, str } from '@/lib/pl-mesh'
import { plStatus } from '@/lib/pl-rpc'
import { loadZeroPoint, offsetRail } from '@/lib/pl-zero-point'
import type { LedgerSummary, RailRow, ScanData, ValidatorEntry } from '@/lib/scan-types'

type TipRing = LedgerSummary
const tipRing: TipRing[] = []
const RING = 12

function rememberTip(row: TipRing) {
  if (tipRing[0]?.seq === row.seq) {
    tipRing[0] = row
    return
  }
  tipRing.unshift(row)
  if (tipRing.length > RING) tipRing.length = RING
}

export async function buildScanSnapshot(): Promise<ScanData> {
  const st = await plStatus(false)
  const head = meshHeadFromStatus(st)
  const tip = head.height
  const tipHash = str(st.tip_hash)
  const packer = str(st.last_pack_packer)
  const txs = num(st.last_pack_txs)
  rememberTip({
    seq: tip,
    hash: tipHash,
    txn_count: txs,
    packer,
    close_time: Date.now() / 1000,
    close_time_human: new Date().toISOString(),
  })

  const valsRaw = Array.isArray(st.validators)
    ? (st.validators as Array<Record<string, unknown>>)
    : []
  const validators: ValidatorEntry[] = valsRaw.map((v) => ({
    account: str(v.id || v.bond_account),
    pubkey: str(v.id),
    bond_status: v.jailed ? 'jailed' : v.unbonding ? 'unbonding' : 'bonded',
    bonded_amount: String(num(v.bond)),
    composite_score: Math.round(num(v.pack_count)),
    ledger_index: num(v.last_advertised_tip),
    jailed: Boolean(v.jailed),
    lottery_ready: Boolean(v.lottery_ready),
    pack_count: num(v.pack_count),
  }))

  const railsRaw = Array.isArray(st.rails) ? (st.rails as Array<Record<string, unknown>>) : []
  const zp = await loadZeroPoint()
  const rails: RailRow[] = railsRaw.map((r) => {
    const off = offsetRail(zp, str(r.asset), num(r.total_minted), num(r.total_burned))
    return {
      asset: str(r.asset),
      tip_height: num(r.tip_height),
      tip_hash: str(r.tip_hash),
      total_minted: off.minted,
      total_burned: off.burned,
      min_confirmations: num(r.min_confirmations),
      open_withdrawals: num(r.open_withdrawals),
    }
  })
  if (!rails.some((r) => r.asset === 'XRP')) {
    rails.push({
      asset: 'XRP',
      tip_height: 0,
      tip_hash: '',
      total_minted: 0,
      total_burned: 0,
      min_confirmations: 1,
      open_withdrawals: 0,
    })
  }

  const metrics = (st.metrics ?? {}) as Record<string, unknown>
  const feeMkt = (metrics.fee_market ?? {}) as Record<string, unknown>
  const epochN = num(st.epoch, 1)
  const treasury = num(st.treasury)
  const emissionBps = num(st.emission_bps, 30)
  const epochClaimable = Boolean(st.epoch_claimable)
  const emission = epochClaimable ? Math.floor((treasury * emissionBps) / 10_000) : 0

  return {
    ...head,
    product: str(st.product, 'Falcon PL'),
    ticker: str(st.ticker, 'FPL'),
    consensus: str(st.consensus, 'Falcon Consensus'),
    network_id: num(st.network_id, 2300),
    server_version: head.product_version,
    uptime_seconds: Math.max(0, Math.floor((num(st.now_ms) - num(st.genesis_ms)) / 1000)),
    validated_ledger: tip,
    tip_hash: tipHash,
    state_root: str(st.state_root),
    current_fee_drops: num(st.suggested_min_fee, num(st.min_fee, 1)),
    median_fee_drops: num(metrics.fee_p50, 2),
    open_ledger_fee: num(feeMkt.suggested_min_fee, 1),
    tx_queue_size: num(st.mempool),
    mempool: num(st.mempool),
    max_mempool: num(st.max_mempool_txs, 50_000),
    fee_multiplier: num(feeMkt.fee_multiplier, 1),
    recent_ledgers: tipRing.slice(),
    recent_txs: [],
    validators,
    proposers: head.online_seats.length,
    tps_estimate: 0,
    avg_txs_per_ledger: txs,
    avg_close_seconds: 0.2,
    load_factor: num(feeMkt.mempool_util_bps),
    load_base: 10_000,
    complete_ledgers: String(num(metrics.ledgers_sealed, tip)),
    reserve_base: 0,
    reserve_inc: 0,
    treasury,
    epoch: {
      number: epochN,
      poolBalanceFalcon: treasury,
      emissionRateFalcon: emission,
      lpAllocationPct: 40,
      lpProviderCount: 0,
      cidEmissionPct: cidEmissionPct(epochN),
      cidYearlyAvgPct: cidYearlyAvgPct(epochN),
      firstClaimEpoch: num(st.first_claim_epoch, 1),
      epochClaimable,
      lastSettledEpoch: num(st.last_settled_epoch),
    },
    last_pack: {
      height: num(st.last_pack_height, tip),
      packer,
      txs,
    },
    lottery_winner: str(st.lottery_winner_next),
    rails,
    metrics: {
      ledgers_sealed: num(metrics.ledgers_sealed, tip),
      txs_sealed: num(metrics.txs_sealed),
      submit_accepted: num(metrics.submit_accepted),
      fees_burned: num(metrics.fees_burned_total),
    },
  }
}
