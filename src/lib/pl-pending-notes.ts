/**
 * Pending withdrawals discovery (pure, no imports): this wallet's ETH/USDC RailWithdraw notes
 * from a node status body (`rails[].withdrawals`). Used server-side by /api/wallet/pl
 * (action pending-withdrawals), so a claim never depends on browser storage.
 */

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/

/** One RailWithdraw note from node status `rails[].withdrawals` (ETH / USDC only). */
export type WalletNote = {
  noteId: string
  asset: 'ETH' | 'USDC'
  /** Base units as a decimal string (wei / USDC 6dp). */
  amount: string
  dest: string
  from: string
}

const HEX64_RE = /^[a-fA-F0-9]{64}$/

/**
 * ETH/USDC withdrawal notes for this wallet from a node status body: burned by `account`
 * or paying `dest` (case-insensitive). Malformed rows are skipped. V3 refund rows count only
 * when they pay `dest`.
 */
export function filterWalletNotes(status: unknown, account: string, dest: string): WalletNote[] {
  const rails = (status as { rails?: unknown })?.rails
  if (!Array.isArray(rails)) return []
  const acct = account.trim().toLowerCase()
  const d = ADDR_RE.test(dest.trim()) ? dest.trim().toLowerCase() : ''
  const out: WalletNote[] = []
  const seen = new Set<string>()
  for (const r of rails) {
    const asset = String((r as { asset?: unknown })?.asset ?? '').toUpperCase()
    if (asset !== 'ETH' && asset !== 'USDC') continue
    const ws = (r as { withdrawals?: unknown }).withdrawals
    if (!Array.isArray(ws)) continue
    for (const w of ws) {
      if (!w || typeof w !== 'object') continue
      const row = w as Record<string, unknown>
      const nid = String(row.note_id ?? '').trim().replace(/^0x/i, '')
      if (!HEX64_RE.test(nid)) continue
      const to = String(row.external_to ?? '').trim()
      if (!ADDR_RE.test(to)) continue
      const from = String(row.from ?? '').trim()
      const amt = row.amount
      const amount =
        typeof amt === 'number' && Number.isSafeInteger(amt) && amt > 0
          ? String(amt)
          : typeof amt === 'string' && /^[0-9]+$/.test(amt) && !/^0+$/.test(amt)
            ? amt
            : ''
      if (!amount) continue
      const refund = row.kind === 'v3_refund'
      const mine = (!refund && acct !== '' && from.toLowerCase() === acct) || (d !== '' && to.toLowerCase() === d)
      if (!mine) continue
      const noteId = '0x' + nid.toLowerCase()
      if (seen.has(noteId)) continue
      seen.add(noteId)
      out.push({ noteId, asset, amount, dest: to, from })
    }
  }
  return out
}

