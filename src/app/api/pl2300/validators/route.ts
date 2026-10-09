import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { plRpc } from '@/lib/pl-rpc'
import { num, str } from '@/lib/pl-mesh'
import {
  APPLICATIONS_REPO,
  FIRST_VALIDATOR_VERSION,
  LEGACY_MIN_BOND,
  MIN_BOND_NEW,
  applicationFromIssueBody,
  issueFormFields,
  versionAtLeast,
  type QueueRow,
  type SeatRow,
  type ValidatorsResponse,
} from '@/lib/pl-validators'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fp = (pk: unknown) =>
  typeof pk === 'string' && pk ? createHash('sha256').update(pk).digest('hex').slice(0, 16) : null

type Approval = { publicKey: string; expiresHeight: number | null }

function approvalsOf(st: Record<string, unknown>): Map<string, Approval> {
  const out = new Map<string, Approval>()
  const a = st.approvals
  if (a && typeof a === 'object' && !Array.isArray(a)) {
    for (const [id, v] of Object.entries(a as Record<string, unknown>)) {
      if (typeof v === 'string') out.set(id, { publicKey: v, expiresHeight: null })
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>
        out.set(id, { publicKey: str(o.public_key), expiresHeight: o.expires_height == null ? null : num(o.expires_height) })
      }
    }
  }
  return out
}

async function fetchQueue(
  seats: Map<string, SeatRow>,
  approvals: Map<string, Approval>,
): Promise<{ queue: QueueRow[]; error?: string }> {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'falcon-ledger-site' }
  const tok = process.env.GITHUB_APPLICATIONS_TOKEN?.trim()
  if (tok) headers.authorization = `Bearer ${tok}`
  let r: Response
  try {
    r = await fetch(
      `https://api.github.com/repos/${APPLICATIONS_REPO}/issues?state=open&labels=application&per_page=50`,
      { headers, next: { revalidate: 60 } },
    )
  } catch (e) {
    return { queue: [], error: `GitHub unreachable: ${String(e instanceof Error ? e.message : e)}` }
  }
  if (r.status === 404) return { queue: [], error: `applications repo ${APPLICATIONS_REPO} not found (not created yet)` }
  if (!r.ok) return { queue: [], error: `GitHub ${r.status}` }
  const issues = (await r.json()) as { number: number; html_url: string; title: string; body: string | null; created_at: string; pull_request?: unknown }[]
  const queue: QueueRow[] = []
  for (const is of issues) {
    if (is.pull_request) continue
    const body = is.body ?? ''
    const f = issueFormFields(body)
    const app = applicationFromIssueBody(body) ?? {}
    const id = str(app.id || f.validator_id || f.id).trim().toLowerCase()
    const pk = str(app.validator_public_key).trim().toLowerCase()
    const fingerprint = pk ? (fp(pk) ?? '') : str(app.validator_key_fingerprint || f.key_fingerprint || f.fingerprint)
    let stage: QueueRow['stage'] = 'pending'
    let note = ''
    const seat = seats.get(id)
    const ap = approvals.get(id)
    if (!id || !/^[a-z][a-z0-9-]{2,31}$/.test(id)) {
      stage = 'invalid'
      note = 'no valid id in the issue'
    } else if (seat) {
      stage = seat.lotteryReady && !seat.jailed && seat.inactive !== true ? 'active' : 'bonded'
      if (seat.keyFingerprint && seat.keyFingerprint !== 'set' && fingerprint && seat.keyFingerprint !== fingerprint) note = 'on-chain key differs from the application'
    } else if (ap) {
      stage = pk && ap.publicKey && ap.publicKey.toLowerCase() !== pk ? 'key-mismatch' : 'approved'
      if (ap.expiresHeight != null) note = `approval expires at height ${ap.expiresHeight}`
    } else if (!pk) {
      note = 'application JSON missing: ask the applicant to paste application.json'
    }
    queue.push({
      issue: is.number,
      url: is.html_url,
      title: is.title,
      id,
      fingerprint,
      bondAccount: str(app.bond_account || f.bond_account),
      contact: str(app.contact || f.contact),
      publicKey: pk,
      createdAt: is.created_at,
      stage,
      note,
    })
  }
  return { queue }
}

