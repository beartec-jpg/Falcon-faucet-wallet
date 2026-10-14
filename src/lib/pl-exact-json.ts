// PL status lines carry 18-decimal amounts (wei) that overflow a JS number.
// Parse with every integer of 16+ digits kept as a string, and do maths in BigInt.

/** JSON.parse, but integers with ≥ 16 digits become strings (exact). */
export function parseExact(line: string): unknown {
  return JSON.parse(line.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"'))
}

/** Exact integer from a number or digit string; 0 for anything else. */
export function big(v: unknown): bigint {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v))
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return BigInt(v.trim())
  return 0n
}

/** Base units → decimal string, trimmed to `maxFrac` fraction digits (truncated, not rounded). */
export function formatUnits(v: bigint | string | number, decimals: number, maxFrac = 6): string {
  const n = big(v)
  const neg = n < 0n
  const a = neg ? -n : n
  const base = 10n ** BigInt(decimals)
  const whole = a / base
  let frac = decimals > 0 ? (a % base).toString().padStart(decimals, '0').slice(0, maxFrac) : ''
  frac = frac.replace(/0+$/, '')
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '-' : ''}${w}${frac ? `.${frac}` : ''}`
}

/** Base units → float (for ratios/charts only; display amounts with formatUnits). */
export function toFloat(v: bigint | string | number, decimals: number): number {
  const n = big(v)
  const base = 10n ** BigInt(decimals)
  return Number(n / base) + Number(n % base) / Number(base)
}
