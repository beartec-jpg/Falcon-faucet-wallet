/** Minimum size shown on the public order book (smaller = partial-fill dust). */
export const MIN_BOOK_USDC = 0.01
export const MIN_BOOK_FALCON = 0.01

export function isDustOffer(amountToken: number, amountXrp: number): boolean {
  return amountToken < MIN_BOOK_USDC || amountXrp < MIN_BOOK_FALCON
}

/** Format ledger amounts without rounding tiny remainders to 0.00 */
export function fmtOfferAmount(n: number, bookView = false): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (bookView && n < MIN_BOOK_USDC) return '<0.01'
  if (n >= 100) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (n >= 0.01) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  if (n >= 0.000001) return n.toLocaleString(undefined, { maximumFractionDigits: 8 })
  return n.toExponential(2)
}