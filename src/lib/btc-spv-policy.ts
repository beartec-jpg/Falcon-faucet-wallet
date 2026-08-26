/**
 * Portal-side BTC SPV policy (W1/W2 hardening).
 * No node SSH required — used by Bridge UI + claim preflight.
 */

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

/** Prefer tier mins but never below protocol minConfirmations when set */
export function effectiveMinConfirmations(
  amountSats: number,
  protocolMin?: number | null,
): number {
  const tier = confTierForSats(amountSats)
  const p = Number(protocolMin)
  if (Number.isFinite(p) && p > 0) return Math.max(tier.minConfirmations, p)
  return tier.minConfirmations
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
  if (opts.falconTip == null) {
    return {
      ok: false,
      reason: 'Falcon SPV tip unknown — cannot claim yet.',
      minConf,
      reorgBuffer: tier.reorgBuffer,
    }
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

export function assertLiveWatchAddress(
  paidTo: string | null | undefined,
  expectedWatch: string | null | undefined,
): string | null {
  if (!paidTo) return 'Could not read deposit output address'
  if (isRetiredWatchAddress(paidTo)) {
    return `Deposit paid retired watch address ${paidTo}. This bridge no longer claims those deposits.`
  }
  if (expectedWatch && paidTo.toLowerCase() !== expectedWatch.toLowerCase()) {
    return `Deposit paid ${paidTo}, not live watch ${expectedWatch}.`
  }
  return null
}
