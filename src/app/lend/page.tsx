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
} from '@/lib/falcon-lend-tx-sign'

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
      if (!wallet || !network.live) return
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
    [wallet, network.live, refresh],
  )

  const handleSupply = useCallback(
    async (amount: string) => {
      const lend = data?.lending
      const tok = data?.token
      if (!wallet || !lend?.vaultId || !tok?.issuer) return
      await withSecret(async (falcon_secret) => {
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
                amount,
                sequence,
                lastLedgerSequence,
                networkId: network.networkId,
              },
              falcon_secret,
            ),
        })
        setNotice(`Supplied ${amount} F-USDC to vault`)
      })
    },
    [data, wallet, withSecret, networkKey, network.networkId],
  )

  const handleBorrow = useCallback(
    async (principal: string) => {
      const lend = data?.lending
      if (!wallet || !lend?.loanBrokerId) return
      if (!lend.cosignReady) {
        setError('Borrow co-sign not configured — set TESTNET_LENDING_BROKER_SECRET on server')
        return
      }
      await withSecret(async (falcon_secret) => {
        const { sequence, currentLedger } = await fetchSequenceInfo(wallet.address, networkKey)
        const lastLedgerSequence = currentLedger + 20
        const { tx_json } = await signLoanSetBorrowerTx(
          {
            account: wallet.address,
            loanBrokerId: lend.loanBrokerId!,
            principalRequested: principal,
            interestRateTenthBps: lend.interestRateTenthBps ?? 500,
            paymentInterval: 86400,
            paymentTotal: 1,
            gracePeriod: 3600,
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
          throw new Error([subJ.result, subJ.message].filter(Boolean).join(' — ') || 'Submit failed')
        }
        setNotice(`Borrowed ${principal} F-USDC (loan opened)`)
      })
    },
    [data, wallet, withSecret, networkKey, network.networkId],
  )

  const handleClaim = useCallback(async () => {
    const lend = data?.lending
    if (!wallet || !lend?.vaultId) return
    await withSecret(async (falcon_secret) => {
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
      setNotice('LP epoch rewards claimed')
    })
  }, [data, wallet, withSecret, networkKey, network.networkId])

  const handleWithdraw = useCallback(
    async (amount: string) => {
      const lend = data?.lending
      const tok = data?.token
      if (!wallet || !lend?.vaultId || !tok?.issuer) return
      await withSecret(async (falcon_secret) => {
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
                amount,
                sequence,
                lastLedgerSequence,
                networkId: network.networkId,
              },
              falcon_secret,
            ),
        })
        setNotice(`Withdrew ${amount} F-USDC from vault`)
      })
    },
    [data, wallet, withSecret, networkKey, network.networkId],
  )

  const handleRepay = useCallback(
    async (loanId: string, amount: string) => {
      const tok = data?.token
      if (!wallet || !tok?.issuer) return
      await withSecret(async (falcon_secret) => {
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
                amount,
                sequence,
                lastLedgerSequence,
                networkId: network.networkId,
              },
              falcon_secret,
            ),
        })
        setNotice(`Repaid ${amount} F-USDC`)
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
                  onClick={() => setTab(t.key)}
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
              <LendPoolOverviewPanel data={data} />
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
                onWithdraw={handleWithdraw}
                onRepay={handleRepay}
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