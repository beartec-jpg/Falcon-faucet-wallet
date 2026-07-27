/**
 * AccountNames helpers (portal).
 * Bond: 100 FALCON. Rules match protocol AccountNameHelpers.
 */

export const NAME_BOND_FALCON = 100
export const NAME_MIN_LEN = 3
export const NAME_MAX_LEN = 32

/** Normalize + validate. Returns lowercase name or null if invalid. */
export function normalizeAccountName(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  if (s.length < NAME_MIN_LEN || s.length > NAME_MAX_LEN) return null
  if (s.startsWith('.') || s.endsWith('.') || s.includes('..')) return null
  if (!/^[a-z0-9.]+$/.test(s)) return null
  return s
}

export function nameHint(raw: string): string | null {
  const n = normalizeAccountName(raw)
  if (!n) {
    if (!raw.trim()) return null
    return '3–32 chars: a–z, 0–9, optional dots (no leading/trailing/double dots)'
  }
  return null
}
