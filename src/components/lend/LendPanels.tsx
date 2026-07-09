'use client'

import { useMemo, useState } from 'react'
import {
  LEND_FIXED_APR_BPS,
  LEND_GRACE_HOURS,
  LEND_MIN_COLLATERAL_RATIO,
  LEND_LIQUIDATION_THRESHOLD,
  healthFactor,
  hfStatus,
  type LendOverview,
} from '@/lib/lend-model'

function fmt(n: number | null | undefined, digits = 4): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

const HF_COLORS: Record<ReturnType<typeof hfStatus>, string> = {
  healthy: 'text-emerald-400',
  warning: 'text-amber-400',
  grace: 'text-orange-400',
  liquidatable: 'text-red-400',
  none: 'text-slate-500',
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

export function LendWalletCard({ data }: { data: LendOverview | null }) {
  if (!data?.wallet) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-500">
        Connect a wallet on the Wallet tab to see balances here.
      </section>
    )
  }
  const w = data.wallet
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-2">
      <h2 className="text-sm font-semibold text-white">Your balances</h2>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="text-slate-500">FALCON</div>
          <div className="font-mono text-slate-200">{fmt(w.falconBalance, 2)}</div>
        </div>
        <div>
          <div className="text-slate-500">F-USDC</div>
          <div className="font-mono text-slate-200">
            {w.hasFusdcTrustLine ? fmt(w.fusdcBalance, 2) : 'No trust line'}
          </div>
        </div>
      </div>
      {data.market.falconPerFusdc != null && (
        <p className="text-xs text-slate-500">
          DEX price: 1 F-USDC ≈ {fmt(1 / data.market.falconPerFusdc, 2)} FALCON
        </p>
      )}
    </section>
  )
}

export function LendHealthCalculator({ data }: { data: LendOverview | null }) {
  const [collateral, setCollateral] = useState('1500')
  const [debt, setDebt] = useState('1000')
  const price = data?.market.falconPerFusdc ?? null

  const parsed = useMemo(() => {
    const c = parseFloat(collateral)
    const d = parseFloat(debt)
    if (!Number.isFinite(c) || !Number.isFinite(d) || price == null || price <= 0) {
      return { hf: null as number | null, status: 'none' as const }
    }
    const hf = healthFactor(c, d, price)
    return { hf, status: hfStatus(hf) }
  }, [collateral, debt, price])

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-white">Health factor calculator</h2>
      <p className="text-xs text-slate-500">
        Preview calculator (XRPL loans use broker cover, not on-ledger FALCON collateral). Min ratio{' '}
        {LEND_MIN_COLLATERAL_RATIO * 100}% · liquidation below {LEND_LIQUIDATION_THRESHOLD}.
      </p>
      {price == null ? (
        <p className="text-sm text-amber-400/90">No DEX price — add liquidity on Pool or Swap first.</p>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-xs">
              <span className="text-slate-500">Collateral (FALCON)</span>
              <input
                type="number"
                min="0"
                value={collateral}
                onChange={(e) => setCollateral(e.target.value)}
                className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="block text-xs">
              <span className="text-slate-500">Debt (F-USDC)</span>
              <input
                type="number"
                min="0"
                value={debt}
                onChange={(e) => setDebt(e.target.value)}
                className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-sm"
              />
            </label>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-slate-500">Health factor</span>
            <span className={`text-2xl font-mono font-semibold ${HF_COLORS[parsed.status]}`}>
              {parsed.hf != null ? parsed.hf.toFixed(3) : '—'}
            </span>
          </div>
        </>
      )}
    </section>
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

  const handle = () => {
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
        share MPTs and earn borrower interest plus PoPL epoch emissions.
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
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={!ready || busy}
          className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-sm disabled:opacity-50"
        />
      </label>
      <button
        type="button"
        onClick={handle}
        disabled={!ready || busy || !amount}
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
  const ready =
    data?.protocol.txSigningReady && data?.lending.cosignReady && !!onBorrow

  const handle = () => {
    const n = parseFloat(borrow)
    if (!Number.isFinite(n) || n <= 0) return
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
  const lpPositions = data?.lpPositions ?? []
  const hasOnChain = loans.length > 0 || lpPositions.length > 0

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
              {loans.map((loan) => (
                <tr key={loan.id} className="border-b border-slate-800/60 text-slate-300">
                  <td className="py-2 pr-2">Borrow</td>
                  <td className="text-right font-mono py-2 px-2">
                    {fmt(loan.principalFusdc, 2)} F-USDC
                  </td>
                </tr>
              ))}
              {lpPositions.map((lp, i) => (
                <tr key={`lp-${i}`} className="text-slate-300">
                  <td className="py-2 pr-2">Supply (vault shares)</td>
                  <td className="text-right font-mono py-2 px-2">{fmt(lp.shareBalance, 0)}</td>
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
        Claim LP epoch rewards
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

      {loans[0] && (
        <div className="flex gap-2">
          <input
            type="number"
            min="0"
            placeholder="Repay F-USDC"
            value={repayAmt}
            onChange={(e) => setRepayAmt(e.target.value)}
            disabled={!ready || busy}
            className="flex-1 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => repayAmt && onRepay?.(loans[0].id, repayAmt)}
            disabled={!ready || busy || !repayAmt || !onRepay}
            className="px-4 py-2 rounded-lg bg-slate-800 text-slate-200 text-sm disabled:opacity-50"
          >
            Repay loan
          </button>
        </div>
      )}
    </section>
  )
}