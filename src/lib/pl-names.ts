/**
 * Falcon PL named accounts — the name is the account.
 * Short / obvious names cost more to activate. Unpaid reserves expire.
 */

export const NAME_MIN_LEN = 3
export const NAME_MAX_LEN = 32
export const NAME_RESERVE_MS = 30 * 60 * 1000

const RESERVED = new Set([
  'faucet',
  'treasury',
  'admin',
  'falcon',
  'fpl',
  'pool',
  'lend',
  'bridge',
  'community',
  'builder',
  'watcher',
  'watcher-browser',
  'genesis',
  'root',
  'operator',
  'alice',
  'bob',
  'carol',
  'dave',
  'v1',
  'v2',
  'v3',
  'v4',
  'v5',
  'v6',
  'v7',
])

export function isProtocolName(raw: string): boolean {
  return RESERVED.has(raw.trim().toLowerCase())
}

export function normalizePlName(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  if (s.length < NAME_MIN_LEN || s.length > NAME_MAX_LEN) return null
  if (s.startsWith('.') || s.endsWith('.') || s.includes('..')) return null
  if (!/^[a-z0-9.]+$/.test(s)) return null
  if (isProtocolName(s)) return null
  return s
}

export function plNameHint(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if (isProtocolName(s)) {
    return `"${s}" is a system name (faucet, validators, or test seats). Pick a different account name.`
  }
  if (normalizePlName(s)) return null
  return '3–32 chars: a–z, 0–9, optional dots (no leading/trailing/double dots)'
}

/** Alphanumeric length (dots ignored) — matches fd-pl names.rs */
export function activationFeeFpl(name: string): number {
  const n = name.replace(/\./g, '').length
  if (n <= 3) return 50_000
  if (n === 4) return 20_000
  if (n === 5) return 5_000
  if (n === 6) return 2_000
  if (n <= 8) return 500
  if (n <= 12) return 200
  return 100
}

export function plAccountId(wallet: { accountName?: string; address: string }): string {
  return (wallet.accountName || wallet.address).trim()
}
