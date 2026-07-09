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
  const { protocol } = data
  if (protocol.lendingReady) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-200">
        Lending protocol is active on this network. Supply, borrow, and claim flows are enabled.
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-100 space-y-1">
      <p>
        <span className="font-medium text-amber-200">Preview mode.</span> Vault / loan transactions need the
        updated node build plus a genesis restart with{' '}
        <code className="text-amber-100/90">SingleAssetVault</code> and{' '}
        <code className="text-amber-100/90">LendingProtocol</code> enabled.
      </p>
      <p className="text-xs text-amber-200/80">
        Live now: wallet balances, AMM price, and health-factor calculator.
        Vault={protocol.singleAssetVault ? 'on' : 'off'} · Lending={protocol.lendingProtocol ? 'on' : 'off'}
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
        Uses live AMM mid price. Min collateral {LEND_MIN_COLLATERAL_RATIO * 100}% · liquidation below{' '}
        {LEND_LIQUIDATION_THRESHOLD} · {LEND_GRACE_HOURS}h grace before liquidation (manual top-up).
      </p>
      {price == null ? (
        <p className="text-sm text-amber-400/90">No AMM pool — add liquidity on the Pool tab first.</p>
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

function DisabledAction({ label, reason }: { label: string; reason: string }) {
  return (
    <button
      type="button"
      disabled
      title={reason}
      className="w-full rounded-lg bg-slate-800 text-slate-500 px-4 py-2.5 text-sm font-medium cursor-not-allowed"
    >
      {label}
    </button>
  )
}

const PENDING = 'Available after genesis restart and lending amendments are active.'

export function LendSupplyPanel({ data }: { data: LendOverview | null }) {
  const [amount, setAmount] = useState('')
  const ready = data?.protocol.lendingReady
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-white">Supply F-USDC</h2>
      <p className="text-xs text-slate-500">
        Deposit into a lending vault (upstream <code className="text-slate-400">VaultDeposit</code>). Earn
        borrower interest on your vault share MPT.
      </p>
      <div className="text-xs text-slate-400">
        Fixed pool APR: {(LEND_FIXED_APR_BPS / 100).toFixed(2)}%
      </div>
      <label className="block text-xs">
        <span className="text-slate-500">Amount (F-USDC)</span>
        <input
          type="number"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={!ready}
          className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-sm disabled:opacity-50"
        />
      </label>
      {ready ? (
        <button type="button" className="w-full rounded-lg bg-brand-500 text-white px-4 py-2.5 text-sm font-medium">
          Supply (sign with passkey)
        </button>
      ) : (
        <DisabledAction label="Supply — pending chain" reason={PENDING} />
      )}
    </section>
  )
}

export function LendBorrowPanel({ data }: { data: LendOverview | null }) {
  const [borrow, setBorrow] = useState('')
  const [collateral, setCollateral] = useState('')
  const price = data?.market.falconPerFusdc ?? null
  const ready = data?.protocol.lendingReady

  const needCollateral = useMemo(() => {
    const b = parseFloat(borrow)
    if (!Number.isFinite(b) || b <= 0 || price == null || price <= 0) return null
    return (b * LEND_MIN_COLLATERAL_RATIO) / price
  }, [borrow, price])

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-white">Borrow F-USDC</h2>
      <p className="text-xs text-slate-500">
        Post FALCON collateral via <code className="text-slate-400">LoanSet</code>. Non-custodial — you sign
        collateral top-ups; alerts fire when health factor drops.
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block text-xs">
          <span className="text-slate-500">Borrow (F-USDC)</span>
          <input
            type="number"
            min="0"
            value={borrow}
            onChange={(e) => setBorrow(e.target.value)}
            disabled={!ready}
            className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-sm disabled:opacity-50"
          />
        </label>
        <label className="block text-xs">
          <span className="text-slate-500">Collateral (FALCON)</span>
          <input
            type="number"
            min="0"
            value={collateral}
            onChange={(e) => setCollateral(e.target.value)}
            disabled={!ready}
            placeholder={needCollateral != null ? `min ~${fmt(needCollateral, 0)}` : ''}
            className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-sm disabled:opacity-50"
          />
        </label>
      </div>
      {ready ? (
        <button type="button" className="w-full rounded-lg bg-brand-500 text-white px-4 py-2.5 text-sm font-medium">
          Borrow (sign with passkey)
        </button>
      ) : (
        <DisabledAction label="Borrow — pending chain" reason={PENDING} />
      )}
    </section>
  )
}

export function LendPositionsPanel({ data }: { data: LendOverview | null }) {
  const [demo, setDemo] = useState(true)
  const price = data?.market.falconPerFusdc ?? 0.5
  const demoLoan = {
    principalFusdc: 1000,
    collateralFalcon: 1500,
    hf: healthFactor(1500, 1000, price),
  }

  const hasOnChain = (data?.loans.length ?? 0) > 0 || (data?.lpPositions.length ?? 0) > 0

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">Positions</h2>
        {!hasOnChain && (
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={demo}
              onChange={(e) => setDemo(e.target.checked)}
              className="rounded border-slate-600"
            />
            Show demo layout
          </label>
        )}
      </div>

      {hasOnChain ? (
        <p className="text-xs text-slate-500">On-chain loans and LP positions will list here.</p>
      ) : demo ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800">
                <th className="text-left py-2 pr-2">Type</th>
                <th className="text-right py-2 px-2">Principal / Shares</th>
                <th className="text-right py-2 px-2">Collateral</th>
                <th className="text-right py-2 pl-2">HF</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-800/60 text-slate-300">
                <td className="py-2 pr-2">
                  Borrow <span className="text-slate-600">(demo)</span>
                </td>
                <td className="text-right font-mono py-2 px-2">{fmt(demoLoan.principalFusdc, 0)} F-USDC</td>
                <td className="text-right font-mono py-2 px-2">{fmt(demoLoan.collateralFalcon, 0)} FALCON</td>
                <td className={`text-right font-mono py-2 pl-2 ${HF_COLORS[hfStatus(demoLoan.hf)]}`}>
                  {demoLoan.hf?.toFixed(2) ?? '—'}
                </td>
              </tr>
              <tr className="text-slate-300">
                <td className="py-2 pr-2">
                  Supply <span className="text-slate-600">(demo)</span>
                </td>
                <td className="text-right font-mono py-2 px-2">500 shares</td>
                <td className="text-right py-2 px-2 text-slate-500">—</td>
                <td className="text-right py-2 pl-2 text-slate-500">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-500">No lending positions on this account.</p>
      )}

      <DisabledAction label="Claim supply rewards" reason={PENDING} />
      <DisabledAction label="Repay / withdraw" reason={PENDING} />
    </section>
  )
}