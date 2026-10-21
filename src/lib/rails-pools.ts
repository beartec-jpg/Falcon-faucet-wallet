// Rails (bridges) and Pools (AMM) views for the explorer, built only from the
// PL status_req / account_query the explorer already uses plus the public
// bridge config in /public/config. Anything the node does not expose is
// reported in `gaps` and shown as such, never guessed.

import { big, toFloat } from '@/lib/pl-exact-json'

export type RailAsset = 'USDC' | 'ETH' | 'BTC'
export const RAIL_ASSETS: RailAsset[] = ['USDC', 'ETH', 'BTC']
export const ASSET_DECIMALS: Record<string, number> = { FPL: 0, USDC: 6, ETH: 18, BTC: 8 }
export const ASSET_UNIT: Record<string, string> = { FPL: 'FPL', USDC: 'USDC', ETH: 'ETH', BTC: 'BTC' }

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Obj[]) : [])
const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

export interface AddressRow {
  label: string
  value: string
  /** Block-explorer link, when the address lives on a public chain. */
  href?: string
  source: string
}

export interface Transfer {
  /** Stable id from the chain (deposit_id / note_id). */
  id: string
  kind: 'bridge_in' | 'bridge_out'
  asset: RailAsset
  account: string
  /** Base units, exact. */
  amount: string
  external: string
  status: string
  /** Sepolia block for ETH/USDC mints, when given. */
  ext_block: number | null
}

export interface LeaderRow {
  account: string
  volume: string
  count: number
}

export interface RailView {
  asset: RailAsset
  decimals: number
  addresses: AddressRow[]
  minted: string
  burned: string
  /** Minted − burned: what is outstanding on Falcon (and so locked on the source chain). */
  outstanding: string
  /** BTC only: sats and UTXOs in the vault, from the rail. */
  vault: { sats: number; utxos: number } | null
  deposits: { processed: number; recent: Transfer[] }
  withdrawals: { open: number; list: Transfer[] }
  /** Header chain the rail verifies against. */
  headers: { kind: 'bitcoin' | 'protocol'; tip_height: number; tip_hash: string; count: number; floor: number }
  /** Source-chain light client / relayer view, where exposed. */
  relayer: { label: string; value: string }[]
  fees: { label: string; value: string; source: string }[]
  depositors: { byVolume: LeaderRow[]; byCount: LeaderRow[] }
  gaps: string[]
}

export interface BridgeConfigLike {
  sepolia?: {
    explorer_url?: string
    usdc_token?: string
    bridge?: string
    qc_v3?: string
    claimer?: string
    eth_lock?: string
    usdc_lock?: string
  }
}

export interface RailOptions {
  config?: BridgeConfigLike | null
  /** Bitcoin peg-out policy (site constants that the wallet enforces). */
  btcPolicy?: { kickoffFeeSats: number; minPegoutSats: number; csvBlocks: number }
  /** Extra history from the activity index (older than the node's window). */
  history?: Transfer[]
}

const shortHash = (h: string) => (h.length > 20 ? `${h.slice(0, 10)}…${h.slice(-8)}` : h)
export { shortHash }

function leaderboard(list: Transfer[], top = 10): { byVolume: LeaderRow[]; byCount: LeaderRow[] } {
  const m = new Map<string, { v: bigint; c: number }>()
  for (const t of list) {
    if (!t.account) continue
    const e = m.get(t.account) ?? { v: 0n, c: 0 }
    e.v += big(t.amount)
    e.c += 1
    m.set(t.account, e)
  }
  const rows = [...m.entries()].map(([account, e]) => ({ account, volume: e.v.toString(), count: e.c }))
  const byVolume = [...rows].sort((a, b) => (big(b.volume) > big(a.volume) ? 1 : big(b.volume) < big(a.volume) ? -1 : a.account.localeCompare(b.account))).slice(0, top)
  const byCount = [...rows].sort((a, b) => b.count - a.count || (big(b.volume) > big(a.volume) ? 1 : -1)).slice(0, top)
  return { byVolume, byCount }
}

function dedupe(list: Transfer[]): Transfer[] {
  const seen = new Map<string, Transfer>()
  for (const t of list) if (t.id && !seen.has(t.id)) seen.set(t.id, t)
  return [...seen.values()]
}

