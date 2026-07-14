'use client'

import { useCallback, useEffect, useState } from 'react'
import { LEND_FIXED_APR_BPS, hfStatus, type LendOverview } from '@/lib/lend-model'
import { estimateLpApyPct } from '@/lib/lend-apy'
import { withNetworkQuery } from '@/lib/network-query'
import type { NetworkKey } from '@/lib/networks'
import {
  borrowBlockedReason,
  fullRepayAmount,
  isRepayableLoan,
  minBrokerCoverForPrincipal,
  repayBlockedReason,
  repayDueFusdc,
} from '@/lib/lend-borrow-errors'
import {
  maxSupplyFusdc,
  normalizeVaultDepositAmount,
  supplyBlockedReason,
} from '@/lib/lend-vault-deposit'
import {
  maxWithdrawFusdc,
  normalizeVaultWithdrawAmount,
  withdrawBlockedReason,
} from '@/lib/lend-vault-withdraw'
import {
  LEND_LIQUIDATION_THRESHOLD,
  LEND_MIN_COLLATERAL_RATIO,
  collateralBlockedReason,
  collateralFalconForDebt,
  hfStatusColor,
  hfStatusLabel,
  loanHealthSnapshot,
} from '@/lib/lend-collateral'

function fmt(n: number | null | undefined, digits = 4): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a
}

export function LendProtocolBanner({ data }: { data: LendOverview | null }) {
  if (!data) return null
  const { protocol, lending } = data
  if (protocol.lendingReady) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-200 space-y-1">
        <p>
          <span className="font-medium">Lending protocol is live on-chain.</span>{' '}
          <code className="text-emerald-100/90">SingleAssetVault</code> +{' '}
          <code className="text-emerald-100/90">LendingProtocol</code> enabled.
        </p>
        <p className="text-xs text-emerald-200/80">
          {protocol.txSigningReady
            ? protocol.lendingPermissionless && protocol.lendingCollateral
              ? 'Supply, permissionless borrow (FALCON collateral, 150% HF), add collateral, claim, repay, and on-chain liquidation (LoanManage + HF monitor) are wired.'
              : lending.cosignReady
                ? 'Supply, borrow (LoanSet + broker co-sign), claim, repay, and on-chain risk enforcement are wired. Enable LendingPermissionless on validators for collateral-only borrow.'
                : 'Supply and claim work from the portal. Borrow needs LendingPermissionless on-chain, or TESTNET_LENDING_BROKER_SECRET for legacy co-sign.'
            : 'Run bootstrap-testnet-lending.py on the coordinator to create the F-USDC vault and loan broker.'}
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-100 space-y-1">
      <p>
        <span className="font-medium text-amber-200">Lending not active.</span> Enable{' '}
        <code className="text-amber-100/90">SingleAssetVault</code> and{' '}
        <code className="text-amber-100/90">LendingProtocol</code> on validators.
      </p>
    </div>
  )
}

export function LendApyPanel({ data }: { data: LendOverview | null }) {
  const vault = data?.vaults?.[0]
  const pool = data?.pool
  const lp = data?.lpPositions?.[0]
  if (!vault || !pool) return null

  const apy = estimateLpApyPct({
    epochNumber: data?.epoch?.number ?? null,
    emissionDropsPerEpoch: 0,
    aggregateLpShares: data?.epoch?.aggregateLpShares ?? null,
    userShareBalance: lp?.shareBalance ?? null,
    vaultAssetsTotal: vault.assetsTotal,
    utilizationPct: pool.supply.utilizationPct,
    fixedAprPct: vault.fixedAprPct,
  })

  return (
    <section className="rounded-xl border border-brand-500/20 bg-brand-500/5 p-4 space-y-2">
      <h2 className="text-sm font-semibold text-brand-200">LP yield model</h2>
      <p className="text-xs text-slate-500">
        PoPL emissions floor + borrower interest upside. LP emission share tapers{' '}
        {apy.lpEmissionSharePct.toFixed(1)}% this epoch (50% → 30% over 24 epochs).
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <div className="bg-slate-950/60 rounded-lg px-3 py-2">
          <div className="text-slate-500">Borrower APR</div>
          <div className="font-mono text-slate-200 mt-0.5">{fmt(vault.fixedAprPct, 2)}%</div>
        </div>
        <div className="bg-slate-950/60 rounded-lg px-3 py-2">
          <div className="text-slate-500">Interest upside (utilization)</div>
          <div className="font-mono text-emerald-300 mt-0.5">
            ~{fmt(apy.interestUpsideAprPct, 2)}% APR
          </div>
        </div>
        <div className="bg-slate-950/60 rounded-lg px-3 py-2 col-span-2 sm:col-span-1">
          <div className="text-slate-500">Pool utilization</div>
          <div className="font-mono text-slate-200 mt-0.5">{fmt(pool.supply.utilizationPct, 1)}%</div>
        </div>
      </div>
      <p className="text-[10px] text-slate-600">
        Connect a wallet with vault shares to see per-position emission estimates on Positions.
        Low utilization → interest component is weak; emissions floor carries yield.
      </p>
    </section>
  )
}

type RiskRow = {
  loanId: string
  borrower: string
  debtFusdc: number
  collateralFalcon: number
  healthFactor: number | null
  hfStatus: string
  impaired: boolean
  recommendedAction: string
}

