/**
 * Portal-side BTC SPV policy (W1/W2 hardening).
 * No node SSH required — used by Bridge UI + claim preflight.
 */

/** Live BitVM2 instance (2300) — Bridge In send-to address + FALC memo. */
export const BITVM2_INSTANCE_ADDRESS =
  'tb1p2xuekx55w9llxe023y070lf32kk0z873nv6pse0awg75ll7l930suzcgn5'
export const BITVM2_INSTANCE_SPK =
  '512051b99b1a94717ff365ea891fe7fd3155acf11fd19b341865fd723d4fffdf2c5f'
/** Even-Y NUMS P2TR vault (rail packed vault). Also accepted for mint proofs. */
export const NUMS_VAULT_ADDRESS =
  'tb1pd6ltq2yu89h37zkwn9jsqcq0svf4pk2upnyf7sfw6rk2v59tkw8sfsdq34'
export const NUMS_VAULT_SPK =
  '51206ebeb0289c396f1f0ace996500600f831350d95c0cc89f412ed0eca650abb38f'
/** Kickoff fee from the instance; dest-lock take fee after CSV. */
export const BITVM2_KICKOFF_FEE_SATS = 1000
export const BITVM2_TAKE_FEE_SATS = 1000
export const BITVM2_CLAIM_CSV = 6
/** Dest-lock must cover take fee + dust. */
export const BITVM2_MIN_PEGOUT_SATS = 2000

/** Retired hold / custody addresses that must never accept new claims */
export const RETIRED_BTC_WATCH_ADDRESSES = [
  // Legacy keyed custody
  'mxuamPnEtoMaiRnBnAUnrCZeXTYPVX4hik',
  // WP4 v2 product hold (migrated)
  'tb1qqxf9h0ytl0valyrmfqq53ws48mq88n8rzxcnkcvt2wg98kh8uj5qtzhm5f',
  // Intermediate v1 P2WSH
  'tb1q40fswfaq0e5nvnmayutp7qw3s0r0ctgy62p48w0k4zq79wx6w27s6ulwpv',
  // Watch-script, not a vault
  'tb1q7dnlzumm50hke3yl75rywds3gtfu2swqwu4xa08kx0ctxs00rv4q8hrkwu',
  // Old Shamir P2WPKH (emptied)
  'tb1qesum00x0jm6w2a0dt5vksckhyt45430c0yg5sj',
  // Odd-Y v1 NUMS — BIP341 unspendable
  'tb1pq9mgl62e4dskkc9h4jxwfsfdt56hn9vl22u9xhqgz2l8jxfpwsascq6098',
  // Old FROST P2TR vault
  'tb1pj9d6d6eaayw7f7hc3mr2lm3xhuscuhtw6kpjqz5jvvuf4mh2lduq2pqytm',
].map((a) => a.toLowerCase())

/** Dust floor (sats) for peg-in / peg-out */
export const BTC_DUST_SATS = 546

/** Header lag thresholds (blocks) */
export const LAG_WARN_BLOCKS = 50
export const LAG_CRITICAL_BLOCKS = 100

export type ConfTier = {
  /** Inclusive max amount in BTC for this tier (Infinity for last) */
  maxBtc: number
  minConfirmations: number
  /** Extra Falcon tip depth beyond deposit height before claim */
  reorgBuffer: number
  label: string
}

/** Value-tiered confirmations (testnet draft — W2) */
export const CONF_TIERS: ConfTier[] = [
  { maxBtc: 0.001, minConfirmations: 3, reorgBuffer: 1, label: 'small' },
  { maxBtc: 0.01, minConfirmations: 6, reorgBuffer: 2, label: 'medium' },
  { maxBtc: Infinity, minConfirmations: 12, reorgBuffer: 3, label: 'large' },
]

export function confTierForSats(amountSats: number): ConfTier {
  const btc = amountSats / 1e8
  for (const t of CONF_TIERS) {
    if (btc <= t.maxBtc) return t
  }
  return CONF_TIERS[CONF_TIERS.length - 1]
}

/**
 * Blocks still required after the deposit before Claim is allowed.
 * Null when the Falcon Bitcoin tip is unknown — do not invent a block.
 */
