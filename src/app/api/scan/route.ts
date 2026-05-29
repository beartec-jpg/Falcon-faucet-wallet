// GET /api/scan
// Returns a full suite of network stats for the explorer page.

import { NextResponse } from 'next/server'
import { DEFAULT_RPC_URL } from '@/lib/rpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Public RPC only (Node 1 full-history recommended)
const RPC = process.env.XRPLD_RPC_URL ?? DEFAULT_RPC_URL

async function rpc<T = Record<string, unknown>>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(RPC, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ method, params: [params] }),
    cache:   'no-store',
  })
  if (!res.ok) throw new Error(`RPC ${res.status}`)
  const body = await res.json()
  return body.result as T
}

export interface ValidatorEntry {
  pubkey:       string
  ledger_index: number
  vote_hash?:   string
}

export interface LedgerSummary {
  seq:           number
  hash:          string
  txn_count:     number
  close_time_human: string
  total_coins?:  string
  base_fee?:     number
  close_time:    number
}

export interface TxSummary {
  hash:             string
  type:             string
  account:          string
  destination?:     string
  amount?:          string
  fee:              string
  ledger_index:     number
  result:           string
  date?:            number
}

export interface ScanData {
  // Network overview
  server_state:       string
  uptime_seconds:     number
  complete_ledgers:   string
  peers:              number
  load_factor:        number
  load_base:          number
  server_version:     string

  // Ledger stats
  validated_ledger:   number
  close_time_human:   string
  total_coins:        string   // drops
  reserve_base:       number   // drops
  reserve_inc:        number   // drops
  base_fee_xrp:       number

  // Fee / queue
  current_fee_drops:  number
  median_fee_drops:   number
  open_ledger_fee:    number
  tx_queue_size:      number

  // Recent ledgers (last 10)
  recent_ledgers:     LedgerSummary[]

  // Recent transactions (last 20 from latest ledger)
  recent_txs:         TxSummary[]

  // Validators on UNL
  validators:         ValidatorEntry[]

  // TPS estimate (avg over last 10 ledgers)
  tps_estimate:       number
  avg_txs_per_ledger: number
  avg_close_seconds:  number
}

// Ripple epoch offset
const RIPPLE_EPOCH = 946684800

function rippleToIso(rippleTime: number): string {
  if (!rippleTime) return ''
  return new Date((rippleTime + RIPPLE_EPOCH) * 1000).toISOString()
}