export function buildRails(st: Obj, opts: RailOptions = {}): RailView[] {
  const rails = arr(st.rails)
  const cfg = opts.config?.sepolia ?? {}
  const sep = (cfg.explorer_url || 'https://sepolia.etherscan.io').replace(/\/$/, '')
  const resolutions = arr(st.eth_v3_resolutions)
  const lc = obj(st.eth_lc)
  const wSlots = obj(st.watcher_slots)
  const wWork = obj(st.watcher_work)
  const qcBridge = s(st.eth_v3_bridge) || s(cfg.qc_v3)
  return RAIL_ASSETS.map((asset) => {
    const r = rails.find((x) => s(x.asset) === asset) ?? {}
    const dec = ASSET_DECIMALS[asset]
    const minted = big(r.total_minted)
    const burned = big(r.total_burned)
    const gaps: string[] = []

    const withdrawals: Transfer[] = arr(r.withdrawals).map((w) => ({
      id: `out:${s(w.note_id)}`,
      kind: 'bridge_out',
      asset,
      account: s(w.from),
      amount: big(w.amount).toString(),
      external: s(w.external_to),
      status: 'open',
      ext_block: null,
    }))
    // BTC peg-outs also appear as BitVM claims with a status; attach it to the withdrawal.
    if (asset === 'BTC') {
      for (const c of [...arr(r.bitvm2_claims), ...arr(r.bitvm_claims)]) {
        const w = withdrawals.find((x) => x.id === `out:${s(c.note_id)}`)
        if (w && s(c.status)) w.status = s(c.status)
      }
    }
    const minted_in: Transfer[] =
      asset === 'BTC'
        ? []
        : resolutions
            .filter((x) => s(x.asset) === asset && s(x.kind) === 'mint')
            .map((x) => ({
              id: `in:${s(x.deposit_id)}`,
              kind: 'bridge_in' as const,
              asset,
              account: s(x.credit_to),
              amount: big(x.amount).toString(),
              external: '',
              status: 'minted',
              ext_block: n(x.eth_block) || null,
            }))
    const history = (opts.history ?? []).filter((t) => t.asset === asset)
    const allIn = dedupe([...minted_in, ...history.filter((t) => t.kind === 'bridge_in')])

    const addresses: AddressRow[] = []
    if (asset === 'BTC') {
      if (s(r.vault_address)) addresses.push({ label: 'Legacy rail vault (taproot, testnet3)', value: s(r.vault_address), href: `https://mempool.space/testnet/address/${s(r.vault_address)}`, source: 'status.rails[BTC].vault_address' })
      gaps.push('Per-depositor BTC peg-ins are not exposed (the rail lists spent deposit txids only), so the BTC leaderboard is empty.')
    } else {
      if (qcBridge) addresses.push({ label: 'FalconQcBridge V3 (peg-in / claims)', value: qcBridge, href: `${sep}/address/${qcBridge}`, source: 'status.eth_v3_bridge' })
      if (cfg.bridge) addresses.push({ label: 'FalconQcBridge V1 (legacy peg-in)', value: cfg.bridge, href: `${sep}/address/${cfg.bridge}`, source: 'public/config/pl-2300-bridge.json' })
      if (asset === 'USDC' && cfg.usdc_token) addresses.push({ label: 'Sepolia USDC token', value: cfg.usdc_token, href: `${sep}/token/${cfg.usdc_token}`, source: 'public/config/pl-2300-bridge.json' })
      if (cfg.claimer) addresses.push({ label: 'Claimer (relayer)', value: cfg.claimer, href: `${sep}/address/${cfg.claimer}`, source: 'public/config/pl-2300-bridge.json' })
      gaps.push('Bridge fees for ETH/USDC are not exposed by the node.')
      gaps.push('The node lists only V3 deposit resolutions; earlier V1 peg-ins are counted in "processed" but have no depositor, so they are missing from the leaderboard until the activity index saw them.')
    }
    if (s(r.lock_id)) addresses.push({ label: 'Rail lock id', value: s(r.lock_id), source: `status.rails[${asset}].lock_id` })

    const relayer: { label: string; value: string }[] = []
    if (asset === 'BTC') {
      relayer.push({ label: 'BTC headers held', value: `${n(r.header_count).toLocaleString('en-US')} (from #${n(r.header_floor).toLocaleString('en-US')})` })
      relayer.push({ label: 'Header tip', value: `#${n(r.tip_height).toLocaleString('en-US')}` })
    } else {
      relayer.push({ label: 'ETH light client finalized slot', value: n(lc.finalized_slot) ? n(lc.finalized_slot).toLocaleString('en-US') : 'not exposed' })
      relayer.push({ label: 'Sepolia execution tip (light client)', value: n(lc.eth_exec_tip) ? `#${n(lc.eth_exec_tip).toLocaleString('en-US')}` : 'not exposed' })
      relayer.push({ label: 'Light-client sync period', value: n(lc.period) ? String(n(lc.period)) : 'not exposed' })
      const ws = n(wSlots['watcher-eth-lc'])
      relayer.push({ label: 'watcher-eth-lc', value: `${ws} slots this epoch · work ${n(wWork['watcher-eth-lc'])}` })
    }
    gaps.push('Relayer heartbeat timestamps are not exposed; liveness is shown as header / light-client progress.')

    const fees: RailView['fees'] = []
    if (asset === 'BTC' && opts.btcPolicy) {
      fees.push({ label: 'Peg-out kickoff fee', value: `${opts.btcPolicy.kickoffFeeSats.toLocaleString('en-US')} sats`, source: 'BitVM2 peg-out policy (wallet)' })
      fees.push({ label: 'Minimum peg-out', value: `${opts.btcPolicy.minPegoutSats.toLocaleString('en-US')} sats`, source: 'BitVM2 peg-out policy (wallet)' })
      fees.push({ label: 'Exit CSV', value: `${opts.btcPolicy.csvBlocks} blocks`, source: 'BitVM2 peg-out policy (wallet)' })
    }

    return {
      asset,
      decimals: dec,
      addresses,
      minted: minted.toString(),
      burned: burned.toString(),
      outstanding: (minted - burned).toString(),
      vault: asset === 'BTC' ? { sats: n(r.vault_sats), utxos: n(r.vault_utxos) } : null,
      deposits: { processed: arr(r.spent_deposits).length || (Array.isArray(r.spent_deposits) ? r.spent_deposits.length : 0), recent: allIn.slice(-20).reverse() },
      withdrawals: { open: n(r.open_withdrawals), list: withdrawals },
      headers: { kind: s(r.spv) === 'bitcoin' ? 'bitcoin' : 'protocol', tip_height: n(r.tip_height), tip_hash: s(r.tip_hash), count: n(r.header_count), floor: n(r.header_floor) },
      relayer,
      fees,
      depositors: leaderboard(allIn),
      gaps,
    }
  })
}

