/**
 * GET /api/wallet/name?name=scott
 * POST { action: reserve|activate, name, publicKey, credentialId? }
 *
 * On Falcon PL 2300 the name *is* the account. Short names cost more.
 */

import { existsSync } from 'fs'
import { NextRequest, NextResponse } from 'next/server'
import { resolveNetworkKey, serverNetworkConfig, serverRpcCall } from '@/lib/network-server'
import {
  normalizeAccountName,
  NAME_BOND_FALCON,
  decodeLedgerName,
} from '@/lib/account-name'
import { isValidClassicAddress } from 'ripple-address-codec'
import { isOriginAllowed } from '@/lib/origin'
import { activateName, reserveName, viewName } from '@/lib/pl-name-store'
import { activationFeeFpl, normalizePlName } from '@/lib/pl-names'
import { plAccount } from '@/lib/pl-rpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/
const WALLET_API =
  process.env.FALCON_PL_WALLET_API?.trim() || 'http://192.241.247.158:19312'

function useLocalStore() {
  return existsSync(
    process.env.FALCON_PL_NAME_STORE?.trim() ||
      `${process.env.HOME || ''}/falcon-pl-public-testnet-2300/run`,
  )
}

async function remoteName(action: string, body: Record<string, unknown>) {
  const r = await fetch(WALLET_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  })
  const d = (await r.json()) as Record<string, unknown>
  if (!r.ok) throw new Error(String(d.error ?? `wallet api ${r.status}`))
  return d
}

export async function GET(req: NextRequest) {
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const cfg = serverNetworkConfig(networkKey)
  const nameQ = (req.nextUrl.searchParams.get('name') ?? '').trim()
  const addressQ = (req.nextUrl.searchParams.get('address') ?? '').trim()

  if (cfg.networkId === 2300 && nameQ) {
    try {
      const view = useLocalStore()
        ? viewName(nameQ)
        : ((await remoteName('name-status', { name: nameQ })) as ReturnType<typeof viewName>)
      let onChainTaken = false
      try {
        const acct = await plAccount(view.name)
        onChainTaken = Boolean(acct.exists) && String(acct.name_status ?? '') === 'activated'
      } catch {
        /* node may not speak name_status yet */
      }
      return NextResponse.json({
        ...view,
        available: view.available && !onChainTaken,
        status: onChainTaken ? 'activated' : view.status,
        network: networkKey,
      })
    } catch (e) {
      const name = normalizePlName(nameQ)
      return NextResponse.json({
        name: name ?? nameQ,
        available: Boolean(name),
        status: name ? 'free' : 'invalid',
        fee: name ? activationFeeFpl(name) : 0,
        error: e instanceof Error ? e.message : String(e),
        network: networkKey,
      })
    }
  }

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

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }
  let body: {
    action?: string
    name?: string
    publicKey?: string
    credentialId?: string
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const action = String(body.action ?? 'reserve')
  const name = String(body.name ?? '').trim()
  const publicKey = String(body.publicKey ?? '').trim()
  const credentialHash = body.credentialId
    ? String(body.credentialId).slice(0, 64)
    : undefined
  try {
    if (useLocalStore()) {
      if (action === 'activate') {
        const rec = activateName(name, publicKey)
        return NextResponse.json({ ok: true, ...rec })
      }
      const rec = reserveName({ name, publicKey, credentialHash })
      return NextResponse.json({ ok: true, ...rec })
    }
    const d = await remoteName(action === 'activate' ? 'name-activate' : 'name-reserve', {
      name,
      publicKey,
      credentialId: credentialHash,
    })
    return NextResponse.json(d)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    )
  }
}
