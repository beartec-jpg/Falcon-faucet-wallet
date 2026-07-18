import { NextRequest, NextResponse } from 'next/server'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'
import { getUsdcMarket } from '@/lib/swap/quote'
import { loadStableToken } from '@/lib/swap/token-config'
import { loadLendingManifestServer } from '@/lib/lending-config'
import { loanHealthSnapshot } from '@/lib/lend-collateral'
import { collateralFromLoanObject } from '@/lib/lend-loan-onchain'
import {
  buildPoolSnapshot,
  fetchLoanBrokerNode,
  listChainLoans,
  isActiveVaultLp,
  listVaultShareHolders,
  loanOutstandingFusdc,
  mptScaled,
} from '@/lib/lend-pool-stats'
import { filterActiveUserLoans } from '@/lib/lend-risk-scan'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/
const DROPS = 1_000_000
const BPS = 10_000

function emissionDrops(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'string' || typeof v === 'number') {
    const n = parseInt(String(v), 10)
    return Number.isFinite(n) ? n : 0
  }
  if (typeof v === 'object' && v !== null && 'value' in v) {
    return emissionDrops((v as { value: unknown }).value)
  }
  return 0
}

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
  let lendingCollateral = false
  let lendingPermissionless = false
  for (const f of Object.values(r.features ?? {})) {
    if (f.name === 'SingleAssetVault') singleAssetVault = !!f.enabled
    if (f.name === 'LendingProtocol') lendingProtocol = !!f.enabled
    if (f.name === 'LendingCollateral') lendingCollateral = !!f.enabled
    if (f.name === 'LendingPermissionless') lendingPermissionless = !!f.enabled
  }
  return {
    singleAssetVault,
    lendingProtocol,
    lendingCollateral,
    lendingPermissionless,
    lendingReady: singleAssetVault && lendingProtocol,
  }
}