// ── Pools ──────────────────────────────────────────────────────────────────

export interface LpPosition {
  account: string
  pool_id: string
  lp: string
}

export interface PoolSample {
  pool_id: string
  at: number
  reserve_a: string
  reserve_b: string
  lp_supply: string
}

export interface InferredSwap {
  pool_id: string
  at: number
  /** 'buy' = FPL in, asset out. 'sell' = asset in, FPL out. */
  side: 'buy' | 'sell'
  fpl: number
  asset: number
}

export interface PoolView {
  id: string
  asset_a: string
  asset_b: string
  decimals_b: number
  reserve_a: string
  reserve_b: string
  lp_supply: string
  /** FPL per 1 whole asset_b, from reserves. */
  price_fpl: number | null
  /** 2 × FPL reserve (constant-product pool). */
  tvl_fpl: number
  lp_count: number
  top_lps: { account: string; lp: string; share: number }[]
  /** From the activity index's 5-min reserve samples (lower bound: swaps within one interval net out). */
  volume_24h_fpl: number | null
  /** LP value growth per LP share over the samples' window (fees accrue to LPs). */
  lp_growth_24h: number | null
  swaps_window_h: number
  recent_swaps: InferredSwap[]
  gaps: string[]
}

/** Swaps between consecutive samples: LP supply unchanged and reserves moved in opposite directions. */
export function inferSwaps(samples: PoolSample[], decByPool: Record<string, number> = {}): InferredSwap[] {
  const out: InferredSwap[] = []
  const byPool = new Map<string, PoolSample[]>()
  for (const x of samples) (byPool.get(x.pool_id) ?? byPool.set(x.pool_id, []).get(x.pool_id)!).push(x)
  for (const [pool, list] of byPool) {
    list.sort((a, b) => a.at - b.at)
    const dec = decByPool[pool] ?? ASSET_DECIMALS[pool.split('-')[0].toUpperCase()] ?? 0
    for (let i = 1; i < list.length; i++) {
      const p = list[i - 1]
      const c = list[i]
      if (big(p.lp_supply) !== big(c.lp_supply)) continue
      const da = big(c.reserve_a) - big(p.reserve_a)
      const db = big(c.reserve_b) - big(p.reserve_b)
      if (da === 0n || db === 0n || (da > 0n) === (db > 0n)) continue
      out.push({
        pool_id: pool,
        at: c.at,
        side: da > 0n ? 'buy' : 'sell',
        fpl: Math.abs(Number(da)),
        asset: Math.abs(toFloat(db < 0n ? -db : db, dec)),
      })
    }
  }
  return out.sort((a, b) => b.at - a.at)
}

