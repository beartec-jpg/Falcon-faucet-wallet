'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/Header'
import NetworkBanner from '@/components/NetworkBanner'
import { useNetwork } from '@/components/NetworkProvider'
import { withNetworkQuery } from '@/lib/network-query'
import { loadPrimaryWallet, type StoredWallet } from '@/lib/wallet-store'
import { authenticatePasskey, isPasskeySupported } from '@/lib/passkey'
import { decryptSeed } from '@/lib/wallet-crypto'
import type { LendOverview } from '@/lib/lend-model'
import {
  LendProtocolBanner,
  LendPoolOverviewPanel,
  LendSupplyPanel,
  LendBorrowPanel,
  LendPositionsPanel,
} from '@/components/lend/LendPanels'
import { submitWithSequenceRetry, fetchSequenceInfo } from '@/lib/wallet-submit'
import {
  signVaultDepositTx,
  signVaultWithdrawTx,
  signClaimLPRewardTx,
  signLoanSetBorrowerTx,
  signLoanPayTx,
  signLoanCollateralDepositTx,
  signVaultClaimCollateralTx,
} from '@/lib/falcon-lend-tx-sign'
import { addCollateralBlockedReason } from '@/lib/lend-collateral-deposit'
import {
  borrowBlockedReason,
  explainLendSubmitError,
  repayBlockedReason,
} from '@/lib/lend-borrow-errors'
import { collateralBlockedReason } from '@/lib/lend-collateral'
import { collateralDropsFromFalcon } from '@/lib/lend-loan-onchain'
import { clampLoanEpochs, formatLoanDuration, paymentIntervalForEpochs } from '@/lib/lend-loan-terms'
import { supplyBlockedReason } from '@/lib/lend-vault-deposit'
import { withdrawBlockedReason } from '@/lib/lend-vault-withdraw'

type Tab = 'overview' | 'supply' | 'borrow' | 'positions'

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin-slow ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'supply', label: 'Supply' },
  { key: 'borrow', label: 'Borrow' },
  { key: 'positions', label: 'Positions' },
]

