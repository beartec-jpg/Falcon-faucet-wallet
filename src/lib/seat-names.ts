import { plRpc } from '@/lib/pl-rpc'

/**
 * Validator seat ids from the node status. A wallet account named like a seat
 * shares that id with the seat's consensus key on the node ("bad tx crypto:
 * key mismatch"), so new accounts may not take a seat name.
 */
let cache: { at: number; ids: Set<string> } | null = null

export async function seatNames(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < 60_000) return cache.ids
  const r = await plRpc({ type: 'status_req', include_accounts: false }, { timeoutMs: 8_000 })
  if (r.type === 'err') throw new Error(r.msg || 'status error')
  const st = (r.body ?? {}) as Record<string, unknown>
  const ids = new Set<string>()
  for (const v of (Array.isArray(st.validators) ? st.validators : []) as Record<string, unknown>[]) {
    const id = String(v.id ?? '').trim().toLowerCase()
    if (id) {
      ids.add(id)
      ids.add(id.replace(/-bond$/, ''))
    }
  }
  cache = { at: Date.now(), ids }
  return ids
}

export const SEAT_NAME_ERROR = 'That name is a validator seat name. Pick a different account name.'

/** True if `name` equals a seat id. Fails open (false) only if the status call fails. */
export async function isSeatName(name: string): Promise<boolean> {
  try {
    return (await seatNames()).has(name.trim().toLowerCase())
  } catch {
    return false
  }
}
