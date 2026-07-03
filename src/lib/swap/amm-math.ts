/**
 * AMM constant-product swap math (XLS-30).
 * tradingFee units: 1/100_000 of input (e.g. 500 = 0.5%).
 */

export function ammAmountOut(
  reserveIn: number,
  reserveOut: number,
  amountIn: number,
  tradingFee: number,
): number {
  if (amountIn <= 0 || reserveIn <= 0 || reserveOut <= 0) return 0
  const feeMul = 1 - tradingFee / 100_000
  const inAfterFee = amountIn * feeMul
  return (reserveOut * inAfterFee) / (reserveIn + inAfterFee)
}

export function ammAmountIn(
  reserveIn: number,
  reserveOut: number,
  amountOut: number,
  tradingFee: number,
): number {
  if (amountOut <= 0 || reserveOut <= amountOut || reserveIn <= 0) return 0
  const feeMul = 1 - tradingFee / 100_000
  const numerator = reserveIn * amountOut
  const denominator = (reserveOut - amountOut) * feeMul
  if (denominator <= 0) return 0
  return numerator / denominator
}

export function applySlippage(amount: number, slippageBps: number, direction: 'min' | 'max'): number {
  const mul = slippageBps / 10_000
  return direction === 'min' ? amount * (1 - mul) : amount * (1 + mul)
}