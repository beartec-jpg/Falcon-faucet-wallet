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

/** Unified mesh head — same height / peers / commit everywhere. */
export interface MeshHead {
  height: number
  peers: number
  commit: string
  commit_need: number
  committee_size: number
  product_version: string
  online_seats: string[]
  server_state: 'live' | 'degraded'
}

export interface ScanData extends MeshHead {
  product: string
  ticker: string
  consensus: string
  network_id: number
  server_version: string
  uptime_seconds: number
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
  rails: RailRow[]
  metrics: {
    ledgers_sealed: number
    txs_sealed: number
    submit_accepted: number
    fees_burned: number
  }
}
