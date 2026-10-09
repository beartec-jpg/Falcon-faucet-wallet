/**
 * Falcon PL 2300 validator onboarding helpers shared by /validator, /validator/apply and
 * /api/pl2300/validators. Designed against the 2.9.62 interfaces (rewards plan A6/A9/A10/A11):
 * validator public key + proof of possession in the Bond tx, admission by Scott's approval
 * (status.approvals), 50,000 FPL minimum bond for new ids, auto-inactive seats.
 * Everything degrades gracefully on 2.9.61 (no approvals / public_key / inactive fields).
 */

export const APPLICATIONS_REPO = 'beartec-jpg/falcon-pl-validators'
export const RELEASES_REPO = 'beartec-jpg/falcon-pl-releases'
export const INSTALL_CMD = 'curl -fsSL https://falcon-ledger.com/install.sh | bash'
export const INSTALL_VALIDATOR_CMD =
  'curl -fsSL https://falcon-ledger.com/install.sh | bash -s -- --validator --id <name> --contact <email-or-handle>'
export const FIRST_VALIDATOR_VERSION = '2.9.62'
export const MIN_BOND_NEW = 50_000
export const LEGACY_MIN_BOND = 1_000
/** Falcon-512 public key: 897 bytes → 1794 hex chars. */
export const FALCON512_PK_HEX = 1794
export const ID_RE = /^[a-z][a-z0-9-]{2,31}$/
const RESERVED = /^(v\d+|faucet|treasury|community|builder|alice|bob|watcher-.*)$/

export type Application = {
  kind: 'falcon-pl-validator-application'
  v: number
  network_id: number
  id: string
  validator_public_key: string
  validator_key_fingerprint: string
  /** Not in v1 applications: `ctl bond-v2` signs the proof of possession at bond time. */
  pop_sig?: string
  pop_message: string
  bond_account: string
  node_version: string
  observer_node_id?: string
  contact: string
  created_at: string
}

export function versionAtLeast(have: string, want: string): boolean {
  const a = have.split('.').map((x) => parseInt(x, 10) || 0)
  const b = want.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return true
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function keyFingerprint(pkHex: string): Promise<string> {
  return pkHex ? (await sha256Hex(pkHex)).slice(0, 16) : ''
}

/** Structural checks only (the chain verifies the PoP when the Bond is applied). */
export async function validateApplication(a: unknown): Promise<{ ok: boolean; errors: string[]; app?: Application }> {
  const errors: string[] = []
  const o = (a ?? {}) as Record<string, unknown>
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
  if (o.kind !== 'falcon-pl-validator-application') errors.push('not a Falcon PL validator application')
  if (o.network_id !== 2300) errors.push(`network_id is ${String(o.network_id)}, expected 2300`)
  const id = s('id')
  if (!ID_RE.test(id)) errors.push('id must be 3–32 chars: a-z, 0-9, "-" (starting with a letter)')
  if (RESERVED.test(id)) errors.push(`id "${id}" is reserved`)
  const pk = s('validator_public_key')
  if (!/^[0-9a-f]+$/.test(pk) || pk.length !== FALCON512_PK_HEX) errors.push('validator_public_key must be a Falcon-512 public key (1794 hex chars)')
  const pop = s('pop_sig')
  if (pop && !/^[0-9a-f]+$/.test(pop)) errors.push('pop_sig must be hex')
  const acct = s('bond_account')
  if (!/^[a-z0-9._-]{2,64}$/.test(acct)) errors.push('bond_account is not a valid account name')
  if (s('pop_message') && s('pop_message') !== `fpl-pop|2300|${id}|${acct}`) errors.push('pop_message does not match id / bond account')
  if (pk) {
    const fp = await keyFingerprint(pk)
    if (s('validator_key_fingerprint') && s('validator_key_fingerprint') !== fp) errors.push('fingerprint does not match the public key')
  }
  return { ok: errors.length === 0, errors, app: errors.length === 0 ? (o as unknown as Application) : undefined }
}

export function decodeAppFragment(hash: string): unknown {
  const m = /(?:^#|&)app=([A-Za-z0-9_-]+)/.exec(hash)
  if (!m) return null
  const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const json = typeof atob === 'function' ? atob(pad) : Buffer.from(pad, 'base64').toString('utf8')
  return JSON.parse(json)
}

/** GitHub issue-form URL (fields prefilled by id). The full JSON is included only if the URL stays short. */
export function applicationIssueUrl(app: Application): { url: string; includesJson: boolean } {
  const base = `https://github.com/${APPLICATIONS_REPO}/issues/new`
  const p = new URLSearchParams({
    template: 'validator-application.yml',
    title: `Validator application: ${app.id}`,
    labels: 'application',
    id: app.id,
    fingerprint: app.validator_key_fingerprint,
    bond_account: app.bond_account,
    contact: app.contact || '',
  })
  const withJson = new URLSearchParams(p)
  withJson.set('application', JSON.stringify(app, null, 2))
  const full = `${base}?${withJson.toString()}`
  if (full.length <= 7500) return { url: full, includesJson: true }
  return { url: `${base}?${p.toString()}`, includesJson: false }
}

export type SeatRow = {
  id: string
  bond: number
  escrow: number | null
  bondAccount: string
  jailed: boolean
  jailCount: number
  inactive: boolean | null
  missedTurns: number | null
  lotteryReady: boolean
  packCount: number
  unbonding: number
  archive: boolean | null
  keyFingerprint: string | null
  online: boolean
}

export type QueueRow = {
  issue: number
  url: string
  title: string
  id: string
  fingerprint: string
  bondAccount: string
  contact: string
  publicKey: string
  createdAt: string
  stage: 'pending' | 'approved' | 'key-mismatch' | 'bonded' | 'active' | 'invalid'
  note: string
}

export type ValidatorsResponse = {
  ok: boolean
  error?: string
  product: string
  networkId: number
  tip: number
  epoch: number
  rewardFormula: string
  onboardingOpen: boolean
  minBondNew: number
  seats: SeatRow[]
  lotteryOrder: string[]
  onlineSeats: string[]
  committeeSize: number
  approvals: { id: string; keyFingerprint: string; expiresHeight: number | null }[]
  queue: QueueRow[]
  queueError?: string
  fetchedAt: number
}

/** Pull "### Heading\n\nvalue" sections out of an issue-form body. */
export function issueFormFields(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /^###\s+(.+?)\s*\n+([\s\S]*?)(?=\n###\s|$)/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const key = m[1].toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    out[key] = m[2].trim()
  }
  return out
}

export function applicationFromIssueBody(body: string): Partial<Application> | null {
  const j = /```(?:json)?\s*(\{[\s\S]*?"falcon-pl-validator-application"[\s\S]*?\})\s*```/.exec(body)
  if (j) {
    try {
      return JSON.parse(j[1]) as Application
    } catch {
      /* fall through */
    }
  }
  const raw = /(\{[\s\S]*"falcon-pl-validator-application"[\s\S]*\})/.exec(body)
  if (raw) {
    try {
      return JSON.parse(raw[1]) as Application
    } catch {
      return null
    }
  }
  return null
}
