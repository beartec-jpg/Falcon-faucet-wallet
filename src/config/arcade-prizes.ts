/**
 * Arcade top 5: secondary prize for the top five Arcade players, paid at mainnet
 * launch from the builder (dev) pot (proposed; nothing guaranteed).
 */
export const ARCADE_PRIZES = [
  { place: 1, fpl: 1_000_000 },
  { place: 2, fpl: 500_000 },
  { place: 3, fpl: 250_000 },
  { place: 4, fpl: 100_000 },
  { place: 5, fpl: 50_000 },
] as const

export const ARCADE_PRIZES_TOTAL_FPL = ARCADE_PRIZES.reduce((t, x) => t + x.fpl, 0)
