/**
 * FalconQcBridgeV2 / V3 claim routing for the site (pure helpers, no network).
 *
 * walletd picks the bridge for each note and returns it as `bridge` + `bridgeVersion`
 * on eth-open-claim (and on the 409 "waiting" answer). The site calls take() on that
 * bridge, never on a fixed address, but only if it is one this site knows:
 *   - v2: must equal the configured FalconQcBridgeV2 (`legacy_qc_v2`). V2-committed notes
 *     stay on V2; there is no V3 fallback for them.
 *   - v3: must equal the configured FalconQcBridgeV3 (`qc_v3`, or NEXT_PUBLIC_QC_V3_BRIDGE).
 *     Unset means V3 is not live on this site and nothing is sent to it.
 * A walletd that predates V3 routing returns neither field; that is V2. Exactly one of
 * the two fields is malformed and refused.
 *
 * V3 refunds: refund note id = sha256("refund|" || depositId), the same bytes as
 * FalconQcBridgeV3.refundNoteId. Only the deposit sender can take() a refund.
 */

import { concat, getBytes, sha256, toUtf8Bytes } from 'ethers'
import type { Pl2300BridgeConfig } from '@/lib/pl-dest-lock'

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/
const ID_RE = /^(0[xX])?[a-fA-F0-9]{64}$/

export type BridgeVersion = 'v2' | 'v3'

/** eth-open-claim answer from walletd (200 ready/sent, or 409 waiting). */
export type OpenClaimResponse = {
  ok?: boolean
  tx?: string
  waiting?: boolean
  retryable?: boolean
  status?: string
  message?: string
  error?: string
  noteId?: string
  fplHeight?: number
  bridge?: string
  bridgeVersion?: string
  kind?: string
  depositId?: string
  mode?: string
  /** walletd found the note already open on `bridge` and sent nothing (tx is ""). */
  alreadyOpen?: boolean
  /** With alreadyOpen: claims(note).taken on `bridge` (missing = unknown, re-read on chain). */
  taken?: boolean
  /** With alreadyOpen: claims(note).dest on `bridge`. */
  dest?: string
}

/** What to do after eth-open-claim succeeded (openClaimDone). */
export type TakeAction = 'take' | 'skip' | 'read'

/**
 * - fresh openClaim tx → take
 * - alreadyOpen + taken: true → skip (already paid; take() would revert)
 * - alreadyOpen + taken: false + a dest → take on the returned bridge (dest checked by caller)
 * - alreadyOpen without a boolean taken, or without a dest → read claims(note) on that bridge first
 */
export function takeActionAfterOpen(resp: Pick<OpenClaimResponse, 'alreadyOpen' | 'taken' | 'dest'>): TakeAction {
  if (resp.alreadyOpen !== true) return 'take'
  if (resp.taken === true) return 'skip'
  if (resp.taken === false && (resp.dest ?? '').trim()) return 'take'
  return 'read'
}

/** An open claim is takeable only by its recorded dest; refuse before a reverting take(). */
export function assertClaimDest(claimDest: string | undefined, signer: string): void {
  const d = (claimDest ?? '').trim()
  if (!d) return
  if (!ADDR_RE.test(d)) throw new Error('walletd returned a malformed claim dest')
  if (!sameAddr(d, signer)) {
    throw new Error(`This claim pays ${d}, not this wallet (${signer}); only that address can take() it.`)
  }
}

/**
 * True when eth-open-claim leaves the claim open on walletd's bridge: a fresh openClaim tx,
 * or `{ok: true, tx: "", alreadyOpen: true}` (already open there, e.g. a racing request).
 * Either way the next step is take() on the returned bridge (resolveTakeBridge).
 */
export function openClaimDone(httpOk: boolean, resp: OpenClaimResponse): boolean {
  if (!httpOk || resp.ok === false || resp.waiting) return false
  return Boolean(resp.tx) || resp.alreadyOpen === true
}

function sameAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** Configured FalconQcBridgeV2 (`legacy_qc_v2`) if it is a valid address, else null. No fallback
 *  to `sepolia.bridge`: take() routing must never land on the peg-in / V1 address. */
