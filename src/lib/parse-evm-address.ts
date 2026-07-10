const EVM_ADDRESS_RE = /0x[a-fA-F0-9]{40}/

/** Extract a checksummed or lowercase 0x address from scanned QR text or pasted payloads. */
export function parseEvmAddressFromScan(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const uri = trimmed.match(/^ethereum:(0x[a-fA-F0-9]{40})/i)
  if (uri) return uri[1]

  const match = trimmed.match(EVM_ADDRESS_RE)
  return match ? match[0] : null
}

export function isValidEvmAddress(address: string): boolean {
  return EVM_ADDRESS_RE.test(address.trim())
}