export function btcReorgBlocksLeft(
  amountSats: number,
  depositHeight?: number | null,
  falconTip?: number | null,
): number | null {
  const height = Number(depositHeight)
  const tip = Number(falconTip)
  if (!Number.isFinite(height) || height <= 0) return null
  if (!Number.isFinite(tip) || tip <= 0) return null
  const buf = confTierForSats(amountSats || 0).reorgBuffer
  return Math.max(0, buf - (tip - height))
}

/** Claim is allowed only after Bitcoin confs and the reorg buffer. */
export function spvClaimReady(p: {
  confirmations: number
  minConfirmations: number
  amountSats: number
  blockHeight?: number | null
  falconBtcTip?: number | null
  lastError?: string
}): boolean {
  if (p.confirmations < p.minConfirmations) return false
  const left = btcReorgBlocksLeft(p.amountSats, p.blockHeight, p.falconBtcTip)
  if (left != null && left > 0) return false
  if (p.lastError && /reorg buffer|before claim turns on|waiting for bitcoin block/i.test(p.lastError)) return false
  return true
}

/** Same shape as the ETH/USDC card: waiting for block Y, currently at X. */
export function btcDepositProgressText(p: {
  confirmations: number
  minConfirmations: number
  amountSats: number
  blockHeight?: number | null
  falconBtcTip?: number | null
  status?: string
}): string {
  if (p.status === 'claimed') return 'Transaction complete.'
  if (p.confirmations < p.minConfirmations) {
    return `Waiting for Bitcoin confirmations. Have ${p.confirmations} of ${p.minConfirmations}.`
  }
  const dep = Number(p.blockHeight)
  const tip = Number(p.falconBtcTip)
  const buf = confTierForSats(p.amountSats || 0).reorgBuffer
  if (Number.isFinite(dep) && dep > 0 && Number.isFinite(tip) && tip > 0) {
    const need = dep + buf
    if (tip < need) {
      const left = need - tip
      const mins = Math.max(1, left * 10)
      return `Waiting for Bitcoin block ${need.toLocaleString()}. This deposit is in block ${dep.toLocaleString()}. Falcon is at block ${tip.toLocaleString()}, ${left} ${left === 1 ? 'block' : 'blocks'} behind (about ${mins} min).`
    }
  }
  if (p.status === 'claiming') return 'Minting FBTC on Falcon.'
  if (p.status === 'ready_to_claim' || (Number.isFinite(tip) && tip > 0 && Number.isFinite(dep) && tip >= dep + buf)) {
    return 'Ready to claim on Falcon.'
  }
  return 'Waiting for Falcon’s Bitcoin tip.'
}

/** Plain wait copy. Null once the buffer has cleared or the tip is unknown. */
export function btcReorgWaitCopy(
  amountSats: number,
  depositHeight?: number | null,
  falconTip?: number | null,
): string | null {
  const text = btcDepositProgressText({
    confirmations: Number.MAX_SAFE_INTEGER,
    minConfirmations: 1,
    amountSats,
    blockHeight: depositHeight,
    falconBtcTip: falconTip,
    status: 'waiting_confs',
  })
  if (text.startsWith('Waiting for Bitcoin block')) return text
  return null
}

/** Protocol min is source of truth on 2300 (live overlay is 1 conf). */
export function effectiveMinConfirmations(
  amountSats: number,
  protocolMin?: number | null,
): number {
  const p = Number(protocolMin)
  if (Number.isFinite(p) && p > 0) return Math.floor(p)
  return confTierForSats(amountSats).minConfirmations
}

export type HeaderLag = {
  falconTip: number | null
  btcTip: number | null
  gap: number | null
  level: 'ok' | 'warn' | 'critical' | 'unknown'
  claimSafe: boolean
  message: string
}

