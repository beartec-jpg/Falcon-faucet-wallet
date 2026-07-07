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
import { loadWallets, type StoredWallet } from '@/lib/wallet-store'
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
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txResult, setTxResult] = useState<{ ok: boolean; msg: string; hash?: string } | null>(null)

  const [importSecret, setImportSecret] = useState('')
  const [transferAmt, setTransferAmt] = useState('')
  const [swapToken, setSwapToken] = useState<TokenRow | null>(null)
  const [swapAmt, setSwapAmt] = useState('')
  const [ledger, setLedger] = useState(0)

  const refreshBond = useCallback(async (address: string) => {
    const res = await fetch(
      withNetworkQuery(`/api/validator/bond?account=${encodeURIComponent(address)}`, networkKey),
    )
    const data = await res.json()
    if (res.ok) setBond(data)
    const acc = await fetch(
      withNetworkQuery(`/api/wallet/account?address=${encodeURIComponent(address)}`, networkKey),
    ).then((r) => r.json())
    if (acc.currentLedger) setLedger(acc.currentLedger)
    return data as BondInfo
  }, [networkKey])

  useEffect(() => {
    Promise.all([
      loadWallets(),
      Promise.resolve(loadValidatorCredentials()),
      resolveNetworkTokens(networkKey),
    ]).then(([wallets, creds, toks]) => {
      if (wallets.length > 0) setPayoutWallet(wallets[0])
      setValCreds(creds)
      const configured = toks.filter((t) => t.issuer)
      setTokens(configured)
      if (configured.length > 0) setSwapToken(configured[0])
      if (creds?.address) {
        refreshBond(creds.address).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    }).catch(() => setLoading(false))
  }, [networkKey, refreshBond])

  /**
   * Sign + submit for `account`, re-fetching the sequence and re-signing if the
   * ledger reports a sequence race (tefPAST_SEQ). Signing stays in the callback so
   * the secret never leaves the browser, and txResult is reported on completion.
   */
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

  const handleClaim = async () => {
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
      setTimeout(() => {
        refreshBond(valCreds.address)
      }, 4000)
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

    const source = valCreds?.address
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
        const { keyBytes } = await authenticatePasskey(payoutWallet.credentialId, payoutWallet.hasPrf)
        const secret = await decryptSeed(payoutWallet.encrypted, keyBytes)
        await signAndSubmit(secret)
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

  return (
    <div className="min-h-screen flex flex-col">
      <Header current="wallet" subtitle="Validator rewards · Claim & swap" />
      <NetworkBanner />

      <main className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full space-y-5">
        <div>
          <h1 className="text-xl font-bold text-white">Validator Rewards</h1>
          <p className="text-sm text-slate-500 mt-1">
            Claim epoch FALCON from your bonded validator, transfer to your payout wallet, and swap to F-USDC.
          </p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16 text-slate-500 gap-3">
            <Spinner className="w-5 h-5" /><span>Loading…</span>
          </div>
        )}

        {!loading && !valCreds && (
          <div className="card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-white">Import validator signing key</h2>
            <p className="text-xs text-slate-500">
              Paste the <code className="text-slate-400">falcon_secret</code> or{' '}
              <code className="text-slate-400">validation_seed</code> from your server&apos;s{' '}
              <code className="text-slate-400">validator-keys.json</code>. Stored encrypted with your passkey — never sent to our servers.
            </p>
            <textarea
              value={importSecret}
              onChange={(e) => setImportSecret(e.target.value)}
              placeholder="FB09B264… (1796+ hex chars)"
              rows={3}
              className="input-field font-mono text-xs"
              disabled={busy}
            />
            <button
              onClick={handleImportValidator}
              disabled={busy || !importSecret || !isPasskeySupported()}
              className="btn-primary"
            >
              {busy ? 'Securing…' : 'Import with Passkey'}
            </button>
          </div>
        )}

        {!loading && valCreds && (
          <>
            <div className="card p-5 space-y-3">
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
                    <div className="text-slate-500">Accum. rewards</div>
                    <div className="text-emerald-400 font-semibold">{fmt(bond.reward_accum_qxrp, 4)}</div>
                  </div>
                  <div className="bg-slate-800/60 rounded-lg p-3">
                    <div className="text-slate-500">Balance</div>
                    <div className="text-white font-semibold">{fmt(bond.balance_qxrp, 2)} FALCON</div>
                  </div>
                </div>
              )}

              {bond?.epoch && (
                <div className="text-xs text-slate-600">
                  Epoch {bond.epoch.number} · pool {fmt(bond.epoch.pool_balance_qxrp, 0)} FALCON
                </div>
              )}

              <button
                onClick={handleClaim}
                disabled={busy || !bond?.can_claim || !isPasskeySupported()}
                className="btn-primary w-full"
              >
                {busy ? <Spinner /> : 'Claim epoch rewards'}
              </button>
              {bond && !bond.can_claim && (
                <p className="text-xs text-amber-500/90">
                  Claim requires bonded status, composite score ≥ 500 bps (5%), and non-zero reward accumulator.
                  Until epoch 1 scoring at ledger 172800, accum may stay at 0.
                </p>
              )}
            </div>

            {payoutWallet && (
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

            {tokens.length > 0 && (
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
                      <button
                        type="button"
                        onClick={() => handleTrustFromValidator(swapToken)}
                        disabled={busy}
                        className="text-xs px-3 py-2 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200"
                      >
                        Trust line
                      </button>
                    </div>
                  </>
                )}
                <Link href="/swap" className="text-xs text-brand-400 hover:underline block">
                  Swap F-USDC →
                </Link>
              </div>
            )}

            {tokens.length === 0 && (
              <div className="card p-4 text-sm text-amber-500">
                Stablecoins not issued yet — run <code className="text-amber-400">issue-testnet-stables.py</code> on the coordinator.
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

        <p className="text-xs text-slate-600 text-center">
          <Link href="/wallet" className="text-brand-400 hover:underline">← Back to wallet</Link>
        </p>
      </main>
    </div>
  )
}