export function LendRiskMonitorPanel({
  data,
  networkKey,
}: {
  data: LendOverview | null
  networkKey: NetworkKey
}) {
  const [rows, setRows] = useState<RiskRow[]>([])
  const [loading, setLoading] = useState(false)
  const [atRisk, setAtRisk] = useState(0)

  const refresh = useCallback(async () => {
    if (!data?.protocol.lendingReady) return
    setLoading(true)
    try {
      const r = await fetch(withNetworkQuery('/api/lend/risk-monitor', networkKey))
      const j = await r.json()
      if (r.ok) {
        setRows((j.loans ?? []) as RiskRow[])
        setAtRisk(j.atRiskCount ?? 0)
      }
    } catch {
      /* optional */
    } finally {
      setLoading(false)
    }
  }, [data?.protocol.lendingReady, networkKey])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 60_000)
    return () => clearInterval(id)
  }, [refresh])

  if (!data?.protocol.lendingReady) return null

  return (
    <section className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-amber-200">Liquidation & risk monitor</h2>
        <button
          type="button"
          onClick={() => refresh()}
          disabled={loading}
          className="text-[10px] text-amber-300/80 hover:text-amber-200 disabled:opacity-50"
        >
          {loading ? 'Scanning…' : 'Refresh'}
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Health factor from AMM price. Broker HF daemon submits{' '}
        <code className="text-slate-400">LoanManage</code> impair/default when thresholds breach.
        {data.lending.hfMonitorReady
          ? ' Enforcement active on coordinator.'
          : ' Set TESTNET_LENDING_BROKER_SECRET + deploy lend-hf-monitor on coordinator.'}
      </p>
      {atRisk > 0 && (
        <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
          {atRisk} loan{atRisk === 1 ? '' : 's'} need LoanManage action (impair/default).
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-xs text-slate-600">No active on-chain loans.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800">
                <th className="text-left py-2 pr-2">Borrower</th>
                <th className="text-right py-2 px-2">HF</th>
                <th className="text-right py-2 px-2">Debt</th>
                <th className="text-right py-2 pl-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 12).map((row) => (
                <tr key={row.loanId} className="border-b border-slate-800/60 text-slate-300">
                  <td className="py-2 pr-2 font-mono">
                    {shortAddr(row.borrower)}
                    {row.impaired && (
                      <span className="text-amber-400 block text-[10px]">impaired</span>
                    )}
                  </td>
                  <td
                    className={`text-right font-mono py-2 px-2 ${hfStatusColor(
                      (row.hfStatus || 'none') as ReturnType<typeof hfStatus>,
                    )}`}
                  >
                    {row.healthFactor != null ? fmt(row.healthFactor, 3) : '—'}
                  </td>
                  <td className="text-right font-mono py-2 px-2">{fmt(row.debtFusdc, 2)}</td>
                  <td className="text-right font-mono py-2 pl-2 text-amber-300">
                    {row.recommendedAction === 'none' ? '—' : row.recommendedAction}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function LendPoolOverviewPanel({
  data,
  networkKey,
}: {
  data: LendOverview | null
  networkKey: NetworkKey
}) {
  const vault = data?.vaults?.[0]
  const pool = data?.pool
  const position = data?.lpPositions?.[0]
  const hasWallet = !!data?.wallet
  const walletAddr = data?.wallet?.address
  const permissionless =
    data?.protocol.lendingPermissionless && data?.protocol.lendingCollateral

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/30 to-slate-900/60 p-4 space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-xs font-mono bg-emerald-500/15 text-emerald-300">
              Vault
            </span>
            <span className="text-xs text-slate-500">F-USDC lending pool</span>
          </div>
          <h2 className="text-sm font-semibold text-white mt-2">F-USDC lend pool</h2>
          <p className="text-xs text-slate-500 mt-1">
            Only F-USDC goes in — users bridge or swap, then supply. No FALCON in this pool. Borrowers draw
            F-USDC when loans open
            {permissionless
              ? '; permissionless loans lock borrower FALCON collateral on-chain (no broker co-sign).'
              : '; legacy path used broker first-loss cover (retired when permissionless is live).'}
          </p>
        </div>

        {pool ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="rounded-xl bg-slate-800/50 px-3 py-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Total supplied</div>
                <div className="text-lg font-bold text-white mt-1">{fmt(pool.supply.totalFusdc, 2)}</div>
                <div className="text-[10px] text-slate-600">F-USDC in vault</div>
              </div>
              <div className="rounded-xl bg-slate-800/50 px-3 py-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Providers</div>
                <div className="text-lg font-bold text-emerald-300 mt-1">{pool.supply.providerCount}</div>
                <div className="text-[10px] text-slate-600">share MPT holders</div>
              </div>
              <div className="rounded-xl bg-slate-800/50 px-3 py-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Borrowers</div>
                <div className="text-lg font-bold text-amber-300 mt-1">{pool.borrow.borrowerCount}</div>
                <div className="text-[10px] text-slate-600">loans with balance due</div>
              </div>
              <div className="rounded-xl bg-slate-800/50 px-3 py-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Utilization</div>
                <div className="text-lg font-bold text-white mt-1">{fmt(pool.supply.utilizationPct, 1)}%</div>
                <div className="text-[10px] text-slate-600">borrowed / supplied</div>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-3 space-y-2">
                <h3 className="text-xs font-semibold text-emerald-200">Supply side</h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-slate-500">Available</div>
                    <div className="font-mono text-slate-200">{fmt(pool.supply.availableFusdc, 2)} F-USDC</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Share supply</div>
                    <div className="font-mono text-slate-200">{fmt(pool.supply.sharesOutstanding, 0)}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Borrower APR</div>
                    <div className="font-mono text-slate-200">{fmt(vault?.fixedAprPct, 2)}%</div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-3 space-y-2">
                <h3 className="text-xs font-semibold text-amber-200">Borrow side</h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-slate-500">Outstanding debt</div>
                    <div className="font-mono text-slate-200">{fmt(pool.borrow.totalDebtFusdc, 2)} F-USDC</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Borrowed (vault)</div>
                    <div className="font-mono text-slate-200">{fmt(pool.supply.borrowedFusdc, 2)} F-USDC</div>
                  </div>
                  {!permissionless ? (
                    <div>
                      <div className="text-slate-500">Broker cover (legacy)</div>
                      <div className={`font-mono ${pool.borrow.brokerCoverFusdc < 0.01 ? 'text-amber-400' : 'text-slate-200'}`}>
                        {fmt(pool.borrow.brokerCoverFusdc, 2)} F-USDC
                      </div>
                      {pool.borrow.brokerCoverFusdc < 0.01 && (
                        <div className="text-[10px] text-amber-500/90 mt-0.5">Legacy path only</div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div className="text-slate-500">FALCON collateral</div>
                      <div className="font-mono text-brand-300">
                        {pool.borrow.totalCollateralFalcon > 0
                          ? `${fmt(pool.borrow.totalCollateralFalcon, 4)} FALCON`
                          : '—'}
                      </div>
                      <div className="text-[10px] text-emerald-500/90 mt-0.5">Permissionless — no broker</div>
                    </div>
                  )}
                  <div>
                    <div className="text-slate-500">Debt cap</div>
                    <div className="font-mono text-slate-200">
                      {pool.borrow.debtMaximumFusdc != null
                        ? `${fmt(pool.borrow.debtMaximumFusdc, 0)} F-USDC`
                        : '—'}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-slate-500">FALCON collateral (on-chain)</div>
                    <div className="font-mono text-brand-300">
                      {pool.borrow.totalCollateralFalcon > 0
                        ? `${fmt(pool.borrow.totalCollateralFalcon, 4)} FALCON`
                        : '—'}
                    </div>
                    <div className="text-[10px] text-slate-600 mt-0.5">
                      FALCON locked on active loans (LendingCollateral amendment).
                    </div>
                  </div>
                </div>
                {(pool.borrow.coverRateMinPct != null || pool.borrow.coverRateLiqPct != null) && (
                  <p className="text-[10px] text-slate-600">
                    Cover rates: min {fmt(pool.borrow.coverRateMinPct, 2)}% · liq{' '}
                    {fmt(pool.borrow.coverRateLiqPct, 2)}%
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-500">
                <span>Pool utilization</span>
                <span>
                  {fmt(pool.supply.borrowedFusdc, 2)} borrowed · {fmt(pool.supply.availableFusdc, 2)} idle
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden flex">
                <div
                  className="bg-amber-500/70 h-full"
                  style={{ width: `${Math.min(100, pool.supply.utilizationPct)}%` }}
                />
                <div className="bg-emerald-500/50 h-full flex-1" />
              </div>
            </div>
          </>
        ) : vault ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-slate-500">Total supplied</div>
              <div className="font-mono text-slate-200">{fmt(vault.assetsTotal, 2)} F-USDC</div>
            </div>
            <div>
              <div className="text-slate-500">Available to borrow</div>
              <div className="font-mono text-slate-200">{fmt(vault.assetsAvailable, 2)} F-USDC</div>
            </div>
            <div>
              <div className="text-slate-500">Share supply</div>
              <div className="font-mono text-slate-200">{fmt(vault.sharesOutstanding, 0)}</div>
            </div>
            <div>
              <div className="text-slate-500">Borrower APR</div>
              <div className="font-mono text-slate-200">{fmt(vault.fixedAprPct, 2)}%</div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Vault not bootstrapped or unreachable.</p>
        )}

      </section>

      {(pool?.contributors.length ?? 0) > 0 && (
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-white">Liquidity providers</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="text-left py-2 pr-2">Address</th>
                  <th className="text-right py-2 px-2">Shares</th>
                  <th className="text-right py-2 px-2">Pool %</th>
                  <th className="text-right py-2 pl-2">Supplied</th>
                </tr>
              </thead>
              <tbody>
                {pool!.contributors.map((c) => (
                  <tr
                    key={c.address}
                    className={`border-b border-slate-800/60 ${
                      c.address === walletAddr ? 'text-emerald-300' : 'text-slate-300'
                    }`}
                  >
                    <td className="py-2 pr-2 font-mono">{shortAddr(c.address)}</td>
                    <td className="text-right font-mono py-2 px-2">{fmt(c.shareBalance, 0)}</td>
                    <td className="text-right font-mono py-2 px-2">{fmt(c.sharePct, 4)}%</td>
                    <td className="text-right font-mono py-2 pl-2">{fmt(c.depositedFusdc, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {pool && pool.borrowers.length > 0 && (
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-white">Active borrowers</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="text-left py-2 pr-2">Borrower</th>
                  <th className="text-right py-2 px-2">Collateral</th>
                  <th className="text-right py-2 pl-2">Principal</th>
                </tr>
              </thead>
              <tbody>
                {pool.borrowers.map((b) => (
                  <tr
                    key={b.loanId}
                    className={`border-b border-slate-800/60 ${
                      b.address === walletAddr ? 'text-amber-300' : 'text-slate-300'
                    }`}
                  >
                    <td className="py-2 pr-2 font-mono">{shortAddr(b.address)}</td>
                    <td className="text-right font-mono py-2 px-2 text-brand-300">
                      {b.collateralFalcon != null && b.collateralFalcon > 0
                        ? `${fmt(b.collateralFalcon, 2)} FALCON`
                        : '—'}
                    </td>
                    <td className="text-right font-mono py-2 pl-2">{fmt(b.principalFusdc, 2)} F-USDC</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {pool && pool.borrow.borrowerCount === 0 && (
        <p className="text-xs text-slate-600 text-center">No active borrowers on-chain yet.</p>
      )}

      <LendApyPanel data={data} />
      <LendRiskMonitorPanel data={data} networkKey={networkKey} />

      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-white">Your position</h2>
        {!hasWallet ? (
          <p className="text-sm text-slate-500">Connect a wallet on the Wallet tab to see your pool share.</p>
        ) : (
          <div className="space-y-3">
            <div className="text-xs">
              <div className="text-slate-500">F-USDC available to supply</div>
              <div className="font-mono text-slate-200">
                {data?.wallet?.hasFusdcTrustLine
                  ? `${fmt(data.wallet.fusdcBalance, 2)} F-USDC`
                  : 'No trust line — add via Bridge or Swap'}
              </div>
            </div>
            {position ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-slate-500">Vault shares</div>
                  <div className="font-mono text-emerald-300">{fmt(position.shareBalance, 0)}</div>
                </div>
                <div>
                  <div className="text-slate-500">Pool share</div>
                  <div className="font-mono text-slate-200">
                    {position.sharePct != null ? `${fmt(position.sharePct, 4)}%` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Supplied</div>
                  <div className="font-mono text-slate-200">
                    {position.depositedFusdc != null ? `${fmt(position.depositedFusdc, 2)} F-USDC` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Lender APR</div>
                  <div className="font-mono text-slate-200">
                    {vault ? `${fmt(vault.fixedAprPct, 2)}%` : '—'}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No vault shares yet — supply F-USDC on the Supply tab to receive share MPTs.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

export function LendSupplyPanel({
  data,
  busy,
  onSupply,
}: {
  data: LendOverview | null
  busy?: boolean
  onSupply?: (amount: string) => void
}) {
  const [amount, setAmount] = useState('')
  const ready = data?.protocol.txSigningReady && !!onSupply
  const vault = data?.vaults?.[0]
  const offered = parseFloat(amount)
  const normalized =
    vault && Number.isFinite(offered) && offered > 0
      ? normalizeVaultDepositAmount(offered, vault)
      : null
  const supplyBlocked =
    amount.trim() && data ? supplyBlockedReason(data, amount) : null
  const fusdcBalance = data?.wallet?.fusdcBalance ?? null
  const hasTrustLine = data?.wallet?.hasFusdcTrustLine ?? false
  const maxAmount =
    vault && fusdcBalance != null && fusdcBalance > 0
      ? maxSupplyFusdc(fusdcBalance, vault)
      : null

  const handle = () => {
    if (supplyBlocked) return
    const n = parseFloat(amount)
    if (!Number.isFinite(n) || n <= 0) return
    if (!data?.wallet?.hasFusdcTrustLine) return
    onSupply?.(amount)
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-white">Supply F-USDC</h2>
      <p className="text-xs text-slate-500">
        Deposit into the lending vault via <code className="text-slate-400">VaultDeposit</code>. You receive vault
        share MPTs and earn borrower interest pro-rata.
      </p>
      <div className="text-xs text-slate-400">
        Pool APR: {(LEND_FIXED_APR_BPS / 100).toFixed(2)}% · Vault{' '}
        {data?.lending.vaultId ? `${data.lending.vaultId.slice(0, 8)}…` : 'not configured'}
      </div>
      {data?.wallet && !hasTrustLine && (
        <p className="text-xs text-amber-400">Add a F-USDC trust line on Wallet → Bridge or Swap first.</p>
      )}
      <div className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2.5 flex items-center justify-between gap-3">
        <div className="text-xs">
          <div className="text-slate-500">F-USDC available to supply</div>
          <div className="font-mono text-base text-emerald-300 mt-0.5">
            {hasTrustLine && fusdcBalance != null ? (
              <>
                {fmt(fusdcBalance, 6)} F-USDC
                {busy && (
                  <span className="block text-slate-500 text-[11px] font-sans mt-0.5">
                    Signing… F-USDC moves only after the tx confirms
                  </span>
                )}
              </>
            ) : hasTrustLine ? (
              '—'
            ) : (
              <span className="text-amber-400 text-sm">No trust line</span>
            )}
          </div>
        </div>
        {maxAmount && !busy && (
          <button
            type="button"
            onClick={() => setAmount(maxAmount)}
            disabled={!ready}
            className="shrink-0 rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            Max
          </button>
        )}
      </div>
      <p className="text-[11px] text-slate-600">
        Network fee is paid in <span className="text-slate-400">FALCON</span>, not F-USDC. Failed attempts
        only cost a trace of FALCON.
      </p>
      <label className="block text-xs">
        <span className="text-slate-500">Amount to supply (F-USDC)</span>
        <input
          type="number"
          min="0"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={!ready || busy}
          className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-sm disabled:opacity-50"
        />
      </label>
      {normalized && amount.trim() && normalized !== amount.trim() && !supplyBlocked && (
        <p className="text-xs text-slate-500">
          Vault share math will deposit{' '}
          <span className="font-mono text-slate-300">{normalized} F-USDC</span> (rounded from your
          input).
        </p>
      )}
      {supplyBlocked && (
        <p className="text-xs text-amber-400">{supplyBlocked}</p>
      )}
      <button
        type="button"
        onClick={handle}
        disabled={!ready || busy || !amount || !!supplyBlocked}
        className="w-full rounded-lg bg-brand-500 text-white px-4 py-2.5 text-sm font-medium disabled:opacity-50"
      >
        {busy ? 'Signing…' : 'Supply (sign with passkey)'}
      </button>
    </section>
  )
}

export function LendBorrowPanel({
  data,
  busy,
  onBorrow,
}: {
  data: LendOverview | null
  busy?: boolean
  onBorrow?: (principal: string, collateralFalcon: string) => void
}) {
  const [borrow, setBorrow] = useState('')
  const [collateral, setCollateral] = useState('')
  const borrowNum = parseFloat(borrow)
  const collateralNum = parseFloat(collateral)
  const falconPerFusdc = data?.market.falconPerFusdc ?? null
  const minCollateral =
    Number.isFinite(borrowNum) && borrowNum > 0 && falconPerFusdc
      ? collateralFalconForDebt(borrowNum, falconPerFusdc)
      : null
  const blocked = borrowBlockedReason(
    data,
    Number.isFinite(borrowNum) && borrowNum > 0 ? borrowNum : undefined,
  )
  const collateralBlocked = collateralBlockedReason(
    Number.isFinite(borrowNum) && borrowNum > 0 ? borrowNum : undefined,
    Number.isFinite(collateralNum) && collateralNum > 0 ? collateralNum : undefined,
    data?.wallet?.falconBalance,
    falconPerFusdc,
  )
  const preview =
    Number.isFinite(borrowNum) &&
    borrowNum > 0 &&
    Number.isFinite(collateralNum) &&
    collateralNum > 0
      ? loanHealthSnapshot(collateralNum, borrowNum, falconPerFusdc)
      : null
  const permissionless =
    data?.protocol.lendingPermissionless && data?.protocol.lendingCollateral
  const ready =
    data?.protocol.txSigningReady &&
    (permissionless || data?.lending.cosignReady) &&
    !!onBorrow &&
    !blocked &&
    !collateralBlocked

  const handle = () => {
    if (!Number.isFinite(borrowNum) || borrowNum <= 0) return
    if (!Number.isFinite(collateralNum) || collateralNum <= 0) return
    onBorrow?.(borrow, collateral)
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-white">Borrow F-USDC</h2>
      <p className="text-xs text-slate-500">
        Open a loan via <code className="text-slate-400">LoanSet</code>. You sign as borrower and lock FALCON collateral
        on-chain{permissionless ? ' — no operator co-sign when LendingPermissionless is enabled' : '; the broker owner co-signs CounterpartySignature'}.
      </p>
      {!permissionless && !data?.lending.cosignReady && data?.protocol.txSigningReady && (
        <p className="text-xs text-amber-400">
          Broker co-sign secret not on server — borrow disabled until TESTNET_LENDING_BROKER_SECRET is set.
        </p>
      )}
      {permissionless && (
        <p className="text-xs text-emerald-300/90">
          Permissionless borrow: post FALCON collateral (150% min at AMM price). No broker co-sign.
        </p>
      )}
      {blocked && data?.protocol.txSigningReady && (
        <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2.5">
          {blocked}
        </p>
      )}
      {collateralBlocked && data?.protocol.txSigningReady && !blocked && (
        <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2.5">
          {collateralBlocked}
        </p>
      )}
      {data?.pool && (
        <p className="text-[10px] text-slate-600">
          Vault available: {fmt(data.pool.supply.availableFusdc, 2)} F-USDC
          {permissionless ? (
            <>
              {' '}
              · FALCON collateral required (150% min HF at AMM price) — no broker co-sign
            </>
          ) : (
            <>
              {' '}
              · Broker cover (legacy): {fmt(data.pool.borrow.brokerCoverFusdc, 2)} F-USDC
              {Number.isFinite(borrowNum) && borrowNum > 0 && data.pool.borrow.coverRateMinPct != null && (
                <>
                  {' '}
                  · min cover for {fmt(borrowNum, 0)} borrow: ~
                  {fmt(minBrokerCoverForPrincipal(borrowNum, data.pool.borrow.coverRateMinPct), 2)} F-USDC
                </>
              )}
            </>
          )}
        </p>
      )}
      <label className="block text-xs">
        <span className="text-slate-500">Borrow (F-USDC)</span>
        <input
          type="number"
          min="0"
          value={borrow}
          onChange={(e) => {
            setBorrow(e.target.value)
            const n = parseFloat(e.target.value)
            if (falconPerFusdc && Number.isFinite(n) && n > 0) {
              const min = collateralFalconForDebt(n, falconPerFusdc)
              if (min != null) setCollateral(String(Math.ceil(min * 1e4) / 1e4))
            }
          }}
          disabled={!data?.protocol.txSigningReady || busy}
          className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-sm disabled:opacity-50"
        />
      </label>
      <label className="block text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">FALCON collateral</span>
          {minCollateral != null && (
            <button
              type="button"
              onClick={() => setCollateral(String(Math.ceil(minCollateral * 1e4) / 1e4))}
              disabled={busy}
              className="text-[10px] text-brand-400 hover:text-brand-300"
            >
              Min {fmt(minCollateral, 4)} ({(LEND_MIN_COLLATERAL_RATIO * 100).toFixed(0)}%)
            </button>
          )}
        </div>
        <input
          type="number"
          min="0"
          value={collateral}
          onChange={(e) => setCollateral(e.target.value)}
          disabled={!data?.protocol.txSigningReady || busy}
          className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-sm disabled:opacity-50"
        />
        {data?.wallet?.falconBalance != null && (
          <span className="text-[10px] text-slate-600 mt-1 block">
            Wallet: {fmt(data.wallet.falconBalance, 4)} FALCON
            {falconPerFusdc ? ` · AMM ≈ ${fmt(falconPerFusdc, 6)} F-USDC/FALCON` : ''}
          </span>
        )}
      </label>
      {preview && preview.healthFactor != null && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2.5 text-xs space-y-1.5">
          <div className="flex justify-between gap-3">
            <span className="text-slate-500">Health factor</span>
            <span className={`font-mono ${hfStatusColor(preview.status)}`}>
              {fmt(preview.healthFactor, 3)} · {hfStatusLabel(preview.status)}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-slate-500">Collateral value</span>
            <span className="font-mono text-slate-200">
              {preview.collateralValueFusdc != null
                ? `${fmt(preview.collateralValueFusdc, 2)} F-USDC`
                : '—'}
            </span>
          </div>
          {preview.liquidationDropPct != null && (
            <p className="text-[10px] text-slate-500 leading-relaxed">
              If FALCON price drops{' '}
              <span className="font-mono text-amber-300">{fmt(preview.liquidationDropPct, 2)}%</span>{' '}
              (debt unchanged), health reaches {LEND_LIQUIDATION_THRESHOLD} — liquidation threshold.
            </p>
          )}
          <p className="text-[10px] text-slate-600">
            Target min ratio {(LEND_MIN_COLLATERAL_RATIO * 100).toFixed(0)}% · liquidation HF{' '}
            {LEND_LIQUIDATION_THRESHOLD}. Collateral is locked on-chain in the same LoanSet transaction.
          </p>
        </div>
      )}
      <button
        type="button"
        onClick={handle}
        disabled={!ready || busy || !borrow || !collateral}
        className="w-full rounded-lg bg-brand-500 text-white px-4 py-2.5 text-sm font-medium disabled:opacity-50"
      >
        {busy ? 'Signing…' : 'Borrow (sign with passkey)'}
      </button>
    </section>
  )
}

export function LendPositionsPanel({
  data,
  busy,
  onClaim,
  onWithdraw,
  onRepay,
  onAddCollateral,
}: {
  data: LendOverview | null
  busy?: boolean
  onClaim?: () => void
  onWithdraw?: (amount: string) => void
  onRepay?: (loanId: string, amount: string) => void
  onAddCollateral?: (loanId: string, collateralFalcon: string) => void
}) {
  const [withdrawAmt, setWithdrawAmt] = useState('')
  const [repayAmt, setRepayAmt] = useState('')
  const [addCollateralAmt, setAddCollateralAmt] = useState('')
  const ready = data?.protocol.txSigningReady

  const loans = data?.loans ?? []
  const repayableLoans = loans.filter(isRepayableLoan)
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null)
  const activeLoan =
    repayableLoans.find((l) => l.id === selectedLoanId) ?? repayableLoans[0] ?? null
  const repayDue = repayDueFusdc(activeLoan)
  const payFullAmount = fullRepayAmount(activeLoan)
  const walletFusdc = data?.wallet?.fusdcBalance ?? null
  const interestFees =
    repayDue != null && activeLoan != null
      ? Math.max(0, repayDue - activeLoan.principalFusdc)
      : null
  const repayBlocked = activeLoan && payFullAmount
    ? repayBlockedReason(data, activeLoan.id, payFullAmount)
    : null
  const loanDebt =
    activeLoan?.totalOutstandingFusdc ?? activeLoan?.principalFusdc ?? null
  const falconPerFusdc = data?.market.falconPerFusdc ?? null
  const addCollateralNum = parseFloat(addCollateralAmt)
  const projectedCollateral =
    activeLoan && Number.isFinite(addCollateralNum) && addCollateralNum > 0
      ? activeLoan.collateralFalcon + addCollateralNum
      : null
  const loanHealth =
    activeLoan && loanDebt != null && activeLoan.collateralFalcon > 0
      ? loanHealthSnapshot(
          activeLoan.collateralFalcon,
          loanDebt,
          falconPerFusdc,
        )
      : null
  const projectedHealth =
    activeLoan && loanDebt != null && projectedCollateral != null && projectedCollateral > 0
      ? loanHealthSnapshot(projectedCollateral, loanDebt, falconPerFusdc)
      : null
  const walletFalcon = data?.wallet?.falconBalance ?? null
  const addCollateralBlocked =
    activeLoan && addCollateralAmt.trim()
      ? (() => {
          const n = parseFloat(addCollateralAmt)
          if (!Number.isFinite(n) || n <= 0) return 'Enter how much FALCON to add.'
          if (walletFalcon != null && n > walletFalcon + 1e-9) {
            return `Insufficient FALCON in wallet (${walletFalcon.toLocaleString(undefined, { maximumFractionDigits: 4 })} available).`
          }
          return null
        })()
      : null
  const canAddCollateral =
    !!data?.protocol.lendingCollateral && !!activeLoan && isRepayableLoan(activeLoan)
  const lpPositions = data?.lpPositions ?? []
  const lp = lpPositions[0]
  const vault = data?.vaults?.[0]
  const withdrawOffered = parseFloat(withdrawAmt)
  const normalizedWithdraw =
    vault && Number.isFinite(withdrawOffered) && withdrawOffered > 0
      ? normalizeVaultWithdrawAmount(withdrawOffered, vault, lp?.shareBalance ?? null)
      : null
  const withdrawBlocked =
    withdrawAmt.trim() && data ? withdrawBlockedReason(data, withdrawAmt) : null
  const maxWithdraw =
    vault && lp && lp.shareBalance > 0 ? maxWithdrawFusdc(lp.shareBalance, vault) : null
  const hasOnChain = loans.length > 0 || lpPositions.length > 0

  useEffect(() => {
    if (!maxWithdraw || busy) return
    setWithdrawAmt((prev) => (prev.trim() ? prev : maxWithdraw))
  }, [maxWithdraw, busy])

  useEffect(() => {
    if (repayableLoans.length === 0) {
      setSelectedLoanId(null)
      return
    }
    if (!selectedLoanId || !repayableLoans.some((l) => l.id === selectedLoanId)) {
      setSelectedLoanId(repayableLoans[0].id)
    }
  }, [repayableLoans, selectedLoanId])

  useEffect(() => {
    if (!activeLoan || !payFullAmount) {
      setRepayAmt('')
      return
    }
    setRepayAmt(payFullAmount)
  }, [activeLoan?.id, activeLoan?.paymentDueRaw, activeLoan?.paymentDueFusdc, activeLoan?.totalOutstandingFusdc, payFullAmount])

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-white">Positions</h2>

      {!hasOnChain ? (
        <p className="text-sm text-slate-500">No supply or borrow positions on this account yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800">
                <th className="text-left py-2 pr-2">Type</th>
                <th className="text-right py-2 px-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {loans.filter(isRepayableLoan).map((loan) => (
                <tr key={loan.id} className="border-b border-slate-800/60 text-slate-300">
                  <td className="py-2 pr-2">
                    Borrow
                    {repayDueFusdc(loan) != null && repayDueFusdc(loan)! > loan.principalFusdc && (
                      <span className="text-slate-500 block text-[10px]">
                        payment due ~{fullRepayAmount(loan) ?? fmt(repayDueFusdc(loan), 6)} F-USDC
                      </span>
                    )}
                  </td>
                  <td className="text-right font-mono py-2 px-2">
                    {fmt(loan.principalFusdc, 2)} F-USDC
                  </td>
                </tr>
              ))}
              {lpPositions.map((lp, i) => (
                <tr key={`lp-${i}`} className="text-slate-300">
                  <td className="py-2 pr-2">
                    Supply
                    {lp.sharePct != null && (
                      <span className="text-slate-500 ml-1">({fmt(lp.sharePct, 2)}%)</span>
                    )}
                  </td>
                  <td className="text-right font-mono py-2 px-2">
                    {fmt(lp.shareBalance, 6)} shares
                    {lp.depositedFusdc != null && (
                      <span className="text-slate-500 block">≈ {fmt(lp.depositedFusdc, 6)} F-USDC</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lp && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs space-y-1">
          <div className="flex justify-between gap-3">
            <span className="text-slate-500">Epoch reward estimate</span>
            <span className="font-mono text-brand-300">
              {lp.estEpochRewardFalcon != null
                ? `${fmt(lp.estEpochRewardFalcon, 4)} FALCON`
                : '—'}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-slate-500">Claimable epoch</span>
            <span className="font-mono text-slate-200">
              {lp.claimableEpoch ?? '—'}
              {lp.canClaim ? ' · ready' : ''}
            </span>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => onClaim?.()}
        disabled={!ready || busy || !onClaim || !lp?.canClaim}
        className="w-full rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2.5 text-sm font-medium disabled:opacity-50"
      >
        {lp?.canClaim
          ? `Claim lender rewards${lp.estEpochRewardFalcon != null ? ` · ~${fmt(lp.estEpochRewardFalcon, 4)} FALCON` : ''}`
          : 'Claim lender rewards (none available)'}
      </button>

      {lp && lp.shareBalance > 0 && vault && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2.5 text-xs space-y-1">
          <div className="flex justify-between gap-3">
            <span className="text-slate-500">Vault shares</span>
            <span className="font-mono text-emerald-300">{fmt(lp.shareBalance, 6)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-slate-500">Liquid in vault</span>
            <span className="font-mono text-slate-200">{fmt(vault.assetsAvailable, 2)} F-USDC</span>
          </div>
          {lp.depositedFusdc != null && (
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Your supplied ≈</span>
              <span className="font-mono text-slate-200">{fmt(lp.depositedFusdc, 2)} F-USDC</span>
            </div>
          )}
        </div>
      )}

      {!vault && lp?.shareBalance ? (
        <p className="text-xs text-amber-300">Vault stats still loading — refresh the page, then try withdraw again.</p>
      ) : null}

      <div className="flex gap-2 items-stretch">
        <input
          type="text"
          inputMode="decimal"
          placeholder={maxWithdraw ? `Max ${maxWithdraw} F-USDC` : 'Withdraw F-USDC'}
          value={withdrawAmt}
          onChange={(e) => setWithdrawAmt(e.target.value)}
          disabled={!ready || busy || !lp?.shareBalance}
          className="flex-1 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-xs"
        />
        {maxWithdraw && !busy ? (
          <button
            type="button"
            onClick={() => setWithdrawAmt(maxWithdraw)}
            disabled={!ready}
            className="shrink-0 rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-2 text-xs font-medium text-brand-400 hover:bg-brand-500/20 disabled:opacity-50"
          >
            Max
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => {
          const amt = maxWithdraw ?? withdrawAmt
          if (amt && onWithdraw) onWithdraw(amt)
        }}
        disabled={
          !ready ||
          busy ||
          !onWithdraw ||
          !(maxWithdraw || (withdrawAmt.trim() && !withdrawBlocked))
        }
        className="w-full rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2.5 text-sm font-medium disabled:opacity-50"
      >
        {maxWithdraw
          ? `Withdraw all · ${maxWithdraw} F-USDC`
          : busy
            ? 'Signing…'
            : 'Withdraw supply'}
      </button>
      {normalizedWithdraw &&
        withdrawAmt &&
        Math.abs(parseFloat(normalizedWithdraw) - withdrawOffered) > 1e-9 && (
          <p className="text-[10px] text-slate-500">
            On-chain amount will be adjusted to{' '}
            <span className="font-mono text-slate-400">{normalizedWithdraw}</span> F-USDC for vault
            share math.
          </p>
        )}
      {withdrawBlocked && <p className="text-xs text-amber-300">{withdrawBlocked}</p>}

      {repayableLoans.length > 1 && (
        <label className="block text-xs">
          <span className="text-slate-500">Active loan</span>
          <select
            value={activeLoan?.id ?? ''}
            onChange={(e) => setSelectedLoanId(e.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-sm"
          >
            {repayableLoans.map((loan) => (
              <option key={loan.id} value={loan.id}>
                {loan.id.slice(0, 12)}… · {fmt(loan.principalFusdc, 2)} F-USDC
              </option>
            ))}
          </select>
        </label>
      )}

      {activeLoan && (
        <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 p-3 space-y-2">
          <div className="text-xs font-medium text-brand-200">
            Your borrow · loan health
            {repayableLoans.length > 1 && (
              <span className="text-slate-500 font-normal ml-1">
                ({repayableLoans.length} active)
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-950/60 rounded-lg px-3 py-2">
              <div className="text-slate-500">Debt outstanding</div>
              <div className="font-mono text-slate-200 mt-0.5">
                {fmt(loanDebt, 2)} F-USDC
              </div>
            </div>
            <div className="bg-slate-950/60 rounded-lg px-3 py-2">
              <div className="text-slate-500">FALCON collateral</div>
              <div className="font-mono text-brand-300 mt-0.5">
                {activeLoan.collateralFalcon > 0
                  ? `${fmt(activeLoan.collateralFalcon, 4)} FALCON`
                  : 'None on-chain (pre-amendment loan)'}
              </div>
            </div>
            <div className="bg-slate-950/60 rounded-lg px-3 py-2">
              <div className="text-slate-500">Health factor</div>
              <div
                className={`font-mono mt-0.5 ${
                  loanHealth ? hfStatusColor(loanHealth.status) : 'text-slate-400'
                }`}
              >
                {loanHealth?.healthFactor != null
                  ? `${fmt(loanHealth.healthFactor, 3)} · ${hfStatusLabel(loanHealth.status)}`
                  : '—'}
              </div>
            </div>
            <div className="bg-slate-950/60 rounded-lg px-3 py-2">
              <div className="text-slate-500">Liquidation if FALCON drops</div>
              <div className="font-mono text-amber-300 mt-0.5">
                {loanHealth?.liquidationDropPct != null
                  ? `${fmt(loanHealth.liquidationDropPct, 2)}%`
                  : '—'}
              </div>
            </div>
          </div>
          {loanHealth?.liquidationDropPct != null && (
            <p className="text-[10px] text-slate-500">
              A {fmt(loanHealth.liquidationDropPct, 2)}% FALCON price drop (debt unchanged) reaches liquidation
              threshold HF {LEND_LIQUIDATION_THRESHOLD}.
            </p>
          )}
          {activeLoan.collateralFalcon <= 0 && (
            <p className="text-[10px] text-amber-300/90">
              This loan has no on-chain collateral (opened before LendingCollateral). Repay and re-borrow after the
              amendment is enabled to lock FALCON in LoanSet.
            </p>
          )}
        </div>
      )}

      {activeLoan && canAddCollateral && (
        <div className="rounded-xl border border-brand-500/25 bg-brand-500/5 p-3 space-y-3">
          <div>
            <div className="text-xs font-medium text-brand-200">Add collateral</div>
            <p className="text-[10px] text-slate-400 mt-1">
              Lock more FALCON on this loan to raise health factor. Collateral stays locked until you repay or the loan
              is liquidated.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-950/60 rounded-lg px-3 py-2">
              <div className="text-slate-500">Your FALCON balance</div>
              <div className="font-mono text-brand-300 mt-0.5">
                {walletFalcon != null ? `${fmt(walletFalcon, 4)} FALCON` : '—'}
              </div>
            </div>
            <div className="bg-slate-950/60 rounded-lg px-3 py-2">
              <div className="text-slate-500">HF after add</div>
              <div
                className={`font-mono mt-0.5 ${
                  projectedHealth ? hfStatusColor(projectedHealth.status) : 'text-slate-400'
                }`}
              >
                {projectedHealth?.healthFactor != null
                  ? fmt(projectedHealth.healthFactor, 3)
                  : loanHealth?.healthFactor != null
                    ? fmt(loanHealth.healthFactor, 3)
                    : '—'}
              </div>
            </div>
          </div>
          <label className="block text-xs">
            <span className="text-slate-500">Additional FALCON</span>
            <input
              type="number"
              min="0"
              step="0.0001"
              value={addCollateralAmt}
              onChange={(e) => setAddCollateralAmt(e.target.value)}
              disabled={!ready || busy}
              placeholder="e.g. 100"
              className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => onAddCollateral?.(activeLoan.id, addCollateralAmt)}
            disabled={!ready || busy || !onAddCollateral || !!addCollateralBlocked || !addCollateralAmt}
            className="w-full rounded-lg bg-brand-500 hover:bg-brand-400 text-slate-950 px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            Add collateral (sign with passkey)
          </button>
          {addCollateralBlocked && (
            <p className="text-xs text-amber-300">{addCollateralBlocked}</p>
          )}
        </div>
      )}

      {activeLoan && payFullAmount && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 space-y-3">
          <div>
            <div className="text-xs font-medium text-amber-200">Repay borrow</div>
            <p className="text-[10px] text-slate-400 mt-1">
              Pay the full installment (principal + interest/fees). Amount is auto-filled below.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-950/60 rounded-lg px-3 py-2">
              <div className="text-slate-500">Principal borrowed</div>
              <div className="font-mono text-slate-200 mt-0.5">{fmt(activeLoan.principalFusdc, 2)} F-USDC</div>
            </div>
            <div className="bg-slate-950/60 rounded-lg px-3 py-2">
              <div className="text-slate-500">Interest + fees (this installment)</div>
              <div className="font-mono text-slate-200 mt-0.5">
                {interestFees != null ? `${fmt(interestFees, 6)} F-USDC` : '—'}
              </div>
            </div>
            <div className="bg-slate-950/60 rounded-lg px-3 py-2 col-span-2">
              <div className="text-slate-500">Your F-USDC balance</div>
              <div className="font-mono text-emerald-300 mt-0.5">
                {walletFusdc != null ? `${fmt(walletFusdc, 4)} F-USDC` : '—'}
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-[10px] text-slate-500">Repayment amount (auto-filled)</label>
            <input
              type="text"
              inputMode="decimal"
              readOnly
              value={repayAmt}
              disabled={!ready || busy}
              className="w-full rounded-lg bg-slate-950 border border-amber-500/30 px-3 py-2.5 font-mono text-sm text-amber-100"
            />
          </div>
          <button
            type="button"
            onClick={() => onRepay?.(activeLoan.id, payFullAmount)}
            disabled={!ready || busy || !onRepay || !!repayBlocked}
            className="w-full rounded-lg bg-brand-500 hover:bg-brand-400 text-slate-950 px-4 py-3 text-sm font-semibold disabled:opacity-50"
          >
            Pay full amount · {payFullAmount} F-USDC
          </button>
          {repayBlocked && (
            <p className="text-xs text-amber-300">{repayBlocked}</p>
          )}
        </div>
      )}
    </section>
  )
}