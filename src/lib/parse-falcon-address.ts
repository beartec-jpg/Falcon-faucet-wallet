const FALCON_ADDRESS_RE = /r[1-9A-HJ-NP-Za-km-z]{24,34}/

/** Extract a Falcon r-address from scanned QR text or pasted payloads. */
export function parseFalconAddressFromScan(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const match = trimmed.match(FALCON_ADDRESS_RE)
  return match ? match[0] : null
}

export function isValidFalconAddress(address: string): boolean {
  return FALCON_ADDRESS_RE.test(address.trim())
}