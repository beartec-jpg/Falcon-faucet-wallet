import { isValidClassicAddress } from '@/lib/classic-address'

/** Full r-address only (anchored). Classic codec check when possible. */
const FALCON_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/

/** Loose match for extracting an address from QR / paste payloads. */
const FALCON_ADDRESS_EXTRACT_RE = /r[1-9A-HJ-NP-Za-km-z]{24,34}/

/** Extract a Falcon r-address from scanned QR text or pasted payloads. */
export function parseFalconAddressFromScan(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (isValidFalconAddress(trimmed)) return trimmed
  const match = trimmed.match(FALCON_ADDRESS_EXTRACT_RE)
  if (!match) return null
  return isValidFalconAddress(match[0]) ? match[0] : null
}

export function isValidFalconAddress(address: string): boolean {
  const a = address.trim()
  if (!FALCON_ADDRESS_RE.test(a)) return false
  // Prefer base58 + checksum validation (Falcon uses classic r-address encoding).
  try {
    return isValidClassicAddress(a)
  } catch {
    return true
  }
}
