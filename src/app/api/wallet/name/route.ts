/**
 * GET /api/wallet/name?name=example
 * POST { action: reserve|activate|set-addrs, name, publicKey, credentialId?, externalAddrs? }
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
import { isClassicAddress } from '@/lib/classic-address'
import { isOriginAllowed } from '@/lib/origin'
import { activateName, reserveName, setNameAddrs, viewName } from '@/lib/pl-name-store'
import { activationFeeFpl, normalizePlName, reserveNameError } from '@/lib/pl-names'
import { plAccount } from '@/lib/pl-rpc'
import { walletApiHeaders, walletApiUrl } from '@/lib/walletd'
import { isSeatName, SEAT_NAME_ERROR } from '@/lib/seat-names'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/
const WALLET_API = walletApiUrl()

function shouldUseLocalStore() {
  return existsSync(
    process.env.FALCON_PL_NAME_STORE?.trim() ||
      `${process.env.HOME || ''}/falcon-pl-public-testnet-2300/run`,
  )
}

async function remoteName(action: string, body: Record<string, unknown>) {
  const r = await fetch(WALLET_API, {
    method: 'POST',
    headers: walletApiHeaders(),
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

  if (cfg.networkId === 2300 && nameQ && (await isSeatName(normalizePlName(nameQ) ?? nameQ))) {
    return NextResponse.json({
      name: normalizePlName(nameQ) ?? nameQ,
      available: false,
      status: 'seat',
      error: SEAT_NAME_ERROR,
      network: networkKey,
    })
  }

  if (cfg.networkId === 2300 && nameQ) {
    try {
      const view = shouldUseLocalStore()
        ? viewName(nameQ)
        : ((await remoteName('name-status', { name: nameQ })) as ReturnType<typeof viewName>)
      let onChainTaken = false
      let onChainExternalAddrs: Record<string, string> | undefined
      try {
        const acct = await plAccount(view.name)
        onChainTaken =
          Boolean(acct.exists) &&
          (String(acct.name_status ?? '') === 'activated' ||
            Boolean(acct.key_fp) ||
            Number(acct.sequence ?? 0) > 0 ||
            Number(acct.balance ?? 0) > 0)
        if (acct.external_addrs && typeof acct.external_addrs === 'object') {
          const map: Record<string, string> = {}
          for (const [k, v] of Object.entries(acct.external_addrs as Record<string, unknown>)) {
            if (typeof v === 'string' && v.trim()) {
              map[k.toLowerCase()] = v.trim()
            }
          }
          if (Object.keys(map).length > 0) onChainExternalAddrs = map
        }
      } catch {
        /* node may not speak name_status yet */
      }
      const mergedAddrs = {
        ...(view.externalAddrs ?? {}),
        ...(onChainExternalAddrs ?? {}),
      }
      return NextResponse.json({
        ...view,
        available: view.available && !onChainTaken,
        status: onChainTaken ? 'activated' : view.status,
        externalAddrs: Object.keys(mergedAddrs).length > 0 ? mergedAddrs : view.externalAddrs,
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
      if (!ADDRESS_RE.test(addressQ) && !isClassicAddress(addressQ)) {
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
    /** 'vault' for a vault account name; anything else is a hot-wallet name. */
    purpose?: string
    externalAddrs?: Record<string, string>
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const action = String(body.action ?? 'reserve')
  const name = String(body.name ?? '').trim()
  const publicKey = String(body.publicKey ?? '').trim()
  const externalAddrs =
    body.externalAddrs && typeof body.externalAddrs === 'object' ? body.externalAddrs : undefined
  const credentialHash = body.credentialId
    ? String(body.credentialId).endsWith(':vault')
      ? `${String(body.credentialId).slice(0, -6).slice(0, 58)}:vault`
      : String(body.credentialId).slice(0, 64)
    : undefined
  if (action !== 'activate' && action !== 'set-addrs') {
    const err = reserveNameError(name, String(body.purpose ?? 'wallet'))
    if (err) return NextResponse.json({ error: err, code: 'name_vault_suffix' }, { status: 400 })
    if (await isSeatName(normalizePlName(name) ?? name)) {
      return NextResponse.json({ error: SEAT_NAME_ERROR, code: 'name_is_seat' }, { status: 400 })
    }
  }
  try {
    if (shouldUseLocalStore()) {
      if (action === 'set-addrs') {
        const rec = setNameAddrs(name, publicKey, externalAddrs ?? {})
        return NextResponse.json({ ok: true, ...rec })
      }
      if (action === 'activate') {
        const rec = activateName(name, publicKey, Date.now(), externalAddrs)
        return NextResponse.json({ ok: true, ...rec })
      }
      const rec = reserveName({ name, publicKey, credentialHash, externalAddrs })
      return NextResponse.json({ ok: true, ...rec })
    }
    if (action === 'set-addrs') {
      const d = await remoteName('name-set-addrs', {
        name,
        publicKey,
        externalAddrs: externalAddrs ?? {},
      })
      return NextResponse.json(d)
    }
    const d = await remoteName(action === 'activate' ? 'name-activate' : 'name-reserve', {
      name,
      publicKey,
      credentialId: credentialHash,
      ...(externalAddrs ? { externalAddrs } : {}),
    })
    return NextResponse.json(d)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    )
  }
}