export async function GET() {
  try {
    const r = await plRpc({ type: 'status_req', include_accounts: false }, { timeoutMs: 10_000 })
    if (r.type === 'err') throw new Error(r.msg || 'status error')
    const st = (r.body ?? {}) as Record<string, unknown>
    const product = str(st.product_version)
    const online = Array.isArray(st.online_seats) ? (st.online_seats as unknown[]).map(String) : []
    const seats = new Map<string, SeatRow>()
    for (const v of (Array.isArray(st.validators) ? st.validators : []) as Record<string, unknown>[]) {
      const id = str(v.id)
      // 2.9.62 nests the rewards-v2 seat fields under `v2` (public key is reported as public_key_set only).
      const v2 = (v.v2 && typeof v.v2 === 'object' ? v.v2 : {}) as Record<string, unknown>
      const pick = (k: string) => (v2[k] !== undefined ? v2[k] : v[k])
      seats.set(id, {
        id,
        bond: num(v.bond),
        escrow: pick('escrow') == null ? null : num(pick('escrow')),
        bondAccount: str(v.bond_account),
        jailed: Boolean(v.jailed),
        jailCount: num(v.jail_count),
        inactive: pick('inactive') == null ? null : Boolean(pick('inactive')),
        missedTurns: pick('missed_turns') == null ? null : num(pick('missed_turns')),
        lotteryReady: Boolean(v.lottery_ready),
        packCount: num(v.pack_count),
        unbonding: num(v.unbonding),
        archive: pick('archive') == null ? null : Boolean(pick('archive')),
        keyFingerprint: fp(v.public_key) ?? (v2.public_key_set === true ? 'set' : null),
        online: online.includes(id),
      })
    }
    const approvals = approvalsOf(st)
    // Onboarding opens only when (a) the network runs the 2.9.62 bond rules and has passed their activation
    // height, and (b) the operator switches it on (PL_VALIDATOR_ONBOARDING=open, set once every seat has a
    // public endpoint; same switch as VALIDATOR_ONBOARDING in the release network profile).
    const actH = num(st.rewards_v2_from_height)
    const chainReady =
      versionAtLeast(product, FIRST_VALIDATOR_VERSION) && 'approvals' in st && actH > 0 && num(st.tip_height) >= actH
    const onboardingOpen = chainReady && process.env.PL_VALIDATOR_ONBOARDING === 'open'
    const { queue, error: queueError } = await fetchQueue(seats, approvals)
    const sorted = [...seats.values()].sort(
      (a, b) => Number(a.jailed) - Number(b.jailed) || a.id.localeCompare(b.id, 'en', { numeric: true }),
    )
    const body: ValidatorsResponse = {
      ok: true,
      product,
      networkId: num(st.network_id),
      tip: num(st.tip_height),
      epoch: num(st.epoch),
      rewardFormula: str(st.reward_formula, 'v1'),
      onboardingOpen,
      minBondNew: chainReady ? num(st.min_bond_new, MIN_BOND_NEW) : LEGACY_MIN_BOND,
      seats: sorted,
      lotteryOrder: Array.isArray(st.lottery_order) ? (st.lottery_order as unknown[]).map(String) : [],
      onlineSeats: online,
      committeeSize: num(st.committee_size, 6),
      approvals: [...approvals.entries()].map(([id, a]) => ({
        id,
        keyFingerprint: fp(a.publicKey) ?? '',
        expiresHeight: a.expiresHeight,
      })),
      queue,
      queueError,
      fetchedAt: Date.now(),
    }
    return NextResponse.json(body, { headers: { 'cache-control': 'public, s-maxage=15, stale-while-revalidate=30' } })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e instanceof Error ? e.message : e) },
      { status: 503 },
    )
  }
}
