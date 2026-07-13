'use client'

import { useEffect, useState } from 'react'
import { LEND_FIXED_APR_BPS, type LendOverview } from '@/lib/lend-model'
import {
  borrowBlockedReason,
  fullRepayAmount,
  isRepayableLoan,
  minBrokerCoverForPrincipal,
  repayBlockedReason,
  repayDueFusdc,
} from '@/lib/lend-borrow-errors'
import { normalizeVaultDepositAmount, supplyBlockedReason } from '@/lib/lend-vault-deposit'

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
            ? lending.cosignReady
              ? 'Supply (VaultDeposit), borrow (LoanSet + broker co-sign), claim (ClaimLPReward), and repay (LoanPay) are wired.'
              : 'Supply and claim work from the portal. Borrow needs TESTNET_LENDING_BROKER_SECRET on the server for co-sign.'
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

export function LendPoolOverviewPanel({ data }: { data: LendOverview | null }) {
  const vault = data?.vaults?.[0]
  const pool = data?.pool
  const position = data?.lpPositions?.[0]
  const hasWallet = !!data?.wallet
  const walletAddr = data?.wallet?.address

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
            F-USDC when loans open; broker cover backs lenders separately.
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
                <div className="text-[10px] text-slate-600">active loans</div>
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
                  <div>
                    <div className="text-slate-500">Broker cover</div>
                    <div className={`font-mono ${pool.borrow.brokerCoverFusdc < 0.01 ? 'text-amber-400' : 'text-slate-200'}`}>
                      {fmt(pool.borrow.brokerCoverFusdc, 2)} F-USDC
                    </div>
                    {pool.borrow.brokerCoverFusdc < 0.01 && (
                      <div className="text-[10px] text-amber-500/90 mt-0.5">Required before borrows open</div>
                    )}
                  </div>
                  <div>
                    <div className="text-slate-500">Debt cap</div>
                    <div className="font-mono text-slate-200">
                      {pool.borrow.debtMaximumFusdc != null
                        ? `${fmt(pool.borrow.debtMaximumFusdc, 0)} F-USDC`
                        : '—'}
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
      {data?.wallet && !data.wallet.hasFusdcTrustLine && (
        <p className="text-xs text-amber-400">Add a F-USDC trust line on Wallet → Bridge or Swap first.</p>
      )}
      <label className="block text-xs">
        <span className="text-slate-500">Amount (F-USDC)</span>
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
  onBorrow?: (principal: string) => void
}) {
  const [borrow, setBorrow] = useState('')
  const borrowNum = parseFloat(borrow)
  const blocked = borrowBlockedReason(
    data,
    Number.isFinite(borrowNum) && borrowNum > 0 ? borrowNum : undefined,
  )
  const ready =
    data?.protocol.txSigningReady && data?.lending.cosignReady && !!onBorrow && !blocked

  const handle = () => {
    if (!Number.isFinite(borrowNum) || borrowNum <= 0) return
    onBorrow?.(borrow)
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-white">Borrow F-USDC</h2>
      <p className="text-xs text-slate-500">
        Open a loan via <code className="text-slate-400">LoanSet</code>. You sign as borrower; the testnet broker
        owner co-signs <code className="text-slate-400">CounterpartySignature</code> server-side.
      </p>
      {!data?.lending.cosignReady && data?.protocol.txSigningReady && (
        <p className="text-xs text-amber-400">
          Broker co-sign secret not on server — borrow disabled until TESTNET_LENDING_BROKER_SECRET is set.
        </p>
      )}
      {blocked && data?.protocol.txSigningReady && (
        <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2.5">
          {blocked}
        </p>
      )}
      {data?.pool && (
        <p className="text-[10px] text-slate-600">
          Vault available: {fmt(data.pool.supply.availableFusdc, 2)} F-USDC · Broker cover:{' '}
          {fmt(data.pool.borrow.brokerCoverFusdc, 2)} F-USDC
          {Number.isFinite(borrowNum) && borrowNum > 0 && data.pool.borrow.coverRateMinPct != null && (
            <>
              {' '}
              · min cover for {fmt(borrowNum, 0)} borrow: ~
              {fmt(minBrokerCoverForPrincipal(borrowNum, data.pool.borrow.coverRateMinPct), 2)} F-USDC
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
          onChange={(e) => setBorrow(e.target.value)}
          disabled={!ready || busy}
          className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-sm disabled:opacity-50"
        />
      </label>
      <button
        type="button"
        onClick={handle}
        disabled={!ready || busy || !borrow}
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
}: {
  data: LendOverview | null
  busy?: boolean
  onClaim?: () => void
  onWithdraw?: (amount: string) => void
  onRepay?: (loanId: string, amount: string) => void
}) {
  const [withdrawAmt, setWithdrawAmt] = useState('')
  const [repayAmt, setRepayAmt] = useState('')
  const ready = data?.protocol.txSigningReady

  const loans = data?.loans ?? []
  const repayableLoans = loans.filter(isRepayableLoan)
  const activeLoan = repayableLoans[0] ?? null
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
  const lpPositions = data?.lpPositions ?? []
  const hasOnChain = loans.length > 0 || lpPositions.length > 0

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
                    {fmt(lp.shareBalance, 0)} shares
                    {lp.depositedFusdc != null && (
                      <span className="text-slate-500 block">≈ {fmt(lp.depositedFusdc, 2)} F-USDC</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button
        type="button"
        onClick={() => onClaim?.()}
        disabled={!ready || busy || !onClaim}
        className="w-full rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2.5 text-sm font-medium disabled:opacity-50"
      >
        Claim lender rewards
      </button>

      <div className="flex gap-2">
        <input
          type="number"
          min="0"
          placeholder="Withdraw F-USDC"
          value={withdrawAmt}
          onChange={(e) => setWithdrawAmt(e.target.value)}
          disabled={!ready || busy}
          className="flex-1 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-xs"
        />
        <button
          type="button"
          onClick={() => withdrawAmt && onWithdraw?.(withdrawAmt)}
          disabled={!ready || busy || !withdrawAmt || !onWithdraw}
          className="px-4 py-2 rounded-lg bg-slate-800 text-slate-200 text-sm disabled:opacity-50"
        >
          Withdraw supply
        </button>
      </div>

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