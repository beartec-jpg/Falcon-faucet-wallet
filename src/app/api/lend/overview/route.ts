import { NextRequest, NextResponse } from 'next/server'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'
import { getUsdcMarket } from '@/lib/swap/quote'
import { loadStableToken } from '@/lib/swap/token-config'
import { loadLendingManifestServer } from '@/lib/lending-config'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/
const DROPS = 1_000_000

function dropsToFalcon(v: string | number | undefined | null): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'string' ? parseInt(v, 10) : v
  if (!Number.isFinite(n)) return null
  return n / DROPS
}

function iouValue(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number') {
    const n = parseFloat(String(v))
    return Number.isFinite(n) ? n : null
  }
  if (typeof v === 'object' && v !== null && 'value' in v) {
    return iouValue((v as { value: unknown }).value)
  }
  return null
}

async function resolveToken(_networkKey: ReturnType<typeof resolveNetworkKey>) {
  const stable = await loadStableToken()
  return {
    symbol: 'F-USDC',
    currency: stable.currency,
    issuer: stable.issuer,
    configured: !!stable.issuer,
  }
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
    const manifest = await loadLendingManifestServer()
    const cosignReady = !!process.env.TESTNET_LENDING_BROKER_SECRET?.trim()

    let vaultAssetsAvailable: number | null = null
    if (manifest?.vault_id) {
      try {
        const v = await serverRpcCall<{ node?: Record<string, unknown> }>(
          networkKey,
          'ledger_entry',
          { vault: manifest.vault_id, ledger_index: 'validated' },
        )
        vaultAssetsAvailable = iouValue(v.node?.AssetsAvailable)
      } catch { /* optional */ }
    }

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

    let wallet: {
      address: string
      falconBalance: number | null
      fusdcBalance: number | null
      fusdcLimit: number | null
      hasFusdcTrustLine: boolean
    } | null = null

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

      if (protocol.lendingReady && manifest) {
        try {
          const loanR = await serverRpcCall<{
            account_objects?: Array<Record<string, unknown>>
          }>(networkKey, 'account_objects', {
            account: address,
            type: 'loan',
            ledger_index: 'validated',
          }, { allowError: true })
          for (const obj of loanR.account_objects ?? []) {
            if (obj.LedgerEntryType !== 'Loan' && obj.ledger_entry_type !== 'Loan') continue
            const principal = iouValue(obj.PrincipalOutstanding) ?? iouValue(obj.TotalValueOutstanding) ?? 0
            loans.push({
              id: String(obj.index ?? obj.LoanID ?? ''),
              vaultId: String(obj.VaultID ?? manifest.vault_id),
              principalFusdc: principal,
              collateralFalcon: 0,
              healthFactor: null,
            })
          }
        } catch { /* optional */ }

        try {
          const mptR = await serverRpcCall<{
            account_objects?: Array<Record<string, unknown>>
          }>(networkKey, 'account_objects', {
            account: address,
            type: 'mptoken',
            ledger_index: 'validated',
          }, { allowError: true })
          for (const obj of mptR.account_objects ?? []) {
            const mptId = String(obj.MPTokenIssuanceID ?? obj.mpt_issuance_id ?? '')
            if (!mptId) continue
            const bal = parseFloat(String(obj.MPTAmount ?? obj.Balance ?? '0'))
            if (bal <= 0) continue
            lpPositions.push({
              vaultId: manifest.vault_id,
              shareBalance: bal,
              claimableEpoch: null,
            })
          }
        } catch { /* optional */ }
      }
    }

    const lendingConfigured = !!(manifest?.vault_id && manifest?.loan_broker_id)
    const txSigningReady = protocol.lendingReady && lendingConfigured

    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      protocol: {
        ...protocol,
        chainBuildPending: false,
        genesisRestartNeeded: false,
        txSigningReady,
      },
      token,
      market,
      wallet,
      vaults: [],
      loans,
      lpPositions,
      lending: {
        configured: lendingConfigured,
        vaultId: manifest?.vault_id ?? null,
        loanBrokerId: manifest?.loan_broker_id ?? null,
        brokerOwner: manifest?.broker_owner ?? null,
        vaultAssetsAvailable,
        interestRateTenthBps: manifest?.interest_rate_tenth_bps ?? null,
        cosignReady,
      },
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Node unavailable' },
      { status: 502 },
    )
  }
}