export function evaluateHeaderLag(
  falconTip: number | null | undefined,
  btcTip: number | null | undefined,
): HeaderLag {
  const f = falconTip != null && Number.isFinite(Number(falconTip)) ? Number(falconTip) : null
  const b = btcTip != null && Number.isFinite(Number(btcTip)) ? Number(btcTip) : null
  if (f == null || b == null) {
    return {
      falconTip: f,
      btcTip: b,
      gap: null,
      level: 'unknown',
      claimSafe: false,
      message: 'SPV tip unknown — wait for status refresh before claiming FBTC.',
    }
  }
  const gap = Math.max(0, b - f)
  if (gap >= LAG_CRITICAL_BLOCKS) {
    return {
      falconTip: f,
      btcTip: b,
      gap,
      level: 'critical',
      claimSafe: false,
      message: `Falcon SPV headers are ~${gap.toLocaleString()} blocks behind Bitcoin. Claim FBTC will fail until headers catch up — do not re-send BTC.`,
    }
  }
  if (gap >= LAG_WARN_BLOCKS) {
    return {
      falconTip: f,
      btcTip: b,
      gap,
      level: 'warn',
      claimSafe: true,
      message: `Falcon SPV tip is ~${gap} blocks behind Bitcoin. Prefer deposits already covered by Falcon tip ${f}.`,
    }
  }
  return {
    falconTip: f,
    btcTip: b,
    gap,
    level: 'ok',
    claimSafe: true,
    message: `SPV headers healthy (lag ${gap} blocks).`,
  }
}

export function claimAllowedForDeposit(opts: {
  depositHeight: number
  falconTip: number | null
  btcTip: number | null
  confirmations: number
  amountSats: number
  protocolMinConf?: number | null
}): { ok: boolean; reason?: string; minConf: number; reorgBuffer: number } {
  const tier = confTierForSats(opts.amountSats)
  const minConf = effectiveMinConfirmations(opts.amountSats, opts.protocolMinConf)
  if (opts.confirmations < minConf) {
    return {
      ok: false,
      reason: `Need ${minConf} Bitcoin confirmations for this size (have ${opts.confirmations}).`,
      minConf,
      reorgBuffer: tier.reorgBuffer,
    }
  }
  // Missing Falcon tip must not hard-block a confirmed Bitcoin deposit.
  // PL 2300 claim proof used to pass null here and 409 forever.
  if (opts.falconTip == null) {
    return { ok: true, minConf, reorgBuffer: tier.reorgBuffer }
  }
  if (opts.depositHeight > opts.falconTip) {
    return {
      ok: false,
      reason: `Deposit is in Bitcoin block ${opts.depositHeight}; Falcon SPV tip is only ${opts.falconTip}. Wait for headers.`,
      minConf,
      reorgBuffer: tier.reorgBuffer,
    }
  }
  if (opts.falconTip - opts.depositHeight < tier.reorgBuffer) {
    return {
      ok: false,
      reason: `Waiting reorg buffer (${tier.reorgBuffer} Falcon blocks past deposit height ${opts.depositHeight}; tip ${opts.falconTip}).`,
      minConf,
      reorgBuffer: tier.reorgBuffer,
    }
  }
  return { ok: true, minConf, reorgBuffer: tier.reorgBuffer }
}

export function isRetiredWatchAddress(addr: string | null | undefined): boolean {
  if (!addr) return false
  return RETIRED_BTC_WATCH_ADDRESSES.includes(addr.trim().toLowerCase())
}

/** Addresses the node will accept for BTC RailDeposit mint proofs. */
export function liveBtcWatchAddresses(extra?: string | null): string[] {
  const out = new Set<string>()
  for (const a of [
    BITVM2_INSTANCE_ADDRESS,
    NUMS_VAULT_ADDRESS,
    process.env.BITVM2_INSTANCE_ADDRESS,
    process.env.NUMS_VAULT_ADDRESS,
    extra,
  ]) {
    const t = String(a || '')
      .trim()
      .toLowerCase()
    if (t && !isRetiredWatchAddress(t)) out.add(t)
  }
  return [...out]
}

export function assertLiveWatchAddress(
  paidTo: string | null | undefined,
  expectedWatch: string | null | undefined,
): string | null {
  if (!paidTo) return 'Could not read deposit output address'
  if (isRetiredWatchAddress(paidTo)) {
    return `Deposit paid retired watch address ${paidTo}. This bridge no longer claims those deposits.`
  }
  const allowed = liveBtcWatchAddresses(expectedWatch)
  if (allowed.length && !allowed.includes(paidTo.toLowerCase())) {
    return `Deposit paid ${paidTo}, not a live Falcon BTC watch (${allowed.join(' | ')}).`
  }
  return null
}
