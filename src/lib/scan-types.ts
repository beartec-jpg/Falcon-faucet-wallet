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
  /** Seat performance score from status (0..1). */
  perf?: number
  /** ms since this seat's last pong seen by the serving node. */
  pong_age_ms?: number
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
    emissionBps?: number | null
    emissionPctPerYear?: number | null
    epochMs?: number | null
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
  /** Per-height committee / lottery fields from status_req (absent on older nodes). */
  committee?: ConsensusInfo
  /** Activated wallets = accounts that exist on the ledger (status.accounts_count). */
  wallets?: { activated: number; source: 'status.accounts_count' }
  watchers?: WatcherSummary
  rails: RailRow[]
  /** Node clock (status.now_ms) at snapshot time, when the node reports it. */
  node_time_ms?: number
  /** False when status carried no cumulative counters (metrics are fallbacks, not data). */
  metrics_ok?: boolean
  metrics: {
    ledgers_sealed: number
    txs_sealed: number
    submit_accepted: number
    fees_burned: number
  }
}

export interface WatcherSummary {
  /** Accounts with slots this epoch (keys of status.watcher_slots). */
  epoch_accounts: string[]
  /** Accounts that heartbeated in the current slot. */
  live: string[]
  /** Cumulative watcher_work per epoch account (bumps = heartbeat landed). */
  work: Record<string, number>
  /** watcher_slots count per epoch account. */
  slots: Record<string, number>
  current_slot: number
  slot_ms: number
  slots_per_epoch: number
  /** 'status' = node field watchers_active_slot; 'slot_counts' = watcher_slots rose this slot. */
  source: 'status' | 'slot_counts'
  checked_at: number
}

export interface ConsensusInfo {
  /** Committee that voted the tip block (status.sealed_committee). */
  sealed_committee: string[]
  /** Committee drawn for the next height (status.next_committee). */
  next_committee: string[]
  /** Round-0 packer for the next height (status.lottery_winner_next). */
  next_packer: string
  /** Backup packer for the next height (status.lottery_standby_next). */
  standby: string
  /** Votes in the tip's cert (status.tip_cert_voters); the node does not say which seats. */
  cert_voters: number | null
  /** Current view-change round at the next height (0 = round-0 packer). */
  view_round: number
}