export function qcV2Bridge(cfg: Pl2300BridgeConfig | null | undefined): string | null {
  const v2 = cfg?.sepolia?.legacy_qc_v2?.trim() ?? ''
  return ADDR_RE.test(v2) ? v2 : null
}

/** Configured FalconQcBridgeV3, or null while V3 is not live on this site. */
export function qcV3Bridge(cfg: Pl2300BridgeConfig | null | undefined, envValue?: string): string | null {
  const fromCfg = cfg?.sepolia?.qc_v3?.trim() ?? ''
  if (ADDR_RE.test(fromCfg)) return fromCfg
  const env =
    envValue ?? (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_QC_V3_BRIDGE ?? '' : '')
  const e = env.trim()
  return ADDR_RE.test(e) ? e : null
}

/**
 * The bridge to call take() on, from walletd's answer.
 * Throws instead of guessing: an unknown version, an address that is not the configured
 * bridge for that version, or V3 while this site has no V3 address.
 */
export function resolveTakeBridge(
  resp: Pick<OpenClaimResponse, 'bridge' | 'bridgeVersion'>,
  v2Bridge: string | null,
  v3Bridge: string | null,
): { bridge: string; version: BridgeVersion } {
  const needV2 = (): string => {
    if (!v2Bridge || !ADDR_RE.test(v2Bridge)) {
      throw new Error('This claim is on FalconQcBridgeV2, but legacy_qc_v2 is not configured on this site; not calling take()')
    }
    return v2Bridge
  }
  const addr = (resp.bridge ?? '').trim()
  const ver = (resp.bridgeVersion ?? '').trim().toLowerCase()
  if (addr && !ADDR_RE.test(addr)) throw new Error(`walletd returned a malformed bridge address (${addr.slice(0, 12)}…)`)
  if (!ver && !addr) {
    // walletd before V2/V3 routing: every claim is V2.
    return { bridge: needV2(), version: 'v2' }
  }
  // Routing walletd always sends both fields; a partial answer is malformed, not a hint.
  if (!ver || !addr) {
    throw new Error('walletd returned partial bridge routing (bridge and bridgeVersion must both be set); not calling take()')
  }
  if (ver === 'v2') {
    const v2 = needV2()
    if (!sameAddr(addr, v2)) {
      throw new Error(`walletd named V2 bridge ${addr} but this site's FalconQcBridgeV2 is ${v2}; not calling take()`)
    }
    return { bridge: v2, version: 'v2' }
  }
  if (ver === 'v3') {
    if (!v3Bridge) {
      throw new Error('This claim is on FalconQcBridgeV3, which is not configured on this site yet; not calling take()')
    }
    if (!sameAddr(addr, v3Bridge)) {
      throw new Error(`walletd named V3 bridge ${addr} but this site's FalconQcBridgeV3 is ${v3Bridge}; not calling take()`)
    }
    return { bridge: v3Bridge, version: 'v3' }
  }
  throw new Error(`walletd returned an unknown bridgeVersion "${resp.bridgeVersion}"`)
}

/** 0x + 64 lowercase hex, or throws. */
export function parseDepositId(raw: string): string {
  const s = raw.trim()
  if (!ID_RE.test(s)) throw new Error('Deposit id must be 32-byte hex (0x + 64 hex characters)')
  return '0x' + s.replace(/^0x/i, '').toLowerCase()
}

/** sha256("refund|" || depositId), as FalconQcBridgeV3.refundNoteId. */
export function v3RefundNoteId(depositId: string): string {
  return sha256(concat([toUtf8Bytes('refund|'), getBytes(parseDepositId(depositId))]))
}

/** A refund pays only the original deposit sender, and only that address can take(). */
export function assertRefundSigner(refundDest: string, signer: string): void {
  if (!ADDR_RE.test(refundDest)) throw new Error('Refund note has no valid sender address')
  if (!sameAddr(refundDest, signer)) {
    throw new Error(
      `This refund pays only the deposit sender ${refundDest}. Use the wallet that made the deposit (this one is ${signer}).`,
    )
  }
}
