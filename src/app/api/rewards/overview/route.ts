import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { loadLendingManifestServer } from '@/lib/lending-config'
import { isActiveVaultLp, mptScaled } from '@/lib/lend-pool-stats'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'
import { loadPoolPairTokens, type StableTokenRef } from '@/lib/swap/token-config'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/
const BPS = 10_000
const DROPS = 1_000_000

function parseDrops(em: unknown): number {
  if (typeof em === 'string' || typeof em === 'number') {
    return parseInt(String(em), 10) || 0
  }
  if (em && typeof em === 'object' && 'value' in em) {
    return parseInt(String((em as { value: unknown }).value), 10) || 0
  }
  return 0
}

export interface AmmPoolClaimRow {
  symbol: string
  currency: string
  issuer: string
  canClaim: boolean
  estFalcon: number | null
  lpBalance: number | null
  sharePct: number | null
  poolFalconTvl: number | null
  lastClaimedEpoch: number | null
  reason?: string
}

async function buildAmmPoolRow(
  networkKey: ReturnType<typeof resolveNetworkKey>,
  address: string,
  token: StableTokenRef,
  epoch: {
    number: number | null
    emissionDrops: number
    ammAllocBps: number
    aggregateAmmTvlDrops: number
  },
  lines: Array<{ currency: string; account: string; balance: string }>,
): Promise<AmmPoolClaimRow> {
  const base: AmmPoolClaimRow = {
    symbol: token.displaySymbol,
    currency: token.currency,
    issuer: token.issuer,
    canClaim: false,
    estFalcon: null,
    lpBalance: null,
    sharePct: null,
    poolFalconTvl: null,
    lastClaimedEpoch: null,
  }

  if (!token.issuer) {
    return { ...base, reason: 'Issuer not configured' }
  }

  try {
    const ammR = await serverRpcCall<{ amm?: Record<string, unknown> }>(
      networkKey,
      'amm_info',
      {
        asset: { currency: 'XRP' },
        asset2: { currency: token.currency, issuer: token.issuer },
        ledger_index: 'validated',
      },
      { allowError: true },
    )
    const amm = ammR.amm
    if (!amm) {
      return { ...base, reason: `No FALCON/${token.displaySymbol} AMM pool` }
    }

    const ammAccount = String(amm.account ?? '')
    const lpMeta = amm.lp_token as { currency?: string; issuer?: string; value?: string } | undefined
    const poolLpTotal = parseFloat(lpMeta?.value ?? '0')
    const poolXrpDrops =
      typeof amm.amount === 'string' ? parseInt(amm.amount, 10) || 0 : 0

    let lpBalance = 0
    if (lpMeta?.currency && ammAccount) {
      const line = lines.find(
        (l) => l.account === ammAccount && l.currency === lpMeta.currency,
      )
      if (line) lpBalance = Math.abs(parseFloat(line.balance))
    }

    base.lpBalance = lpBalance
    base.sharePct = poolLpTotal > 0 ? (lpBalance / poolLpTotal) * 100 : 0
    base.poolFalconTvl = poolXrpDrops / DROPS

    if (lpBalance <= 0) {
      return { ...base, reason: 'No AMM LP tokens' }
    }

    if (
      epoch.number != null &&
      epoch.aggregateAmmTvlDrops > 0 &&
      epoch.emissionDrops > 0 &&
      epoch.ammAllocBps > 0 &&
      poolLpTotal > 0 &&
      poolXrpDrops > 0
    ) {
      const ammBasket = Math.floor((epoch.emissionDrops * epoch.ammAllocBps) / BPS)
      const poolBasket = Math.floor((ammBasket * poolXrpDrops) / epoch.aggregateAmmTvlDrops)
      const shareDrops = Math.floor((poolBasket * lpBalance) / poolLpTotal)
      base.estFalcon = shareDrops / DROPS
      base.canClaim = shareDrops > 0
      base.reason = shareDrops === 0 ? 'Estimated reward rounds to zero' : undefined
    } else {
      base.reason =
        epoch.number != null && epoch.number < 8
          ? `Emissions start at epoch 8 (now ${epoch.number})`
          : 'No AMM LP allocation this epoch'
    }

    return base
  } catch {
    return { ...base, reason: 'Could not load AMM state' }
  }
}

