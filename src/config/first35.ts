/**
 * First 35: first-adopter prize seats paid at mainnet launch (proposed; nothing guaranteed).
 * Social links: set here or via the NEXT_PUBLIC_* env vars. A link that is not set is hidden.
 */
export const FIRST35_LINKS = {
  telegram: process.env.NEXT_PUBLIC_FIRST35_TELEGRAM_URL ?? '',
  discord: process.env.NEXT_PUBLIC_FIRST35_DISCORD_URL ?? '',
  x: process.env.NEXT_PUBLIC_FIRST35_X_URL ?? '',
}

export const FIRST35_TIERS = [
  { from: 1, to: 5, fpl: 1_000_000 },
  { from: 6, to: 15, fpl: 500_000 },
  { from: 16, to: 35, fpl: 100_000 },
] as const

export const FIRST35_SEATS = 35
export const FIRST35_TOTAL_FPL = FIRST35_TIERS.reduce((t, x) => t + (x.to - x.from + 1) * x.fpl, 0)
