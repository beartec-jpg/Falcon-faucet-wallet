/** UTF-8 string → uppercase hex for XRPL MemoType / MemoData fields. */
export function utf8ToMemoHex(text: string): string {
  const bytes = new TextEncoder().encode(text)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

export const BRIDGE_WITHDRAW_MEMO_TYPE = 'sepolia-withdraw'