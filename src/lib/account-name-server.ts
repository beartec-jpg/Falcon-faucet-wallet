/**
 * Server-side AccountName resolution (address → name).
 */

import { serverRpcCall } from '@/lib/network-server'
import { decodeLedgerName } from '@/lib/account-name'
import type { NetworkKey } from '@/lib/networks'

export async function resolveNameForAddress(
  networkKey: NetworkKey,
  address: string,
): Promise<{ name: string | null; status: 'active' | 'releasing' | null }> {
  try {
    const info = await serverRpcCall<{
      error?: string
      account_data?: { AccountName?: string }
    }>(
      networkKey,
      'account_info',
      { account: address, ledger_index: 'validated' },
      { allowError: true },
    )

    if (info?.error) return { name: null, status: null }

    let node: { Name?: string; NameStatus?: number } | null = null
    const nameKey = info?.account_data?.AccountName

    if (nameKey) {
      const entry = await serverRpcCall<{
        error?: string
        node?: { Name?: string; NameStatus?: number }
      }>(
        networkKey,
        'ledger_entry',
        { index: nameKey, ledger_index: 'validated' },
        { allowError: true },
      )
      if (entry?.node) node = entry.node
    }

    if (!node) {
      const objs = await serverRpcCall<{
        account_objects?: Array<{
          LedgerEntryType?: string
          Name?: string
          NameStatus?: number
        }>
      }>(
        networkKey,
        'account_objects',
        { account: address, ledger_index: 'validated', limit: 100 },
        { allowError: true },
      )
      const hit = (objs?.account_objects ?? []).find(
        (o) => o.LedgerEntryType === 'AccountName',
      )
      if (hit) node = hit
    }

    if (!node) return { name: null, status: null }
    const name = decodeLedgerName(node.Name)
    if (!name) return { name: null, status: null }
    return {
      name,
      status: node.NameStatus === 1 ? 'releasing' : 'active',
    }
  } catch {
    return { name: null, status: null }
  }
}

/** Resolve many addresses (deduped, parallel, capped). */
export async function resolveNamesForAddresses(
  networkKey: NetworkKey,
  addresses: string[],
  max = 24,
): Promise<Record<string, string>> {
  const unique = [...new Set(addresses.filter(Boolean))].slice(0, max)
  const out: Record<string, string> = {}
  await Promise.all(
    unique.map(async (addr) => {
      const r = await resolveNameForAddress(networkKey, addr)
      if (r.name) out[addr] = r.name
    }),
  )
  return out
}