export async function GET(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
  const address = req.nextUrl.searchParams.get('address')?.trim() ?? ''
  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'Valid Falcon address required' }, { status: 400 })
  }

  // ── Epoch snapshot ──────────────────────────────────────────────────────
  let epoch: {
    number: number | null
    emissionDrops: number
    poolDrops: number
    lpAllocBps: number
    ammAllocBps: number
    aggregateLpShares: number
    aggregateAmmTvlDrops: number
  } = {
    number: null,
    emissionDrops: 0,
    poolDrops: 0,
    lpAllocBps: 0,
    ammAllocBps: 0,
    aggregateLpShares: 0,
    aggregateAmmTvlDrops: 0,
  }

  try {
    const epochR = await serverRpcCall<{ node?: Record<string, unknown> }>(
      networkKey,
      'ledger_entry',
      { reward_epoch: true, ledger_index: 'validated' },
      { allowError: true },
    )
    const node = epochR?.node
    if (node) {
      epoch = {
        number: Number(node.EpochNumber ?? 0) || null,
        emissionDrops: parseDrops(node.EmissionRate),
        poolDrops: parseDrops(node.EpochPoolBalance),
        lpAllocBps: Number(node.LPAllocationBps ?? 0) || 0,
        ammAllocBps: Number(node.AmmLPAllocationBps ?? 0) || 0,
        aggregateLpShares: Number(node.AggregateLPShares ?? 0) || 0,
        aggregateAmmTvlDrops: Number(node.AggregateAmmTvlDrops ?? 0) || 0,
      }
    }
  } catch {
    /* pre-epoch */
  }

  // ── Vault LP ────────────────────────────────────────────────────────────
  let vaultLp: {
    canClaim: boolean
    estFalcon: number | null
    shareBalance: number | null
    lastClaimedEpoch: number | null
    vaultId: string | null
    reason?: string
  } = {
    canClaim: false,
    estFalcon: null,
    shareBalance: null,
    lastClaimedEpoch: null,
    vaultId: null,
    reason: 'Vault not configured',
  }

  const manifest = await loadLendingManifestServer()
  if (manifest?.vault_id) {
    vaultLp.vaultId = manifest.vault_id
    try {
      const v = await serverRpcCall<{
        vault?: Record<string, unknown>
        result?: { vault?: Record<string, unknown> }
      }>(networkKey, 'vault_info', { vault_id: manifest.vault_id, ledger_index: 'validated' })
      const vault = v.vault ?? v.result?.vault
      if (vault) {
        const shares = (vault.shares ?? {}) as Record<string, unknown>
        const shareScale = Number(shares.AssetScale ?? vault.Scale ?? 6)
        const shareMptId = String(
          vault.ShareMPTID ?? shares.mpt_issuance_id ?? shares.MPTokenIssuanceID ?? '',
        ).toUpperCase()
        const sharesOutstanding = mptScaled(
          String(shares.OutstandingAmount ?? shares.outstanding_amount ?? '0'),
          shareScale,
        )

        const mptR = await serverRpcCall<{ account_objects?: Array<Record<string, unknown>> }>(
          networkKey,
          'account_objects',
          { account: address, type: 'mptoken', ledger_index: 'validated' },
          { allowError: true },
        )
        const mpt = (mptR.account_objects ?? []).find(
          (o) => String(o.MPTokenIssuanceID ?? '').toUpperCase() === shareMptId,
        )
        const rawBal = mpt ? String(mpt.MPTAmount ?? mpt.Balance ?? '0') : '0'
        const userShares = parseFloat(rawBal)
        vaultLp.shareBalance = Number.isFinite(userShares) ? userShares / 10 ** shareScale : 0

        if (!mpt || !isActiveVaultLp(rawBal, shareScale, sharesOutstanding)) {
          vaultLp.reason = 'No active vault LP position'
        } else {
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
            if (popR?.node?.LastClaimedEpoch != null) {
              vaultLp.lastClaimedEpoch = Number(popR.node.LastClaimedEpoch)
            }
          } catch {
            /* none */
          }

          if (
            epoch.number != null &&
            epoch.aggregateLpShares > 0 &&
            epoch.emissionDrops > 0 &&
            epoch.lpAllocBps > 0
          ) {
            const lpPool = Math.floor((epoch.emissionDrops * epoch.lpAllocBps) / BPS)
            const shareDrops = Math.floor((lpPool * userShares) / epoch.aggregateLpShares)
            vaultLp.estFalcon = shareDrops / DROPS
            const already =
              vaultLp.lastClaimedEpoch != null && vaultLp.lastClaimedEpoch >= epoch.number
            vaultLp.canClaim = !already && shareDrops > 0
            vaultLp.reason = already
              ? 'Already claimed this epoch'
              : shareDrops === 0
                ? 'Estimated reward rounds to zero'
                : undefined
          } else {
            vaultLp.reason =
              epoch.number != null && epoch.number < 8
                ? `Emissions start at epoch 8 (now ${epoch.number})`
                : 'No vault LP allocation this epoch'
          }
        }
      }
    } catch {
      vaultLp.reason = 'Could not load vault state'
    }
  }

  // ── AMM LP — all native FALCON-paired pools ─────────────────────────────
  const pairTokens = await loadPoolPairTokens()
  const linesR = await serverRpcCall<{
    lines?: Array<{ currency: string; account: string; balance: string }>
  }>(
    networkKey,
    'account_lines',
    { account: address, ledger_index: 'validated' },
    { allowError: true },
  ).catch(() => ({ lines: [] as Array<{ currency: string; account: string; balance: string }> }))
  const lines = linesR.lines ?? []

  const ammPools: AmmPoolClaimRow[] = []
  for (const token of pairTokens) {
    ammPools.push(
      await buildAmmPoolRow(
        networkKey,
        address,
        token,
        {
          number: epoch.number,
          emissionDrops: epoch.emissionDrops,
          ammAllocBps: epoch.ammAllocBps,
          aggregateAmmTvlDrops: epoch.aggregateAmmTvlDrops,
        },
        lines,
      ),
    )
  }

  const totalAmmEst = ammPools.reduce((s, p) => s + (p.estFalcon ?? 0), 0)
  const anyAmmClaimable = ammPools.some((p) => p.canClaim)
  // Backward-compat single row: prefer first claimable, else first pool, else empty.
  const primary =
    ammPools.find((p) => p.canClaim) ??
    ammPools.find((p) => (p.lpBalance ?? 0) > 0) ??
    ammPools[0] ??
    null

  const ammLp = primary
    ? {
        canClaim: anyAmmClaimable,
        estFalcon: totalAmmEst > 0 ? totalAmmEst : primary.estFalcon,
        lpBalance: primary.lpBalance,
        sharePct: primary.sharePct,
        lastClaimedEpoch: primary.lastClaimedEpoch,
        currency: primary.currency,
        issuer: primary.issuer,
        symbol: primary.symbol,
        reason: anyAmmClaimable
          ? undefined
          : primary.reason ?? (ammPools.length === 0 ? 'No pools configured' : undefined),
      }
    : {
        canClaim: false,
        estFalcon: null,
        lpBalance: null,
        sharePct: null,
        lastClaimedEpoch: null,
        currency: null,
        issuer: null,
        symbol: null,
        reason: 'No AMM pairs configured',
      }

  return NextResponse.json({
    address,
    epoch: {
      number: epoch.number,
      emissionFalcon: epoch.emissionDrops / DROPS,
      poolFalcon: epoch.poolDrops / DROPS,
      lpAllocBps: epoch.lpAllocBps,
      ammAllocBps: epoch.ammAllocBps,
      validatorAllocBps: Math.max(0, BPS - epoch.lpAllocBps - epoch.ammAllocBps),
      aggregateAmmTvlFalcon: epoch.aggregateAmmTvlDrops / DROPS,
    },
    vaultLp,
    /** @deprecated use ammPools — summed / primary for older clients */
    ammLp,
    ammPools,
    ammTotalEstFalcon: totalAmmEst,
  })
}