/** √(reserve_a·reserve_b) per LP share; grows only through fees. */
export function lpValue(x: Pick<PoolSample, 'reserve_a' | 'reserve_b' | 'lp_supply'>, decB: number): number | null {
  const lp = toFloat(x.lp_supply, 0)
  if (!(lp > 0)) return null
  return Math.sqrt(toFloat(x.reserve_a, 0) * toFloat(x.reserve_b, decB)) / lp
}

export function buildPools(st: Obj, positions: LpPosition[], samples: PoolSample[] = [], now = Date.now()): PoolView[] {
  const decByPool = Object.fromEntries(arr(st.defi_pools).map((p) => [s(p.id), ASSET_DECIMALS[s(p.asset_b)] ?? 0]))
  const swaps = inferSwaps(samples, decByPool)
  return arr(st.defi_pools).map((p) => {
    const id = s(p.id)
    const b = s(p.asset_b)
    const decB = ASSET_DECIMALS[b] ?? 0
    const ra = big(p.reserve_a)
    const rb = big(p.reserve_b)
    const lps = big(p.lp_supply)
    const rbF = toFloat(rb, decB)
    const price = rbF > 0 ? Number(ra) / rbF : null
    const holders = positions.filter((x) => x.pool_id === id && big(x.lp) > 0n)
    const top = holders
      .map((h) => ({ account: h.account, lp: big(h.lp).toString(), share: lps > 0n ? toFloat((big(h.lp) * 1_000_000n) / lps, 6) : 0 }))
      .sort((x, y) => y.share - x.share)
    const mine = samples.filter((x) => x.pool_id === id).sort((x, y) => x.at - y.at)
    const day = mine.filter((x) => x.at >= now - 24 * 3600_000)
    const poolSwaps = swaps.filter((x) => x.pool_id === id)
    const daySwaps = poolSwaps.filter((x) => x.at >= now - 24 * 3600_000)
    const vol = day.length >= 2 ? daySwaps.reduce((acc, x) => acc + x.fpl, 0) : null
    const v0 = day.length >= 2 ? lpValue(day[0], decB) : null
    const v1 = day.length >= 2 ? lpValue(day[day.length - 1], decB) : null
    const gaps = [
      'Individual swaps and swappers are not exposed by the node (account recent_txs is empty), so there is no top-swappers board.',
      'Pool fee rate is not exposed; fees are shown as LP value growth per share.',
    ]
    if (!(lps > 0n)) gaps.unshift('Pool is empty (no liquidity).')
    return {
      id,
      asset_a: s(p.asset_a),
      asset_b: b,
      decimals_b: decB,
      reserve_a: ra.toString(),
      reserve_b: rb.toString(),
      lp_supply: lps.toString(),
      price_fpl: price,
      tvl_fpl: Number(ra) * 2,
      lp_count: holders.length,
      top_lps: top.slice(0, 10),
      volume_24h_fpl: vol,
      lp_growth_24h: v0 && v1 ? v1 / v0 - 1 : null,
      swaps_window_h: day.length >= 2 ? (day[day.length - 1].at - day[0].at) / 3600_000 : 0,
      recent_swaps: poolSwaps.slice(0, 20),
      gaps,
    }
  })
}

/** Accounts worth an account_query for LP / lending positions: everyone the node lists in a weight map. */
export function lpCandidates(st: Obj): string[] {
  const rw = obj(st.rewards_v2)
  const keys = [obj(st.amm_lp_weights), obj(st.lend_lp_weights), obj(rw.amm_lp_value_weights), obj(rw.lend_lp_value_weights)].flatMap((m) => Object.keys(m))
  return [...new Set(keys)].sort()
}