export default function LendPage() {
  const { networkKey, network } = useNetwork()
  const [tab, setTab] = useState<Tab>('overview')
  const [wallet, setWallet] = useState<StoredWallet | null>(null)
  const [data, setData] = useState<LendOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async (address?: string) => {
    const base = address
      ? `/api/lend/overview?address=${encodeURIComponent(address)}`
      : '/api/lend/overview'
    const r = await fetch(withNetworkQuery(base, networkKey))
    const j = await r.json()
    if (!r.ok) throw new Error(j.error ?? 'Failed to load lending data')
    setData(j as LendOverview)
  }, [networkKey])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    loadPrimaryWallet()
      .then(async (w) => {
        if (!cancelled) setWallet(w)
        await refresh(w?.address)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Load failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  const withSecret = useCallback(
    async (fn: (falcon_secret: string) => Promise<void>) => {
      if (!wallet) {
        setError('No wallet loaded. Open the Wallet tab, unlock with your passkey, then return to Lend.')
        return
      }
      if (!network.live) {
        setError(network.comingSoonMessage ?? 'This network is not live — cannot sign transactions.')
        return
      }
      if (!isPasskeySupported()) {
        setError('Passkey not supported in this browser')
        return
      }
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
        const falcon_secret = await decryptSeed(wallet.encrypted, keyBytes)
        await fn(falcon_secret)
        setTimeout(() => refresh(wallet.address), 4000)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Transaction failed')
      } finally {
        setBusy(false)
      }
    },
    [wallet, network.live, network.comingSoonMessage, refresh],
  )

  const handleSupply = useCallback(
    async (amount: string) => {
      const lend = data?.lending
      const tok = data?.token
      if (!wallet || !lend?.vaultId || !tok?.issuer) return
      const blocked = supplyBlockedReason(data, amount)
      if (blocked) {
        setError(blocked)
        return
      }
      const preflightR = await fetch(withNetworkQuery('/api/lend/supply-preflight', networkKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: wallet.address, offered: amount }),
      })
      const preflight = (await preflightR.json()) as {
        error?: string
        chainAmount?: string
        offered?: number
        adjusted?: boolean
        fusdcBalance?: number | null
      }
      if (!preflightR.ok || !preflight.chainAmount) {
        setError(preflight.error ?? 'Supply preflight failed')
        return
      }
      const { chainAmount, offered = parseFloat(amount), adjusted = false } = preflight
      await withSecret(async (falcon_secret) => {
        try {
          await submitWithSequenceRetry({
            networkKey,
            fetchSequence: async () => {
              const a = await fetchSequenceInfo(wallet.address, networkKey)
              return { sequence: a.sequence, currentLedger: a.currentLedger }
            },
            sign: ({ sequence, lastLedgerSequence }) =>
              signVaultDepositTx(
                {
                  account: wallet.address,
                  vaultId: lend.vaultId!,
                  currency: tok.currency,
                  issuer: tok.issuer,
                  amount: chainAmount,
                  sequence,
                  lastLedgerSequence,
                  networkId: network.networkId,
                },
                falcon_secret,
              ),
          })
        } catch (e: unknown) {
          const raw = e instanceof Error ? e.message : ''
          const [code, ...rest] = raw.split(' — ')
          throw new Error(explainLendSubmitError(code, rest.join(' — '), data) || raw || 'Supply failed')
        }
        const notice =
          adjusted && chainAmount !== String(offered)
            ? `Supplied ${chainAmount} F-USDC to vault (adjusted from ${offered} for vault share precision)`
            : `Supplied ${chainAmount} F-USDC to vault`
        setNotice(notice)
      })
    },
    [data, wallet, withSecret, networkKey, network.networkId],
  )

  const handleBorrow = useCallback(
    async (principal: string, collateralFalcon: string, loanEpochs: number) => {
      const lend = data?.lending
      if (!wallet || !lend?.loanBrokerId) return
      const permissionless =
        data?.protocol.lendingPermissionless && data?.protocol.lendingCollateral
      if (!permissionless && !lend.cosignReady) {
        setError('Borrow co-sign not configured — set TESTNET_LENDING_BROKER_SECRET on server')
        return
      }
      const principalNum = parseFloat(principal)
      const collateralNum = parseFloat(collateralFalcon)
      const blocked = borrowBlockedReason(data, Number.isFinite(principalNum) ? principalNum : undefined)
      if (blocked) {
        setError(blocked)
        return
      }
      const collateralBlock = collateralBlockedReason(
        principalNum,
        collateralNum,
        data?.wallet?.falconBalance,
        data?.market.falconPerFusdc,
      )
      if (collateralBlock) {
        setError(collateralBlock)
        return
      }
      const preflightR = await fetch(withNetworkQuery('/api/lend/borrow-preflight', networkKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: wallet.address,
          principal,
          collateralFalcon,
          loanEpochs: clampLoanEpochs(loanEpochs),
        }),
      })
      const preflight = (await preflightR.json()) as { error?: string }
      if (!preflightR.ok) {
        setError(preflight.error ?? 'Borrow preflight failed')
        return
      }
      const epochs = clampLoanEpochs(loanEpochs)
      const paymentInterval = paymentIntervalForEpochs(epochs)
      const paymentTotal = 1
      const gracePeriod = 3600

      await withSecret(async (falcon_secret) => {
        const { sequence, currentLedger } = await fetchSequenceInfo(wallet.address, networkKey)
        const lastLedgerSequence = currentLedger + 20
        if (permissionless) {
          await submitWithSequenceRetry({
            networkKey,
            fetchSequence: async () => ({ sequence, currentLedger: currentLedger }),
            sign: ({ sequence: seq, lastLedgerSequence: ll }) =>
              signLoanSetBorrowerTx(
                {
                  account: wallet.address,
                  loanBrokerId: lend.loanBrokerId!,
                  principalRequested: principal,
                  collateralDrops: collateralDropsFromFalcon(collateralNum),
                  interestRateTenthBps: lend.interestRateTenthBps ?? 5000,
                  paymentInterval,
                  paymentTotal,
                  gracePeriod,
                  sequence: seq,
                  lastLedgerSequence: ll,
                  networkId: network.networkId,
                },
                falcon_secret,
              ).then((r) => ({ tx_blob: r.tx_blob })),
          })
        } else {
          const { tx_json } = await signLoanSetBorrowerTx(
            {
              account: wallet.address,
              loanBrokerId: lend.loanBrokerId!,
              principalRequested: principal,
              collateralDrops: collateralDropsFromFalcon(collateralNum),
              interestRateTenthBps: lend.interestRateTenthBps ?? 5000,
              paymentInterval,
              paymentTotal,
              gracePeriod,
              sequence,
              lastLedgerSequence,
              networkId: network.networkId,
            },
            falcon_secret,
          )
          const cosignR = await fetch(withNetworkQuery('/api/lend/cosign', networkKey), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tx_json }),
          })
          const cosignJ = await cosignR.json()
          if (!cosignR.ok || !cosignJ.tx_blob) {
            throw new Error(cosignJ.error ?? 'Broker co-sign failed')
          }
          const subR = await fetch('/api/wallet/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tx_blob: cosignJ.tx_blob, network: networkKey }),
          })
          const subJ = await subR.json()
          if (!subJ.success) {
            throw new Error(explainLendSubmitError(subJ.result, subJ.message, data))
          }
        }
        setNotice(
          `Borrowed ${principal} F-USDC for ${formatLoanDuration(epochs)} — ${collateralFalcon} FALCON locked as collateral`,
        )
      })
    },
    [data, wallet, withSecret, networkKey, network.networkId],
  )

  const handleClaim = useCallback(async () => {
    const lend = data?.lending
    if (!wallet || !lend?.vaultId) return
    const lp = data?.lpPositions?.[0]
    const preflightR = await fetch(withNetworkQuery('/api/lend/claim-preflight', networkKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: wallet.address }),
    })
    const preflight = (await preflightR.json()) as {
      error?: string
      canClaim?: boolean
      estEpochRewardFalcon?: number | null
    }
    if (!preflightR.ok || !preflight.canClaim) {
      setError(preflight.error ?? 'No LP rewards to claim')
      return
    }
    await withSecret(async (falcon_secret) => {
      try {
        await submitWithSequenceRetry({
          networkKey,
          fetchSequence: async () => {
            const a = await fetchSequenceInfo(wallet.address, networkKey)
            return { sequence: a.sequence, currentLedger: a.currentLedger }
          },
          sign: ({ sequence, lastLedgerSequence }) =>
            signClaimLPRewardTx(
              {
                account: wallet.address,
                vaultId: lend.vaultId!,
                sequence,
                lastLedgerSequence,
                networkId: network.networkId,
              },
              falcon_secret,
            ),
        })
      } catch (e: unknown) {
        const raw = e instanceof Error ? e.message : ''
        if (raw.includes('ClaimLPReward') || raw.includes('Unable to interpret')) {
          throw new Error(
            'Claim signing failed — refresh the page and try again. If this persists, the portal build may be stale.',
          )
        }
        const [code, ...rest] = raw.split(' — ')
        throw new Error(explainLendSubmitError(code, rest.join(' — '), data, { context: 'claim' }) || raw || 'Claim failed')
      }
      setNotice(
        preflight.estEpochRewardFalcon != null
          ? `LP epoch rewards claimed (~${preflight.estEpochRewardFalcon} FALCON)`
          : 'LP epoch rewards claimed',
      )
    })
  }, [data, wallet, withSecret, networkKey, network.networkId])

  const handleWithdraw = useCallback(
    async (amount: string) => {
      const lend = data?.lending
      const tok = data?.token
      if (!wallet || !lend?.vaultId || !tok?.issuer) return
      const blocked = withdrawBlockedReason(data, amount)
      if (blocked) {
        setError(blocked)
        return
      }
      const preflightR = await fetch(withNetworkQuery('/api/lend/withdraw-preflight', networkKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: wallet.address, offered: amount }),
      })
      const preflight = (await preflightR.json()) as {
        error?: string
        chainAmount?: string
        offered?: number
        adjusted?: boolean
        shareBalance?: number
        assetsAvailable?: number
      }
      if (!preflightR.ok || !preflight.chainAmount) {
        setError(preflight.error ?? 'Withdraw preflight failed')
        return
      }
      const { chainAmount, offered = parseFloat(amount), adjusted = false } = preflight
      await withSecret(async (falcon_secret) => {
        try {
          await submitWithSequenceRetry({
            networkKey,
            fetchSequence: async () => {
              const a = await fetchSequenceInfo(wallet.address, networkKey)
              return { sequence: a.sequence, currentLedger: a.currentLedger }
            },
            sign: ({ sequence, lastLedgerSequence }) =>
              signVaultWithdrawTx(
                {
                  account: wallet.address,
                  vaultId: lend.vaultId!,
                  currency: tok.currency,
                  issuer: tok.issuer,
                  amount: chainAmount,
                  sequence,
                  lastLedgerSequence,
                  networkId: network.networkId,
                },
                falcon_secret,
              ),
          })
        } catch (e: unknown) {
          const raw = e instanceof Error ? e.message : ''
          const [code, ...rest] = raw.split(' — ')
          throw new Error(
            explainLendSubmitError(code, rest.join(' — '), data, { context: 'withdraw' }) ||
              raw ||
              'Withdraw failed',
          )
        }
        const notice =
          adjusted && chainAmount !== String(offered)
            ? `Withdrew ${chainAmount} F-USDC from vault (adjusted from ${offered} for share precision)`
            : `Withdrew ${chainAmount} F-USDC from vault`
        setNotice(notice)
      })
    },
    [data, wallet, withSecret, networkKey, network.networkId],
  )

  const handleAddCollateral = useCallback(
    async (loanId: string, collateralFalcon: string) => {
      if (!wallet) return
      const collateralNum = parseFloat(collateralFalcon)
      const blocked = addCollateralBlockedReason(data, loanId, collateralNum)
      if (blocked) {
        setError(blocked)
        return
      }
      const preflightR = await fetch(
        withNetworkQuery('/api/lend/collateral-deposit-preflight', networkKey),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: wallet.address,
            loanId,
            collateralFalcon,
          }),
        },
      )
      const preflight = (await preflightR.json()) as {
        error?: string
        collateralDrops?: string
      }
      if (!preflightR.ok || !preflight.collateralDrops) {
        setError(preflight.error ?? 'Add collateral preflight failed')
        return
      }
      await withSecret(async (falcon_secret) => {
        try {
          await submitWithSequenceRetry({
            networkKey,
            fetchSequence: async () => {
              const a = await fetchSequenceInfo(wallet.address, networkKey)
              return { sequence: a.sequence, currentLedger: a.currentLedger }
            },
            sign: ({ sequence, lastLedgerSequence }) =>
              signLoanCollateralDepositTx(
                {
                  account: wallet.address,
                  loanId,
                  collateralDrops: preflight.collateralDrops!,
                  sequence,
                  lastLedgerSequence,
                  networkId: network.networkId,
                },
                falcon_secret,
              ),
          })
        } catch (e: unknown) {
          const raw = e instanceof Error ? e.message : ''
          const [code, ...rest] = raw.split(' — ')
          throw new Error(
            explainLendSubmitError(code, rest.join(' — '), data, { context: 'borrow' }) ||
              raw ||
              'Add collateral failed',
          )
        }
        setNotice(`Added ${collateralFalcon} FALCON collateral to loan`)
      })
    },
    [data, wallet, withSecret, networkKey, network.networkId],
  )

  const handleClaimLiquidation = useCallback(async () => {
    if (!wallet) {
      setError('No wallet loaded. Open the Wallet tab, unlock with your passkey, then return to Lend.')
      return
    }
    const brokerId = data?.lending?.loanBrokerId
    if (!brokerId) {
      setError('Loan broker not configured.')
      return
    }
    await withSecret(async (falcon_secret) => {
      await submitWithSequenceRetry({
        networkKey,
        fetchSequence: async () => {
          const a = await fetchSequenceInfo(wallet.address, networkKey)
          return { sequence: a.sequence, currentLedger: a.currentLedger }
        },
        sign: ({ sequence, lastLedgerSequence }) =>
          signVaultClaimCollateralTx(
            {
              account: wallet.address,
              loanBrokerId: brokerId,
              sequence,
              lastLedgerSequence,
              networkId: network.networkId,
            },
            falcon_secret,
          ),
      })
      setNotice('Claimed liquidation FALCON to your wallet')
    })
  }, [data, wallet, withSecret, networkKey, network.networkId])

  const handleRepay = useCallback(
    async (loanId: string, amount: string) => {
      const tok = data?.token
      if (!wallet) {
        setError('No wallet loaded. Open the Wallet tab, unlock with your passkey, then return to Lend.')
        return
      }
      if (!tok?.issuer) {
        setError('F-USDC token config missing — cannot repay.')
        return
      }
      const loan = data?.loans?.find((l) => l.id === loanId)
      const blocked = repayBlockedReason(data, loanId, amount)
      if (blocked) {
        setError(blocked)
        return
      }
      const preflightR = await fetch(withNetworkQuery('/api/lend/repay-preflight', networkKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: wallet.address, loanId, amount }),
      })
      let preflight: {
        error?: string
        amount?: string
        stage?: string
        simulateResult?: string
        simulateMessage?: string
      } = {}
      try {
        preflight = (await preflightR.json()) as typeof preflight
      } catch {
        setError(`Repay preflight failed (HTTP ${preflightR.status})`)
        return
      }
      if (!preflightR.ok) {
        const detail = [
          preflight.error,
          preflight.stage ? `[${preflight.stage}]` : '',
          preflight.simulateResult,
        ]
          .filter(Boolean)
          .join(' ')
        // Soft-recover: if preflight only failed simulate NetworkID policy, still repay.
        const soft =
          preflight.simulateResult === 'telNETWORK_ID_MAKES_TX_NON_CANONICAL' ||
          (typeof preflight.error === 'string' &&
            preflight.error.includes('NETWORK_ID_MAKES_TX_NON_CANONICAL'))
        if (!soft) {
          setError(detail || `Repay preflight failed (HTTP ${preflightR.status})`)
          return
        }
      }
      const payAmount = preflight.amount ?? amount
      await withSecret(async (falcon_secret) => {
        try {
          await submitWithSequenceRetry({
            networkKey,
            fetchSequence: async () => {
              const a = await fetchSequenceInfo(wallet.address, networkKey)
              return { sequence: a.sequence, currentLedger: a.currentLedger }
            },
            sign: ({ sequence, lastLedgerSequence }) =>
              signLoanPayTx(
                {
                  account: wallet.address,
                  loanId,
                  currency: tok.currency,
                  issuer: tok.issuer,
                  amount: payAmount,
                  sequence,
                  lastLedgerSequence,
                  networkId: network.networkId,
                },
                falcon_secret,
              ),
          })
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : ''
          const result = msg.split(' — ')[0]?.trim()
          if (result?.startsWith('tec')) {
            throw new Error(explainLendSubmitError(result, msg, data, {
              paymentDueFusdc: loan?.paymentDueFusdc ?? loan?.totalOutstandingFusdc,
            }))
          }
          throw e
        }
        setNotice(`Repaid ${payAmount} F-USDC`)
      })
    },
    [data, wallet, withSecret, networkKey, network.networkId],
  )

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header current="lend" />
      <NetworkBanner />

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {!network.live && (
          <p className="text-sm text-amber-400">{network.comingSoonMessage ?? 'Network not live.'}</p>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
            <Spinner />
            Loading lending data…
          </div>
        ) : error && !data ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : (
          <>
            <LendProtocolBanner data={data} />

            {data && !data.lending.configured && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                Lending vault not bootstrapped yet. Run{' '}
                <code className="text-amber-100">bootstrap-testnet-lending.py</code> on the coordinator.
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}
            {notice && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                {notice}
              </div>
            )}

            <div className="flex gap-1 overflow-x-auto nav-scroll pb-0.5">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTab(t.key)
                    if ((t.key === 'supply' || t.key === 'positions') && wallet?.address) {
                      refresh(wallet.address).catch(() => {})
                    }
                  }}
                  className={
                    tab === t.key
                      ? 'px-3 py-1.5 rounded-lg bg-brand-500/10 text-brand-500 font-medium text-sm whitespace-nowrap'
                      : 'px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 text-sm whitespace-nowrap'
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <LendPoolOverviewPanel data={data} networkKey={networkKey} />
            )}
            {tab === 'supply' && (
              <LendSupplyPanel data={data} busy={busy} onSupply={handleSupply} />
            )}
            {tab === 'borrow' && (
              <LendBorrowPanel data={data} busy={busy} onBorrow={handleBorrow} />
            )}
            {tab === 'positions' && (
              <LendPositionsPanel
                data={data}
                busy={busy}
                onClaim={handleClaim}
                onClaimLiquidation={handleClaimLiquidation}
                onWithdraw={handleWithdraw}
                onRepay={handleRepay}
                onAddCollateral={handleAddCollateral}
              />
            )}
          </>
        )}

        {wallet && (
          <p className="text-xs text-slate-600 text-center font-mono truncate">
            {wallet.address}
          </p>
        )}
      </main>
    </div>
  )
}