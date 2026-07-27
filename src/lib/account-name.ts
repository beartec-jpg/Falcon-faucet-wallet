/**
 * AccountNames helpers (portal).
 * Bond: 100 FALCON. Rules match protocol AccountNameHelpers.
 */

export const NAME_BOND_FALCON = 100
export const NAME_MIN_LEN = 3
export const NAME_MAX_LEN = 32

const LS_PREFIX = 'falcon.accountName.v1:'

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

/** Decode VL Name from ledger JSON (hex blob or plain string). */
export function decodeLedgerName(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.length) return null
  if (/^[0-9A-Fa-f]+$/.test(raw) && raw.length % 2 === 0) {
    try {
      const bytes = new Uint8Array(raw.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))
      const s = new TextDecoder().decode(bytes)
      return normalizeAccountName(s) ?? s
    } catch {
      return null
    }
  }
  return normalizeAccountName(raw) ?? raw
}

export function cacheAccountName(
  address: string,
  name: string | null,
  status: 'active' | 'releasing' | null = 'active',
): void {
  if (typeof window === 'undefined') return
  const key = LS_PREFIX + address
  if (!name) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
    return
  }
  try {
    localStorage.setItem(key, JSON.stringify({ name, status: status ?? 'active' }))
  } catch {
    /* ignore */
  }
}

export function readCachedAccountName(
  address: string,
): { name: string; status: 'active' | 'releasing' } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(LS_PREFIX + address)
    if (!raw) return null
    const j = JSON.parse(raw) as { name?: string; status?: string }
    if (!j.name) return null
    return {
      name: j.name,
      status: j.status === 'releasing' ? 'releasing' : 'active',
    }
  } catch {
    return null
  }
}
