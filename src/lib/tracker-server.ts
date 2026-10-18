// Server side of the testnet activity tracker. Reads node status, the activity
// index, and faucet claims; caches 60 s. Linked-account data stays in here.

import { arcadeDaysByPlAccount, GAME_SLUGS } from '@/lib/arcade-store'
import { feedbackStore, type ApprovedFeedback } from '@/lib/feedback-store'
import { swapsSince } from '@/lib/swap-log'
import { activityStore, type ActivityStore } from '@/lib/activity-index'
import { pgFaucetSource, type FaucetSource } from '@/lib/faucet-activity'
import { parseExact } from '@/lib/pl-exact-json'
import { plRpc } from '@/lib/pl-rpc'
import { statusExact } from '@/lib/rails-pools-server'
import { ACCOUNT_NAME_RE, accountView, buildTracker, windowStart, type TrackerInput, type TrackerResult } from '@/lib/tracker'

type Obj = Record<string, unknown>

let cache: { at: number; inp: TrackerInput; res: TrackerResult } | null = null
const CACHE_MS = 60_000

export async function trackerData(opts: { store?: ActivityStore; faucet?: FaucetSource; status?: Obj; now?: number } = {}) {
  const now = opts.now ?? Date.now()
  if (!opts.status && cache && now - cache.at < CACHE_MS) return cache
  const store = opts.store ?? activityStore()
  const faucet = opts.faucet ?? pgFaucetSource()
  const since = windowStart(now)
  const [st, activity, events, days, fdays, links, swaps, arcade] = await Promise.all([
    opts.status ? Promise.resolve(opts.status) : statusExact(),
    store.accounts(),
    store.events(),
    store.activeDays(since),
    faucet.days(since),
    faucet.links(since),
    swapsSince(since),
    arcadeDaysByPlAccount('testnet', since),
  ])
  let feedback: ApprovedFeedback[] = []
  try {
    feedback = await feedbackStore().approved()
  } catch (e) {
    console.error('[tracker] feedback', e)
  }
  const inp: TrackerInput = { st, activity, events, days, faucet: fdays, links, swaps, arcade, arcadeGames: GAME_SLUGS.length, feedback, now }
  const out = { at: now, inp, res: buildTracker(inp) }
  if (!opts.status) cache = out
  return out
}

/** Public payload: no IP hashes, no group membership. */
export async function trackerPayload() {
  const { at, res } = await trackerData()
  return { generated_at: at, ...res, board: res.board.slice(0, 100), building: res.building.slice(0, 50) }
}

export async function accountPayload(name: string) {
  if (!ACCOUNT_NAME_RE.test(name)) return null
  const { at, inp, res } = await trackerData()
  let chain: Obj | null = null
  try {
    const r = await plRpc({ type: 'account_query', account: name }, { timeoutMs: 8000 })
    if (r.type !== 'err') {
      const raw = typeof r.raw === 'string' ? r.raw : JSON.stringify(r)
      const body = ((parseExact(raw) as Obj).body ?? {}) as Obj
      if (body.exists !== false) {
        chain = {
          balance: body.balance ?? 0,
          sequence: body.sequence ?? 0,
          account_type: body.account_type ?? null,
          assets: body.assets ?? {},
          lp: body.lp ?? [],
          lend_positions: body.lend_positions ?? [],
        }
      }
    }
  } catch {
    chain = null
  }
  return { generated_at: at, chain, ...accountView(name, inp, res) }
}
