import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { loadLendingManifestServer } from '@/lib/lending-config'
import { isActiveVaultLp, mptScaled } from '@/lib/lend-pool-stats'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

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

async function tokenRef() {
  try {
    const raw = await readFile(
      path.join(process.cwd(), 'public', 'config', 'testnet-stables.json'),
      'utf8',
    )
    const m = JSON.parse(raw) as { tokens?: Array<{ currency: string; issuer: string; symbol?: string }> }
    const t = m.tokens?.[0]
    if (t?.issuer) return t
  } catch {
    /* ignore */
  }
  return { currency: 'QUC', issuer: '', symbol: 'F-USDC' }
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

  // ── AMM LP (FALCON / F-USDC) ────────────────────────────────────────────
  const token = await tokenRef()
  let ammLp: {
    canClaim: boolean
    estFalcon: number | null
    lpBalance: number | null
    sharePct: number | null
    lastClaimedEpoch: number | null
    currency: string | null
    issuer: string | null
    reason?: string
  } = {
    canClaim: false,
    estFalcon: null,
    lpBalance: null,
    sharePct: null,
    lastClaimedEpoch: null,
    currency: token.issuer ? token.currency : null,
    issuer: token.issuer || null,
    reason: token.issuer ? undefined : 'Stablecoin issuer not configured',
  }

  if (token.issuer) {
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
        ammLp.reason = 'No FALCON/F-USDC AMM pool'
      } else {
        const ammAccount = String(amm.account ?? '')
        const lpMeta = amm.lp_token as { currency?: string; issuer?: string; value?: string } | undefined
        const poolLpTotal = parseFloat(lpMeta?.value ?? '0')
        const poolXrpDrops =
          typeof amm.amount === 'string' ? parseInt(amm.amount, 10) || 0 : 0

        let lpBalance = 0
        if (lpMeta?.currency && ammAccount) {
          const linesR = await serverRpcCall<{
            lines?: Array<{ currency: string; account: string; balance: string }>
          }>(
            networkKey,
            'account_lines',
            { account: address, ledger_index: 'validated' },
            { allowError: true },
          )
          const line = (linesR.lines ?? []).find(
            (l) => l.account === ammAccount && l.currency === lpMeta.currency,
          )
          if (line) lpBalance = Math.abs(parseFloat(line.balance))
        }

        ammLp.lpBalance = lpBalance
        ammLp.sharePct = poolLpTotal > 0 ? (lpBalance / poolLpTotal) * 100 : 0

        if (lpBalance <= 0) {
          ammLp.reason = 'No AMM LP tokens'
        } else if (
          epoch.number != null &&
          epoch.aggregateAmmTvlDrops > 0 &&
          epoch.emissionDrops > 0 &&
          epoch.ammAllocBps > 0 &&
          poolLpTotal > 0
        ) {
          const ammBasket = Math.floor((epoch.emissionDrops * epoch.ammAllocBps) / BPS)
          const poolBasket = Math.floor(
            (ammBasket * poolXrpDrops) / epoch.aggregateAmmTvlDrops,
          )
          // Mantissa-scale: use float share of LP supply
          const shareDrops = Math.floor((poolBasket * lpBalance) / poolLpTotal)
          ammLp.estFalcon = shareDrops / DROPS
          ammLp.canClaim = shareDrops > 0
          ammLp.reason = shareDrops === 0 ? 'Estimated reward rounds to zero' : undefined
        } else {
          ammLp.reason =
            epoch.number != null && epoch.number < 8
              ? `Emissions start at epoch 8 (now ${epoch.number})`
              : 'No AMM LP allocation this epoch'
        }
      }
    } catch {
      ammLp.reason = 'Could not load AMM state'
    }
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
    },
    vaultLp,
    ammLp,
  })
}
