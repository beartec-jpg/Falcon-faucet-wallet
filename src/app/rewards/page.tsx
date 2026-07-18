'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import NetworkBanner from '@/components/NetworkBanner'
import { useNetwork } from '@/components/NetworkProvider'
import { withNetworkQuery } from '@/lib/network-query'
import {
  isPasskeySupported,
  authenticatePasskey,
  registerPasskey,
} from '@/lib/passkey'
import { encryptSeed, decryptSeed } from '@/lib/wallet-crypto'
import { loadPrimaryWallet, type StoredWallet } from '@/lib/wallet-store'
import {
  signClaimReward,
  signPayment,
  signTrustSet,
  signOfferCreate,
  consensusKeyFromSecret,
  keysFromFalconSecret,
  validateFalconSecret,
  qxrpToDrops,
  TF_IMMEDIATE_OR_CANCEL,
  type IouAmount,
} from '@/lib/wallet-sign-client'
import { signClaimLPRewardTx, signClaimAmmLpRewardTx } from '@/lib/falcon-lend-tx-sign'
import {
  loadValidatorCredentials,
  saveValidatorCredentials,
  clearValidatorCredentials,
  type StoredValidatorCredentials,
} from '@/lib/validator-credentials-store'
import { resolveNetworkTokens } from '@/lib/stables-config'
import { submitWithSequenceRetry, fetchSequenceInfo } from '@/lib/wallet-submit'

interface BondInfo {
  registered: boolean
  bond_status?: string
  bonded_amount_qxrp?: number | null
  composite_score?: number | null
  reward_accum_qxrp?: number | null
  can_claim?: boolean
  balance_qxrp?: number | null
  sequence?: number | null
  epoch?: { number?: number; pool_balance_qxrp?: number | null } | null
}

interface LpOverview {
  address: string
  epoch: {
    number: number | null
    emissionFalcon: number
    poolFalcon: number
    lpAllocBps: number
    ammAllocBps: number
    validatorAllocBps: number
  }
  vaultLp: {
    canClaim: boolean
    estFalcon: number | null
    shareBalance: number | null
    lastClaimedEpoch: number | null
    vaultId: string | null
    reason?: string
  }
  ammLp: {
    canClaim: boolean
    estFalcon: number | null
    lpBalance: number | null
    sharePct: number | null
    currency: string | null
    issuer: string | null
    reason?: string
  }
}

interface TokenRow {
  symbol: string
  currency: string
  issuer: string
}

const DROPS_PER_XRP = 1_000_000

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin-slow ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function fmt(n: number | null | undefined, digits = 4): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

