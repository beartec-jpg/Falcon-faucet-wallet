// GET /api/scan — Falcon PL 2300 explorer snapshot

import { NextRequest, NextResponse } from 'next/server'
import { cidEmissionPct, cidYearlyAvgPct } from '@/lib/epoch-model'
import { plAccount, plStatus } from '@/lib/pl-rpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface ValidatorEntry {
  account: string
  pubkey: string
  bond_status: string
  bonded_amount: string
  composite_score: number
  ledger_index: number
  jailed?: boolean
  lottery_ready?: boolean
  pack_count?: number
}

export interface LedgerSummary {
  seq: number
  hash: string
  txn_count: number
  close_time_human: string
  close_time: number
  packer?: string
}

export interface TxSummary {
  hash: string
  type: string
  account: string
  destination?: string
  amount?: string
  fee: string
  ledger_index: number
  result: string
}

export interface RailRow {
  asset: string
  tip_height: number
  tip_hash: string
  total_minted: number
  total_burned: number
  min_confirmations: number
  open_withdrawals: number
}

export interface ScanData {
  product: string
  ticker: string
  consensus: string
  network_id: number
  product_version: string
  server_state: string
  server_version: string
  uptime_seconds: number
  peers: number
  validated_ledger: number
  tip_hash: string
  state_root: string
  current_fee_drops: number
  median_fee_drops: number
  open_ledger_fee: number
  tx_queue_size: number
  mempool: number
  max_mempool: number
  fee_multiplier: number
  recent_ledgers: LedgerSummary[]
  recent_txs: TxSummary[]
  validators: ValidatorEntry[]
  proposers: number
  online_seats: string[]
  tps_estimate: number
  avg_txs_per_ledger: number
  avg_close_seconds: number
  load_factor: number
  load_base: number
  complete_ledgers: string
  reserve_base: number
  reserve_inc: number
  treasury: number
  epoch: {
    number: number | null
    poolBalanceFalcon: number | null
    emissionRateFalcon: number | null
    lpAllocationPct: number | null
    lpProviderCount: number | null
    cidEmissionPct: number | null
    cidYearlyAvgPct: number | null
    firstClaimEpoch: number
    epochClaimable: boolean
    lastSettledEpoch: number
  }
  last_pack: {
    height: number
    packer: string
    txs: number
  }
  lottery_winner: string
  committee_size: number
  commit_need: number
  rails: RailRow[]
  metrics: {
    ledgers_sealed: number
    txs_sealed: number
    submit_accepted: number
    fees_burned: number
  }
}

type TipRing = LedgerSummary
const tipRing: TipRing[] = []
const RING = 12

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function str(v: unknown, fallback = ''): string {
  return v == null ? fallback : String(v)
}

function rememberTip(row: TipRing) {
  if (tipRing[0]?.seq === row.seq) {
    tipRing[0] = row
    return
  }
  tipRing.unshift(row)
  if (tipRing.length > RING) tipRing.length = RING
}

export async function GET(req: NextRequest) {
  const accountQ = req.nextUrl.searchParams.get('account')?.trim()
  if (accountQ) {
    try {
      const acct = await plAccount(accountQ)
      return NextResponse.json({ type: 'account', found: Boolean(acct.exists), ...acct })
    } catch (e) {
      return NextResponse.json({ type: 'account', found: false, error: String(e) }, { status: 200 })
    }
  }

  try {
    const st = await plStatus(false)
    const tip = num(st.tip_height)
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

    const valsRaw = Array.isArray(st.validators) ? (st.validators as Array<Record<string, unknown>>) : []
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

    const online = Array.isArray(st.online_seats)
      ? (st.online_seats as unknown[]).map((x) => String(x))
      : []
    const railsRaw = Array.isArray(st.rails) ? (st.rails as Array<Record<string, unknown>>) : []
    const rails: RailRow[] = railsRaw.map((r) => ({
      asset: str(r.asset),
      tip_height: num(r.tip_height),
      tip_hash: str(r.tip_hash),
      total_minted: num(r.total_minted),
      total_burned: num(r.total_burned),
      min_confirmations: num(r.min_confirmations),
      open_withdrawals: num(r.open_withdrawals),
    }))
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

    const payload: ScanData = {
      product: str(st.product, 'Falcon PL'),
      ticker: str(st.ticker, 'FPL'),
      consensus: str(st.consensus, 'Falcon Consensus'),
      network_id: num(st.network_id, 2300),
      product_version: str(st.product_version),
      server_state: online.length >= 4 ? 'live' : 'degraded',
      server_version: str(st.product_version),
      uptime_seconds: Math.max(0, Math.floor((num(st.now_ms) - num(st.genesis_ms)) / 1000)),
      peers: online.length,
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
      proposers: online.length,
      online_seats: online,
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
      committee_size: num(st.committee_size, 6),
      commit_need: num(st.commit_need, 4),
      rails,
      metrics: {
        ledgers_sealed: num(metrics.ledgers_sealed, tip),
        txs_sealed: num(metrics.txs_sealed),
        submit_accepted: num(metrics.submit_accepted),
        fees_burned: num(metrics.fees_burned_total),
      },
    }

    return NextResponse.json(payload)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 })
  }
}