export async function GET(req: NextRequest) {
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const address = req.nextUrl.searchParams.get('address')?.trim() ?? ''

  try {
    const token = await resolveToken(networkKey)
    const protocol = await featureFlags(networkKey)
    const manifest = await loadLendingManifestServer()
    const cosignReady = !!process.env.TESTNET_LENDING_BROKER_SECRET?.trim()
    const hfMonitorReady = cosignReady

    const vaults: Array<{
      id: string
      asset: string
      assetsTotal: number
      assetsAvailable: number
      sharesOutstanding: number
      shareMptId: string
      shareScale: number
      fixedAprPct: number
      liquidationCollateralFalcon?: number | null
      liquidationIndex?: number | null
    }> = []
    let vaultAssetsAvailable: number | null = null
    let shareMptId: string | null = null
    let shareScale = 6
    let sharesOutstanding = 0
    let assetsTotal = 0

    if (manifest?.vault_id) {
      try {
        const v = await serverRpcCall<{
          vault?: Record<string, unknown>
          result?: { vault?: Record<string, unknown> }
        }>(
          networkKey,
          'vault_info',
          { vault_id: manifest.vault_id, ledger_index: 'validated' },
        )
        const vault = v.vault ?? v.result?.vault
        if (vault) {
          const shares = (vault.shares ?? {}) as Record<string, unknown>
          shareScale = Number(shares.AssetScale ?? vault.Scale ?? 6)
          shareMptId = String(
            vault.ShareMPTID ?? shares.mpt_issuance_id ?? shares.MPTokenIssuanceID ?? '',
          ).toUpperCase()
          sharesOutstanding = mptScaled(
            String(shares.OutstandingAmount ?? shares.outstanding_amount ?? '0'),
            shareScale,
          )
          assetsTotal = iouValue(vault.AssetsTotal) ?? 0
          vaultAssetsAvailable = iouValue(vault.AssetsAvailable)
          const aprBps = manifest.interest_rate_tenth_bps
            ? manifest.interest_rate_tenth_bps / 10
            : 500
          const liqCollRaw = vault.LiquidationCollateral
          let liquidationCollateralFalcon: number | null = null
          if (liqCollRaw != null) {
            if (typeof liqCollRaw === 'string' || typeof liqCollRaw === 'number') {
              const n = Number(liqCollRaw)
              liquidationCollateralFalcon = n > 1e6 ? n / DROPS : n
            }
          }
          const liqIdxRaw = vault.LiquidationIndex
          const liquidationIndex =
            liqIdxRaw != null && Number.isFinite(Number(liqIdxRaw)) ? Number(liqIdxRaw) : null
          vaults.push({
            id: manifest.vault_id,
            asset: token.symbol,
            assetsTotal,
            assetsAvailable: vaultAssetsAvailable ?? 0,
            sharesOutstanding,
            shareMptId,
            shareScale,
            fixedAprPct: aprBps / 100,
            liquidationCollateralFalcon,
            liquidationIndex,
          })
        }
      } catch { /* optional */ }
    }

    let epochInfo = {
      number: null as number | null,
      lpAllocationBps: null as number | null,
      aggregateLpShares: null as number | null,
      emissionDrops: 0,
    }
    try {
      const epochR = await serverRpcCall<{ node?: Record<string, unknown> }>(
        networkKey,
        'ledger_entry',
        { reward_epoch: true, ledger_index: 'validated' },
        { allowError: true },
      )
      const epoch = epochR?.node
      if (epoch) {
        epochInfo = {
          number: Number(epoch.EpochNumber ?? epoch.epoch_number ?? 0) || null,
          lpAllocationBps: Number(epoch.LPAllocationBps ?? 0) || null,
          aggregateLpShares: Number(epoch.AggregateLPShares ?? 0) || null,
          emissionDrops: emissionDrops(epoch.EmissionRate),
        }
      }
    } catch { /* pre-epoch */ }

    let market = { live: false, falconPerFusdc: null as number | null, falconPool: null as number | null, usdcPool: null as number | null }
    if (token.configured) {
      try {
        const m = await getUsdcMarket(networkKey, token, address || undefined)
        if (m.market) {
          market = {
            live: true,
            // Lend health math uses F-USDC per FALCON (inverse of swap quote price).
            falconPerFusdc:
              m.market.xrpPool > 0 ? m.market.tokenPool / m.market.xrpPool : null,
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
      paymentDueFusdc: number | null
      paymentDueRaw: string | null
      totalOutstandingFusdc: number | null
      collateralFalcon: number
      healthFactor: number | null
    }> = []
    const lpPositions: Array<{
      vaultId: string
      shareMptId: string
      shareBalance: number
      sharePct: number | null
      depositedFusdc: number | null
      estEpochRewardFalcon: number | null
      claimableEpoch: number | null
      canClaim: boolean
      claimableLiquidationFalcon?: number | null
    }> = []

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
          const activeLoanObjs = filterActiveUserLoans(loanR.account_objects ?? [])
          for (const obj of activeLoanObjs) {
            const principal = loanOutstandingFusdc(obj)
            const paymentDue = iouValue(obj.PeriodicPayment)
            const pp = obj.PeriodicPayment
            const paymentDueRaw =
              typeof pp === 'string' || typeof pp === 'number'
                ? String(pp)
                : pp && typeof pp === 'object' && 'value' in (pp as object)
                  ? String((pp as { value: unknown }).value)
                  : paymentDue != null
                    ? String(paymentDue)
                    : null
            const totalOutstanding = iouValue(obj.TotalValueOutstanding)
            const debtForHf = totalOutstanding ?? principal
            const loanId = String(obj.index ?? obj.LoanID ?? '').toUpperCase()
            const collateralFalcon = collateralFromLoanObject(obj)
            const { healthFactor: hf } = loanHealthSnapshot(
              collateralFalcon,
              debtForHf,
              market.falconPerFusdc,
            )
            loans.push({
              id: loanId,
              vaultId: String(obj.VaultID ?? manifest.vault_id),
              principalFusdc: principal,
              paymentDueFusdc: paymentDue,
              paymentDueRaw,
              totalOutstandingFusdc: totalOutstanding,
              collateralFalcon,
              healthFactor: collateralFalcon > 0 ? hf : null,
            })
          }
        } catch { /* optional */ }

        if (shareMptId && manifest.vault_id) {
          try {
            const mptR = await serverRpcCall<{
              account_objects?: Array<Record<string, unknown>>
            }>(networkKey, 'account_objects', {
              account: address,
              type: 'mptoken',
              ledger_index: 'validated',
            }, { allowError: true })
            let lastClaimedEpoch: number | null = null
            try {
              const popR = await serverRpcCall<{ node?: Record<string, unknown> }>(
                networkKey,
                'ledger_entry',
                {
                  pop_lp_state: { account: address, vault_id: manifest.vault_id },
                  ledger_index: 'validated',
                },
                { allowError: true },
              )
              const last = popR?.node?.LastClaimedEpoch
              if (last != null) lastClaimedEpoch = Number(last)
            } catch { /* no claim state yet */ }

            for (const obj of mptR.account_objects ?? []) {
              const mptId = String(obj.MPTokenIssuanceID ?? obj.mpt_issuance_id ?? '').toUpperCase()
              if (!mptId || mptId !== shareMptId) continue
              const rawBal = String(obj.MPTAmount ?? obj.Balance ?? '0')
              if (!isActiveVaultLp(rawBal, shareScale, sharesOutstanding)) continue
              const shareBalance = mptScaled(rawBal, shareScale)

              const sharePct =
                sharesOutstanding > 0 ? (shareBalance / sharesOutstanding) * 100 : null
              const depositedFusdc =
                sharesOutstanding > 0 && assetsTotal > 0
                  ? (shareBalance / sharesOutstanding) * assetsTotal
                  : null

              let estEpochRewardFalcon: number | null = null
              let canClaim = false
              const claimableEpoch = epochInfo.number
              if (
                epochInfo.number != null &&
                epochInfo.aggregateLpShares != null &&
                epochInfo.aggregateLpShares > 0 &&
                epochInfo.emissionDrops > 0 &&
                epochInfo.lpAllocationBps != null
              ) {
                const rawUserShares = parseFloat(rawBal)
                const lpPoolDrops = Math.floor(
                  (epochInfo.emissionDrops * epochInfo.lpAllocationBps) / BPS,
                )
                const shareDrops = Math.floor(
                  (lpPoolDrops * rawUserShares) / epochInfo.aggregateLpShares,
                )
                estEpochRewardFalcon = shareDrops / DROPS
                canClaim =
                  lastClaimedEpoch == null || lastClaimedEpoch < epochInfo.number
              }

              let claimableLiquidationFalcon: number | null = null
              const v0 = vaults[0]
              if (v0?.liquidationIndex != null && v0.liquidationIndex > 0) {
                const userRaw = parseFloat(rawBal)
                const idx = v0.liquidationIndex
                const debtRaw = obj.LiquidationDebt
                const debt =
                  debtRaw != null && Number.isFinite(Number(debtRaw))
                    ? Number(debtRaw)
                    : userRaw * idx
                // pending is in FALCON drops (same units as forfeited collateral)
                const pendingDrops = Math.max(0, userRaw * idx - debt)
                const poolDrops = (v0.liquidationCollateralFalcon ?? 0) * DROPS
                claimableLiquidationFalcon =
                  Math.min(pendingDrops, poolDrops > 0 ? poolDrops : pendingDrops) / DROPS
              }

              lpPositions.push({
                vaultId: manifest.vault_id,
                shareMptId: mptId,
                shareBalance,
                sharePct,
                depositedFusdc,
                estEpochRewardFalcon,
                claimableEpoch,
                canClaim,
                claimableLiquidationFalcon,
              })
            }
          } catch { /* optional */ }
        }
      }
    }

    let pool = null
    if (protocol.lendingReady && manifest?.vault_id && shareMptId && vaults.length > 0) {
      try {
        const [contributors, chainLoans, broker] = await Promise.all([
          listVaultShareHolders(
            networkKey,
            shareMptId,
            shareScale,
            sharesOutstanding,
            assetsTotal,
          ),
          listChainLoans(networkKey),
          manifest.loan_broker_id
            ? fetchLoanBrokerNode(networkKey, manifest.loan_broker_id)
            : Promise.resolve(null),
        ])
        pool = buildPoolSnapshot(
          assetsTotal,
          vaultAssetsAvailable ?? 0,
          sharesOutstanding,
          contributors,
          chainLoans,
          broker,
        )
      } catch { /* optional */ }
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
      vaults,
      loans,
      lpPositions,
      epoch: {
        number: epochInfo.number,
        lpAllocationPct:
          epochInfo.lpAllocationBps != null ? epochInfo.lpAllocationBps / 100 : null,
        aggregateLpShares: epochInfo.aggregateLpShares,
      },
      pool,
      lending: {
        configured: lendingConfigured,
        vaultId: manifest?.vault_id ?? null,
        loanBrokerId: manifest?.loan_broker_id ?? null,
        brokerOwner: manifest?.broker_owner ?? null,
        vaultAssetsAvailable,
        interestRateTenthBps: manifest?.interest_rate_tenth_bps ?? null,
        cosignReady,
        hfMonitorReady,
      },
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Node unavailable' },
      { status: 502 },
    )
  }
}