import { NextRequest, NextResponse } from 'next/server'
import { resolveNetworkKey, serverRpcCall, serverNetworkConfig } from '@/lib/network-server'
import { getUsdcMarket } from '@/lib/swap/quote'
import { cidEmissionPct, lpAllocationPct } from '@/lib/lend-model'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/
const DROPS = 1_000_000

function dropsToFalcon(v: string | number | undefined | null): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'string' ? parseInt(v, 10) : v
  if (!Number.isFinite(n)) return null
  return n / DROPS
}

async function resolveToken(networkKey: ReturnType<typeof resolveNetworkKey>) {
  const cfg = serverNetworkConfig(networkKey)
  let currency = cfg.tokens[0]?.currency ?? ''
  let issuer = cfg.tokens[0]?.issuer ?? ''
  if (!issuer && networkKey === 'testnet') {
    try {
      const raw = await readFile(path.join(process.cwd(), 'public', 'config', 'testnet-stables.json'), 'utf8')
      const m = JSON.parse(raw) as { tokens?: Array<{ currency: string; issuer: string }> }
      const t = m.tokens?.[0]
      if (t) {
        currency = t.currency
        issuer = t.issuer
      }
    } catch { /* ignore */ }
  }
  return { symbol: 'F-USDC', currency, issuer, configured: !!issuer }
}

async function featureFlags(networkKey: ReturnType<typeof resolveNetworkKey>) {
  const r = await serverRpcCall<{ features?: Record<string, { name?: string; enabled?: boolean }> }>(
    networkKey,
    'feature',
    {},
  )
  let singleAssetVault = false
  let lendingProtocol = false
  for (const f of Object.values(r.features ?? {})) {
    if (f.name === 'SingleAssetVault') singleAssetVault = !!f.enabled
    if (f.name === 'LendingProtocol') lendingProtocol = !!f.enabled
  }
  return { singleAssetVault, lendingProtocol, lendingReady: singleAssetVault && lendingProtocol }
}

export async function GET(req: NextRequest) {
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const address = req.nextUrl.searchParams.get('address')?.trim() ?? ''

  try {
    const token = await resolveToken(networkKey)
    const protocol = await featureFlags(networkKey)

    let market = { live: false, falconPerFusdc: null as number | null, falconPool: null as number | null, usdcPool: null as number | null }
    if (token.configured) {
      try {
        const m = await getUsdcMarket(networkKey, token, address || undefined)
        if (m.market) {
          market = {
            live: true,
            falconPerFusdc: m.market.price,
            falconPool: m.market.xrpPool,
            usdcPool: m.market.tokenPool,
          }
        }
      } catch { /* no pool */ }
    }

    const epochR = await serverRpcCall<{ node?: Record<string, unknown> }>(
      networkKey,
      'ledger_entry',
      { reward_epoch: true, ledger_index: 'validated' },
      { allowError: true },
    )
    const epochNode = epochR?.node
    const epochNum = typeof epochNode?.EpochNumber === 'number' ? epochNode.EpochNumber : null
    const epoch = {
      number: epochNum,
      poolBalanceFalcon: dropsToFalcon(epochNode?.EpochPoolBalance as string),
      emissionRateFalcon: dropsToFalcon(epochNode?.EmissionRate as string),
      lpAllocationPct: epochNum != null ? lpAllocationPct(epochNum) : null,
      cidEmissionPct: epochNum != null ? cidEmissionPct(epochNum) : null,
    }

    let wallet: {
      address: string
      falconBalance: number | null
      fusdcBalance: number | null
      fusdcLimit: number | null
      hasFusdcTrustLine: boolean
    } | null = null

    const vaults: Array<{ id: string; asset: string; sharesOutstanding: number }> = []
    const loans: Array<{
      id: string
      vaultId: string
      principalFusdc: number
      collateralFalcon: number
      healthFactor: number | null
    }> = []
    const lpPositions: Array<{ vaultId: string; shareBalance: number; claimableEpoch: number | null }> = []

    if (address && ADDRESS_RE.test(address)) {
      const acctR = await serverRpcCall<{ account_data?: { Balance: string } }>(
        networkKey,
        'account_info',
        { account: address, ledger_index: 'validated' },
        { allowError: true },
      )
      const bal = dropsToFalcon(acctR?.account_data?.Balance)
      let fusdcBalance: number | null = null
      let fusdcLimit: number | null = null
      let hasFusdcTrustLine = false

      if (token.issuer) {
        try {
          const linesR = await serverRpcCall<{
            lines?: Array<{ currency: string; account: string; balance: string; limit: string }>
          }>(networkKey, 'account_lines', { account: address, ledger_index: 'validated' })
          const line = (linesR.lines ?? []).find(
            (l) => l.currency === token.currency && l.account === token.issuer,
          )
          if (line) {
            hasFusdcTrustLine = true
            fusdcBalance = parseFloat(line.balance)
            fusdcLimit = parseFloat(line.limit)
          }
        } catch { /* ignore */ }
      }

      wallet = {
        address,
        falconBalance: bal,
        fusdcBalance,
        fusdcLimit,
        hasFusdcTrustLine,
      }

      if (protocol.lendingReady) {
        try {
          const objsR = await serverRpcCall<{
            account_objects?: Array<Record<string, unknown>>
          }>(networkKey, 'account_objects', {
            account: address,
            type: 'vault',
            ledger_index: 'validated',
          }, { allowError: true })
          for (const obj of objsR.account_objects ?? []) {
            if (obj.LedgerEntryType === 'Vault' || obj.ledger_entry_type === 'Vault') {
              vaults.push({
                id: String(obj.index ?? obj.VaultID ?? ''),
                asset: String(obj.Asset ?? 'unknown'),
                sharesOutstanding: 0,
              })
            }
          }
        } catch { /* vault scan optional */ }
      }
    }

    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      protocol: {
        ...protocol,
        chainBuildPending: !protocol.lendingReady,
        genesisRestartNeeded: true,
      },
      token,
      market,
      epoch,
      wallet,
      vaults,
      loans,
      lpPositions,
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Node unavailable' },
      { status: 502 },
    )
  }
}