export default function RewardsPage() {
  const { networkKey, network } = useNetwork()
  const [payoutWallet, setPayoutWallet] = useState<StoredWallet | null>(null)
  const [valCreds, setValCreds] = useState<StoredValidatorCredentials | null>(null)
  const [bond, setBond] = useState<BondInfo | null>(null)
  const [lpOverview, setLpOverview] = useState<LpOverview | null>(null)
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txResult, setTxResult] = useState<{ ok: boolean; msg: string; hash?: string } | null>(null)

  const [importSecret, setImportSecret] = useState('')
  const [transferAmt, setTransferAmt] = useState('')
  const [swapToken, setSwapToken] = useState<TokenRow | null>(null)
  const [swapAmt, setSwapAmt] = useState('')

  const refreshBond = useCallback(async (address: string) => {
    const res = await fetch(
      withNetworkQuery(`/api/validator/bond?account=${encodeURIComponent(address)}`, networkKey),
    )
    const data = await res.json()
    if (res.ok) setBond(data)
    return data as BondInfo
  }, [networkKey])

  const refreshLpOverview = useCallback(async (address: string) => {
    const res = await fetch(
      withNetworkQuery(`/api/rewards/overview?address=${encodeURIComponent(address)}`, networkKey),
    )
    if (!res.ok) {
      setLpOverview(null)
      return null
    }
    const data = (await res.json()) as LpOverview
    setLpOverview(data)
    return data
  }, [networkKey])

  useEffect(() => {
    Promise.all([
      loadPrimaryWallet(),
      Promise.resolve(loadValidatorCredentials()),
      resolveNetworkTokens(networkKey),
    ]).then(async ([primary, creds, toks]) => {
      if (primary) setPayoutWallet(primary)
      setValCreds(creds)
      const configured = toks.filter((t) => t.issuer)
      setTokens(configured)
      if (configured.length > 0) setSwapToken(configured[0])
      try {
        if (creds?.address) await refreshBond(creds.address)
        const lpAddr = primary?.address ?? creds?.address
        if (lpAddr) await refreshLpOverview(lpAddr)
      } finally {
        setLoading(false)
      }
    }).catch(() => setLoading(false))
  }, [networkKey, refreshBond, refreshLpOverview])

  const submitSequenced = async (
    account: string,
    sign: (seq: { sequence: number; lastLedgerSequence: number }) => Promise<{ tx_blob: string }>,
  ) => {
    const data = await submitWithSequenceRetry({
      networkKey,
      fetchSequence: async () => {
        const a = await fetchSequenceInfo(account, networkKey)
        return { sequence: a.sequence, currentLedger: a.currentLedger }
      },
      sign,
    })
    const msg = [data.result, data.message].filter(Boolean).join(' — ')
    setTxResult({ ok: !!data.success, msg, hash: data.hash })
    return data
  }

  const handleImportValidator = async () => {
    if (!isPasskeySupported()) return
    const secret = importSecret.trim()
    if (!validateFalconSecret(secret)) {
      setError('Invalid falcon_secret — paste the validator signing secret from validator-keys.json')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { address, publicKey } = keysFromFalconSecret(secret)
      const { credentialId, hasPrf } = await registerPasskey(address.slice(0, 16))
      const { keyBytes } = await authenticatePasskey(credentialId, hasPrf)
      const encrypted = await encryptSeed(secret, keyBytes, hasPrf)
      const entry: StoredValidatorCredentials = {
        address,
        consensusKeyHex: publicKey,
        encrypted,
        credentialId,
        hasPrf,
        label: 'Validator',
        savedAt: Date.now(),
      }
      saveValidatorCredentials(entry)
      setValCreds(entry)
      setImportSecret('')
      await refreshBond(address)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const withValidatorSecret = async <T,>(fn: (secret: string) => Promise<T>): Promise<T> => {
    if (!valCreds) throw new Error('Import validator credentials first')
    const { keyBytes } = await authenticatePasskey(valCreds.credentialId, valCreds.hasPrf)
    const secret = await decryptSeed(valCreds.encrypted, keyBytes)
    return fn(secret)
  }

  const withPayoutSecret = async <T,>(fn: (secret: string) => Promise<T>): Promise<T> => {
    if (!payoutWallet) throw new Error('Create a passkey wallet first')
    const { keyBytes } = await authenticatePasskey(payoutWallet.credentialId, payoutWallet.hasPrf)
    const secret = await decryptSeed(payoutWallet.encrypted, keyBytes)
    return fn(secret)
  }

  const handleClaimValidator = async () => {
    if (!valCreds || !network.live) return
    setBusy(true)
    setError(null)
    setTxResult(null)
    try {
      const fresh = await refreshBond(valCreds.address)
      if (!fresh.can_claim) {
        throw new Error(
          fresh.reward_accum_qxrp
            ? 'Cannot claim yet — need bonded status, score ≥ 500 bps, and epoch rewards'
            : 'No accumulated rewards to claim',
        )
      }
      const data = await withValidatorSecret(async (secret) => {
        return submitSequenced(valCreds.address, ({ sequence, lastLedgerSequence }) =>
          signClaimReward(
            {
              account: valCreds.address,
              consensusKeyHex: consensusKeyFromSecret(secret),
              sequence,
              lastLedgerSequence,
              networkId: network.networkId,
            },
            secret,
          ),
        )
      })
      if (data.success) {
        setTimeout(() => refreshBond(valCreds.address), 4000)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Claim failed')
    } finally {
      setBusy(false)
    }
  }

  const handleClaimVaultLp = async () => {
    if (!payoutWallet || !network.live || !lpOverview?.vaultLp.vaultId) return
    setBusy(true)
    setError(null)
    setTxResult(null)
    try {
      const preflightR = await fetch(withNetworkQuery('/api/lend/claim-preflight', networkKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: payoutWallet.address }),
      })
      const preflight = (await preflightR.json()) as {
        error?: string
        canClaim?: boolean
        estEpochRewardFalcon?: number | null
      }
      if (!preflightR.ok || !preflight.canClaim) {
        throw new Error(preflight.error ?? 'No vault LP rewards to claim')
      }
      await withPayoutSecret(async (secret) => {
        return submitSequenced(payoutWallet.address, ({ sequence, lastLedgerSequence }) =>
          signClaimLPRewardTx(
            {
              account: payoutWallet.address,
              vaultId: lpOverview.vaultLp.vaultId!,
              sequence,
              lastLedgerSequence,
              networkId: network.networkId,
            },
            secret,
          ),
        )
      })
      setTimeout(() => refreshLpOverview(payoutWallet.address), 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Vault LP claim failed')
    } finally {
      setBusy(false)
    }
  }

  const handleClaimAmmLp = async () => {
    if (!payoutWallet || !network.live) return
    setBusy(true)
    setError(null)
    setTxResult(null)
    try {
      const preflightR = await fetch(
        withNetworkQuery('/api/rewards/amm-claim-preflight', networkKey),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: payoutWallet.address }),
        },
      )
      const preflight = (await preflightR.json()) as {
        error?: string
        canClaim?: boolean
        softPass?: boolean
        currency?: string
        issuer?: string
        simulateResult?: string
      }
      if (!preflightR.ok) {
        throw new Error(preflight.error ?? 'AMM LP claim preflight failed')
      }
      const currency = preflight.currency ?? lpOverview?.ammLp.currency
      const issuer = preflight.issuer ?? lpOverview?.ammLp.issuer
      if (!currency || !issuer) throw new Error('AMM asset pair not configured')

      // Allow attempt after soft-pass so users can claim once fleet has the new tx type.
      if (!preflight.canClaim && !preflight.softPass) {
        throw new Error(preflight.error ?? 'No AMM LP rewards to claim')
      }

      await withPayoutSecret(async (secret) => {
        return submitSequenced(payoutWallet.address, ({ sequence, lastLedgerSequence }) =>
          signClaimAmmLpRewardTx(
            {
              account: payoutWallet.address,
              currency,
              issuer,
              sequence,
              lastLedgerSequence,
              networkId: network.networkId,
            },
            secret,
          ),
        )
      })
      setTimeout(() => refreshLpOverview(payoutWallet.address), 4000)
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : 'AMM LP claim failed'
      if (raw.includes('ClaimAmmLpReward') || raw.includes('Unable to interpret')) {
        setError(
          'ClaimAmmLpReward not accepted by this network yet — needs lending-v5 (or newer) fleet image.',
        )
      } else {
        setError(raw)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleTransfer = async () => {
    if (!valCreds || !payoutWallet || !transferAmt || !network.live) return
    const amt = parseFloat(transferAmt)
    if (isNaN(amt) || amt <= 0) { setError('Invalid amount'); return }
    setBusy(true)
    setError(null)
    setTxResult(null)
    try {
      await withValidatorSecret(async (secret) => {
        return submitSequenced(valCreds.address, ({ sequence, lastLedgerSequence }) =>
          signPayment(
            {
              account: valCreds.address,
              destination: payoutWallet.address,
              amountDrops: qxrpToDrops(amt),
              sequence,
              lastLedgerSequence,
              networkId: network.networkId,
            },
            secret,
          ),
        )
      })
      setTransferAmt('')
      setTimeout(() => refreshBond(valCreds.address), 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Transfer failed')
    } finally {
      setBusy(false)
    }
  }

  const handleSwap = async () => {
    if (!swapToken || !swapAmt || !network.live) return
    const amt = parseFloat(swapAmt)
    if (isNaN(amt) || amt <= 0) { setError('Invalid swap amount'); return }

    const sourceSecret = valCreds
    const usePayout = !sourceSecret && payoutWallet
    if (!sourceSecret && !usePayout) {
      setError('Import validator credentials or use payout wallet')
      return
    }

    setBusy(true)
    setError(null)
    setTxResult(null)
    try {
      const account = sourceSecret ? sourceSecret.address : payoutWallet!.address

      const signAndSubmit = async (falcon_secret: string) => {
        const xrpDrops = String(Math.round(amt * DROPS_PER_XRP))
        const tokenAmt = amt * 0.99
        const takerGets = xrpDrops
        const takerPays: IouAmount = {
          currency: swapToken.currency,
          issuer: swapToken.issuer,
          value: tokenAmt.toFixed(8).replace(/\.?0+$/, ''),
        }
        return submitSequenced(account, ({ sequence, lastLedgerSequence }) =>
          signOfferCreate(
            {
              account,
              takerGets,
              takerPays,
              sequence,
              lastLedgerSequence,
              networkId: network.networkId,
              flags: TF_IMMEDIATE_OR_CANCEL,
            },
            falcon_secret,
          ),
        )
      }

      if (sourceSecret) {
        await withValidatorSecret(signAndSubmit)
      } else if (payoutWallet) {
        await withPayoutSecret(signAndSubmit)
      }

      setSwapAmt('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Swap failed')
    } finally {
      setBusy(false)
    }
  }

  const handleTrustFromValidator = async (tok: TokenRow) => {
    if (!valCreds || !network.live) return
    setBusy(true)
    setError(null)
    try {
      await withValidatorSecret(async (secret) => {
        return submitSequenced(valCreds.address, ({ sequence, lastLedgerSequence }) =>
          signTrustSet(
            {
              account: valCreds.address,
              currency: tok.currency,
              issuer: tok.issuer,
              limit: '10000000',
              sequence,
              lastLedgerSequence,
              networkId: network.networkId,
            },
            secret,
          ),
        )
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'TrustSet failed')
    } finally {
      setBusy(false)
    }
  }

  const epoch = lpOverview?.epoch

  return (
    <div className="min-h-screen flex flex-col">
      <Header current="wallet" subtitle="Claim rewards · Validator · Vault LP · AMM LP" />
      <NetworkBanner />

      <main className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full space-y-5">
        <div>
          <h1 className="text-xl font-bold text-white">Claim rewards</h1>
          <p className="text-sm text-slate-500 mt-1">
            PoPL epoch emissions split three ways: validators, lend-vault LPs, and native AMM LPs.
            All claims are manual pulls from the treasury — nothing auto-tops pools.
          </p>
        </div>

        {epoch && (
          <div className="card p-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div>
              <div className="text-slate-500">Epoch</div>
              <div className="text-white font-semibold">{epoch.number ?? '—'}</div>
            </div>
            <div>
              <div className="text-slate-500">Validators</div>
              <div className="text-white font-semibold">{(epoch.validatorAllocBps / 100).toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-slate-500">Vault LP</div>
              <div className="text-white font-semibold">{(epoch.lpAllocBps / 100).toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-slate-500">AMM LP</div>
              <div className="text-white font-semibold">{(epoch.ammAllocBps / 100).toFixed(0)}%</div>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-16 text-slate-500 gap-3">
            <Spinner className="w-5 h-5" /><span>Loading…</span>
          </div>
        )}

        {!loading && (
          <>
            {/* ── Validator ─────────────────────────────────────────── */}
            <div className="card p-5 space-y-3">
              <h2 className="text-sm font-semibold text-white">1 · Validator rewards</h2>
              <p className="text-xs text-slate-500">
                <code className="text-slate-400">ClaimReward</code> — score-weighted share of the
                validator basket. Requires bonded consensus key.
              </p>

              {!valCreds && (
                <div className="space-y-3">
                  <textarea
                    value={importSecret}
                    onChange={(e) => setImportSecret(e.target.value)}
                    placeholder="FB09B264… falcon_secret from validator-keys.json"
                    rows={3}
                    className="input-field font-mono text-xs"
                    disabled={busy}
                  />
                  <button
                    onClick={handleImportValidator}
                    disabled={busy || !importSecret || !isPasskeySupported()}
                    className="btn-primary"
                  >
                    {busy ? 'Securing…' : 'Import validator with Passkey'}
                  </button>
                </div>
              )}

              {valCreds && (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-slate-500">Validator account</div>
                      <div className="font-mono text-sm text-slate-300 break-all">{valCreds.address}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { clearValidatorCredentials(); setValCreds(null); setBond(null) }}
                      className="text-xs text-slate-500 hover:text-red-400"
                    >
                      Remove
                    </button>
                  </div>

                  {bond && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="bg-slate-800/60 rounded-lg p-3">
                        <div className="text-slate-500">Status</div>
                        <div className="text-white font-semibold">{bond.bond_status ?? '—'}</div>
                      </div>
                      <div className="bg-slate-800/60 rounded-lg p-3">
                        <div className="text-slate-500">Score</div>
                        <div className="text-white font-semibold">{fmt(bond.composite_score, 0)} bps</div>
                      </div>
                      <div className="bg-slate-800/60 rounded-lg p-3">
                        <div className="text-slate-500">Est. claim</div>
                        <div className="text-emerald-400 font-semibold">{fmt(bond.reward_accum_qxrp, 4)}</div>
                      </div>
                      <div className="bg-slate-800/60 rounded-lg p-3">
                        <div className="text-slate-500">Balance</div>
                        <div className="text-white font-semibold">{fmt(bond.balance_qxrp, 2)}</div>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleClaimValidator}
                    disabled={busy || !bond?.can_claim || !isPasskeySupported()}
                    className="btn-primary w-full"
                  >
                    {busy ? <Spinner /> : 'Claim validator rewards'}
                  </button>
                  {bond && !bond.can_claim && (
                    <p className="text-xs text-amber-500/90">
                      Need bonded status, score ≥ 500 bps, and a non-zero epoch pool (first emission
                      epoch 8).
                    </p>
                  )}
                </>
              )}
            </div>

            {/* ── Vault LP ──────────────────────────────────────────── */}
            <div className="card p-5 space-y-3">
              <h2 className="text-sm font-semibold text-white">2 · Lend vault LP</h2>
              <p className="text-xs text-slate-500">
                <code className="text-slate-400">ClaimLPReward</code> — pro-rata by vault share MPT
                from your passkey wallet. Supply F-USDC on{' '}
                <Link href="/lend" className="text-brand-400 hover:underline">/lend</Link>.
              </p>
              {!payoutWallet ? (
                <p className="text-xs text-amber-500">
                  <Link href="/wallet" className="underline">Create a passkey wallet</Link> to claim LP rewards.
                </p>
              ) : (
                <>
                  <div className="text-xs text-slate-500">
                    Wallet{' '}
                    <span className="font-mono text-slate-400">{payoutWallet.address}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-800/60 rounded-lg p-3">
                      <div className="text-slate-500">Share balance</div>
                      <div className="text-white font-semibold">
                        {fmt(lpOverview?.vaultLp.shareBalance, 4)}
                      </div>
                    </div>
                    <div className="bg-slate-800/60 rounded-lg p-3">
                      <div className="text-slate-500">Est. this epoch</div>
                      <div className="text-emerald-400 font-semibold">
                        {fmt(lpOverview?.vaultLp.estFalcon, 4)} FALCON
                      </div>
                    </div>
                  </div>
                  {lpOverview?.vaultLp.reason && !lpOverview.vaultLp.canClaim && (
                    <p className="text-xs text-amber-500/90">{lpOverview.vaultLp.reason}</p>
                  )}
                  <button
                    onClick={handleClaimVaultLp}
                    disabled={busy || !lpOverview?.vaultLp.canClaim || !isPasskeySupported()}
                    className="btn-primary w-full"
                  >
                    {busy ? <Spinner /> : 'Claim vault LP rewards'}
                  </button>
                </>
              )}
            </div>

            {/* ── AMM LP ────────────────────────────────────────────── */}
            <div className="card p-5 space-y-3">
              <h2 className="text-sm font-semibold text-white">3 · AMM / DEX LP</h2>
              <p className="text-xs text-slate-500">
                <code className="text-slate-400">ClaimAmmLpReward</code> — pro-rata by LP tokens on
                native FALCON pools, weighted by pool TVL. Add liquidity on{' '}
                <Link href="/pool" className="text-brand-400 hover:underline">/pool</Link>.
              </p>
              {!payoutWallet ? (
                <p className="text-xs text-amber-500">Passkey wallet required.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-800/60 rounded-lg p-3">
                      <div className="text-slate-500">LP balance</div>
                      <div className="text-white font-semibold">
                        {fmt(lpOverview?.ammLp.lpBalance, 4)}
                        {lpOverview?.ammLp.sharePct != null
                          ? ` · ${fmt(lpOverview.ammLp.sharePct, 2)}%`
                          : ''}
                      </div>
                    </div>
                    <div className="bg-slate-800/60 rounded-lg p-3">
                      <div className="text-slate-500">Est. this epoch</div>
                      <div className="text-emerald-400 font-semibold">
                        {fmt(lpOverview?.ammLp.estFalcon, 4)} FALCON
                      </div>
                    </div>
                  </div>
                  {lpOverview?.ammLp.reason && !lpOverview.ammLp.canClaim && (
                    <p className="text-xs text-amber-500/90">{lpOverview.ammLp.reason}</p>
                  )}
                  <button
                    onClick={handleClaimAmmLp}
                    disabled={
                      busy ||
                      !isPasskeySupported() ||
                      !(lpOverview?.ammLp.canClaim || (lpOverview?.ammLp.lpBalance ?? 0) > 0)
                    }
                    className="btn-primary w-full"
                  >
                    {busy ? <Spinner /> : 'Claim AMM LP rewards'}
                  </button>
                </>
              )}
            </div>

            {/* ── Transfer + swap (validator path) ──────────────────── */}
            {valCreds && payoutWallet && (
              <div className="card p-5 space-y-3">
                <h2 className="text-sm font-semibold text-white">Transfer to payout wallet</h2>
                <p className="text-xs text-slate-500">
                  Payout: <span className="font-mono text-slate-400">{payoutWallet.address}</span>
                </p>
                <input
                  type="number"
                  value={transferAmt}
                  onChange={(e) => setTransferAmt(e.target.value)}
                  placeholder="FALCON amount"
                  className="input-field"
                  disabled={busy}
                />
                <button
                  onClick={handleTransfer}
                  disabled={busy || !transferAmt}
                  className="btn-primary w-full"
                >
                  Send to payout wallet
                </button>
              </div>
            )}

            {tokens.length > 0 && (valCreds || payoutWallet) && (
              <div className="card p-5 space-y-4">
                <h2 className="text-sm font-semibold text-white">Swap FALCON → stablecoin</h2>
                <div className="flex gap-2 flex-wrap">
                  {tokens.map((tok) => (
                    <button
                      key={tok.symbol}
                      type="button"
                      onClick={() => setSwapToken(tok)}
                      className={`px-3 py-1.5 rounded-lg text-sm ${
                        swapToken?.symbol === tok.symbol
                          ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {tok.symbol}
                    </button>
                  ))}
                </div>
                {swapToken && (
                  <>
                    <input
                      type="number"
                      value={swapAmt}
                      onChange={(e) => setSwapAmt(e.target.value)}
                      placeholder="FALCON to spend"
                      className="input-field"
                      disabled={busy}
                    />
                    <div className="flex gap-2">
                      <button onClick={handleSwap} disabled={busy || !swapAmt} className="btn-primary flex-1">
                        Buy {swapToken.symbol}
                      </button>
                      {valCreds && (
                        <button
                          type="button"
                          onClick={() => handleTrustFromValidator(swapToken)}
                          disabled={busy}
                          className="text-xs px-3 py-2 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200"
                        >
                          Trust line
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {txResult && (
          <div className={`card p-4 ${txResult.ok ? 'border border-emerald-500/20' : 'border border-red-500/20'}`}>
            <div className={`text-sm font-medium ${txResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {txResult.ok ? 'Submitted' : 'Failed'} — {txResult.msg}
            </div>
            {txResult.hash && <div className="font-mono text-xs text-slate-500 mt-1 break-all">{txResult.hash}</div>}
            <button type="button" onClick={() => setTxResult(null)} className="text-xs text-slate-500 mt-2">Dismiss</button>
          </div>
        )}

        {error && (
          <div className="card p-4 border border-red-500/20 text-sm text-red-400">
            {error}
            <button type="button" onClick={() => setError(null)} className="block text-xs text-slate-500 mt-2">Dismiss</button>
          </div>
        )}

        <p className="text-xs text-slate-600 text-center space-x-3">
          <Link href="/wallet" className="text-brand-400 hover:underline">Wallet</Link>
          <Link href="/lend" className="text-brand-400 hover:underline">Lend</Link>
          <Link href="/pool" className="text-brand-400 hover:underline">Pool</Link>
        </p>
      </main>
    </div>
  )
}