export async function GET() {
  try {
    // ── Parallel: server_info + fee + validators ───────────────────────────
    const [srvR, feeR, valR] = await Promise.all([
      rpc<{ info: Record<string, unknown> }>('server_info', {}),
      rpc<Record<string, unknown>>('fee', {}),
      rpc<{ validators: ValidatorEntry[] }>('validators', {}),
    ])

    const info    = srvR.info as Record<string, unknown>
    const valLedger = info.validated_ledger as Record<string, unknown>
    const valSeq: number = (valLedger?.seq as number) ?? 0

    // ── Fetch last 10 ledgers ──────────────────────────────────────────────
    const ledgerNums = Array.from({ length: 10 }, (_, i) => valSeq - i).filter(s => s > 0)
    const ledgerResults = await Promise.all(
      ledgerNums.map(seq =>
        rpc<{ ledger: Record<string, unknown> }>('ledger', {
          ledger_index: seq,
          transactions: true,
          expand: false,
        }).catch(() => null),
      ),
    )

    const recentLedgers: LedgerSummary[] = ledgerResults
      .filter(Boolean)
      .map(r => {
        const l = r!.ledger
        const txns = (l.transactions as string[] | undefined) ?? []
        return {
          seq:              l.seqNum as number ?? l.ledger_index as number ?? 0,
          hash:             (l.hash ?? l.ledger_hash ?? '') as string,
          txn_count:        txns.length,
          close_time_human: rippleToIso(l.close_time as number),
          total_coins:      (l.totalCoins ?? l.total_coins ?? '') as string,
          base_fee:         l.base_fee as number | undefined,
          close_time:       l.close_time as number,
        }
      })

    // ── Fetch recent TXs from latest ledger ───────────────────────────────
    let recentTxs: TxSummary[] = []
    const latestFull = await rpc<{ ledger: Record<string, unknown> }>('ledger', {
      ledger_index: valSeq,
      transactions: true,
      expand:       true,
    }).catch(() => null)

    if (latestFull?.ledger) {
      const txList = (latestFull.ledger.transactions as Record<string, unknown>[]) ?? []
      recentTxs = txList.slice(0, 20).map(t => {
        const meta = t.metaData as Record<string, unknown> ?? t.meta as Record<string, unknown> ?? {}
        return {
          hash:         (t.hash ?? '') as string,
          type:         (t.TransactionType ?? 'Unknown') as string,
          account:      (t.Account ?? '') as string,
          destination:  t.Destination as string | undefined,
          amount:       t.Amount as string | undefined,
          fee:          (t.Fee ?? '0') as string,
          ledger_index: valSeq,
          result:       (meta.TransactionResult ?? '') as string,
          date:         t.date as number | undefined,
        }
      })
    }

    // ── TPS / close time estimates ────────────────────────────────────────
    let totalTxs     = 0
    let totalSeconds = 0
    const sorted = [...recentLedgers].sort((a, b) => a.seq - b.seq)
    for (let i = 1; i < sorted.length; i++) {
      totalTxs     += sorted[i].txn_count
      const dt      = (sorted[i].close_time ?? 0) - (sorted[i - 1].close_time ?? 0)
      if (dt > 0 && dt < 30) totalSeconds += dt
    }
    const avgClose  = sorted.length > 1 ? totalSeconds / (sorted.length - 1) : 3
    const avgTxPerL = sorted.length > 1 ? totalTxs     / (sorted.length - 1) : 0
    const tps       = avgClose > 0 ? avgTxPerL / avgClose : 0

    // ── Fee data ─────────────────────────────────────────────────────────
    const drops       = feeR.drops as Record<string, unknown> ?? {}
    const openFeeDrops = parseInt((drops.open_ledger_fee  ?? drops.base_fee ?? '12') as string, 10)
    const medFeeDrops  = parseInt((drops.median_fee       ?? drops.base_fee ?? '12') as string, 10)
    const curFeeDrops  = parseInt((drops.minimum_fee      ?? '12')                   as string, 10)
    const txQueue      = (feeR.current_queue_size as number) ?? 0

    return NextResponse.json({
      server_state:       info.server_state as string,
      uptime_seconds:     info.uptime as number ?? 0,
      complete_ledgers:   info.complete_ledgers as string ?? '',
      peers:              info.peers as number ?? 0,
      load_factor:        info.load_factor as number ?? 1,
      load_base:          info.load_base as number ?? 256,
      server_version:     (info.build_version ?? info.version ?? '') as string,

      validated_ledger:   valSeq,
      close_time_human:   rippleToIso(valLedger?.close_time as number),
      total_coins:        (valLedger?.base_xrp ?? '') as string,
      reserve_base:       (valLedger?.reserve_base ?? 0) as number,
      reserve_inc:        (valLedger?.reserve_inc  ?? 0) as number,
      base_fee_xrp:       (valLedger?.base_fee_xrp ?? 0.000012) as number,

      current_fee_drops:  curFeeDrops,
      median_fee_drops:   medFeeDrops,
      open_ledger_fee:    openFeeDrops,
      tx_queue_size:      txQueue,

      recent_ledgers:     recentLedgers,
      recent_txs:         recentTxs,
      validators:         valR.validators ?? [],

      tps_estimate:       Math.round(tps * 100) / 100,
      avg_txs_per_ledger: Math.round(avgTxPerL * 10) / 10,
      avg_close_seconds:  Math.round(avgClose * 10) / 10,
    } satisfies ScanData)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 })
  }
}
