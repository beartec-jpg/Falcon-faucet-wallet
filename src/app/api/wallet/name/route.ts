/**
 * GET /api/wallet/name?name=alice.bob&network=testnet
 *   → { available, name, owner?, status?, bondFalcon? }
 *
 * GET /api/wallet/name?address=r…&network=testnet
 *   → { address, name?, status? }  (best-effort via account root AccountName)
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'
import {
  normalizeAccountName,
  NAME_BOND_FALCON,
  decodeLedgerName,
} from '@/lib/account-name'
import { isValidClassicAddress } from 'ripple-address-codec'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/

export async function GET(req: NextRequest) {
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const nameQ = (req.nextUrl.searchParams.get('name') ?? '').trim()
  const addressQ = (req.nextUrl.searchParams.get('address') ?? '').trim()

  try {
    if (nameQ) {
      const name = normalizeAccountName(nameQ)
      if (!name) {
        return NextResponse.json(
          { error: 'Invalid name', available: false, name: nameQ },
          { status: 400 },
        )
      }

      const r = await serverRpcCall<{
        error?: string
        node?: {
          Account?: string
          Name?: string
          NameStatus?: number
          BondedAmount?: string
          LedgerEntryType?: string
        }
      }>(
        networkKey,
        'ledger_entry',
        { account_name: name, ledger_index: 'validated' },
        { allowError: true },
      )

      if (r?.error === 'entryNotFound' || r?.error === 'lgrNotFound') {
        return NextResponse.json({
          name,
          available: true,
          bondFalcon: NAME_BOND_FALCON,
          network: networkKey,
        })
      }

      if (r?.error) {
        return NextResponse.json(
          { error: r.error, name, available: false, network: networkKey },
          { status: 502 },
        )
      }

      const node = r?.node
      const status = node?.NameStatus
      return NextResponse.json({
        name,
        available: false,
        owner: node?.Account,
        status: status === 1 ? 'releasing' : 'active',
        bondFalcon: NAME_BOND_FALCON,
        network: networkKey,
      })
    }

    if (addressQ) {
      if (!ADDRESS_RE.test(addressQ) && !isValidClassicAddress(addressQ)) {
        return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
      }

      const info = await serverRpcCall<{
        error?: string
        account_data?: {
          AccountName?: string
          Balance?: string
        }
      }>(
        networkKey,
        'account_info',
        { account: addressQ, ledger_index: 'validated' },
        { allowError: true },
      )

      if (info?.error === 'actNotFound') {
        return NextResponse.json({
          address: addressQ,
          name: null,
          exists: false,
          network: networkKey,
        })
      }

      const nameKey = info?.account_data?.AccountName as string | undefined

      // Prefer reverse pointer; fall back to owner directory scan.
      let node: {
        Name?: string
        NameStatus?: number
        Account?: string
        index?: string
      } | null = null

      if (nameKey) {
        const entry = await serverRpcCall<{
          error?: string
          node?: { Name?: string; NameStatus?: number; Account?: string }
        }>(
          networkKey,
          'ledger_entry',
          { index: nameKey, ledger_index: 'validated' },
          { allowError: true },
        )
        if (entry?.node) node = entry.node
      }

      if (!node) {
        // Do not pass type=state — that filters out ltACCOUNT_NAME on this node.
        const objs = await serverRpcCall<{
          error?: string
          account_objects?: Array<{
            LedgerEntryType?: string
            Name?: string
            NameStatus?: number
            Account?: string
            index?: string
          }>
        }>(
          networkKey,
          'account_objects',
          {
            account: addressQ,
            ledger_index: 'validated',
            limit: 200,
          },
          { allowError: true },
        )
        const hit = (objs?.account_objects ?? []).find(
          (o) => o.LedgerEntryType === 'AccountName',
        )
        if (hit) node = hit
      }

      if (!node) {
        return NextResponse.json({
          address: addressQ,
          name: null,
          exists: true,
          network: networkKey,
          bondFalcon: NAME_BOND_FALCON,
        })
      }

      const decodedName = decodeLedgerName(node.Name)

      return NextResponse.json({
        address: addressQ,
        name: decodedName,
        status: node.NameStatus === 1 ? 'releasing' : 'active',
        nameKey: nameKey ?? node.index,
        exists: true,
        network: networkKey,
        bondFalcon: NAME_BOND_FALCON,
      })
    }

    return NextResponse.json(
      { error: 'Provide name= or address= query param' },
      { status: 400 },
    )
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Node unavailable' },
      { status: 502 },
    )
  }
}
