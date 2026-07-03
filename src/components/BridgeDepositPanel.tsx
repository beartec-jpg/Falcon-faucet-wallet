'use client'

import { useCallback, useEffect, useState } from 'react'
import { Wallet } from 'ethers'
import {
  authenticatePasskey,
  isPasskeySupported,
} from '@/lib/passkey'
import { decryptSeed, encryptSeed } from '@/lib/wallet-crypto'
import { saveWallet, type StoredWallet } from '@/lib/wallet-store'
import {
  depositUsdcToBridge,
  fetchSepoliaBalances,
  sendSepoliaEth,
  sendSepoliaUsdc,
  type BridgeDepositResult,
} from '@/lib/evm-bridge-client'
import {
  etherscanAddressUrl,
  etherscanTokenUrl,
  lockContractReady,
  type UsdcBridgeManifest,
} from '@/lib/bridge-config'

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin-slow ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function fmt(n: string | number, decimals = 4): string {
  const v = typeof n === 'string' ? parseFloat(n) : n
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals })
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="text-xs px-2 py-1 rounded-md bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors shrink-0"
    >
      {copied ? 'Copied' : label ?? 'Copy'}
    </button>
  )
}

interface Props {
  wallet: StoredWallet
  bridgeCfg: UsdcBridgeManifest & { lock_contract_ready?: boolean }
  onWalletUpdate: (w: StoredWallet) => void
}

type BridgeMode = 'deposit' | 'send'

export default function BridgeDepositPanel({ wallet, bridgeCfg, onWalletUpdate }: Props) {
  const [balances, setBalances] = useState<{ eth: string; usdc: string } | null>(null)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [mode, setMode] = useState<BridgeMode>('deposit')
  const [sendAsset, setSendAsset] = useState<'eth' | 'usdc'>('usdc')
  const [sendTo, setSendTo] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sendHash, setSendHash] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BridgeDepositResult | null>(null)

  const bridgeReady = lockContractReady(bridgeCfg)
  const hasEvm = !!(wallet.evmAddress && wallet.evmEncrypted)

  const refreshBalances = useCallback(async () => {
    if (!wallet.evmAddress) return
    setBalanceLoading(true)
    setBalanceError(null)
    try {
      const b = await fetchSepoliaBalances(bridgeCfg.sepolia, wallet.evmAddress)
      setBalances(b)
    } catch (e: unknown) {
      setBalances(null)
      setBalanceError(
        e instanceof Error ? e.message : 'Could not load Sepolia balances (RPC error)',
      )
    } finally {
      setBalanceLoading(false)
    }
  }, [bridgeCfg.sepolia, wallet.evmAddress])

  useEffect(() => {
    if (hasEvm) refreshBalances()
  }, [hasEvm, refreshBalances])

  const setupSepoliaWallet = async () => {
    if (!isPasskeySupported()) {
      setError('Passkeys are required to secure your Sepolia wallet')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { keyBytes, hasPrf } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const evm = Wallet.createRandom()
      const evmEncrypted = await encryptSeed(evm.privateKey, keyBytes, hasPrf)
      const updated: StoredWallet = {
        ...wallet,
        evmAddress: evm.address,
        evmEncrypted,
      }
      await saveWallet(updated)
      onWalletUpdate(updated)
      await refreshBalances()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create Sepolia wallet')
    } finally {
      setBusy(false)
    }
  }

  const handleSend = async () => {
    if (!wallet.evmEncrypted || !wallet.evmAddress) return
    const to = sendTo.trim()
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
      setError('Enter a valid 0x… recipient address')
      return
    }
    const amt = parseFloat(sendAmount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a valid amount')
      return
    }

    setBusy(true)
    setError(null)
    setSendHash(null)
    setStep(null)

    try {
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const evmPrivateKey = await decryptSeed(wallet.evmEncrypted, keyBytes)

      let hash: string
      if (sendAsset === 'eth') {
        setStep('Sending ETH…')
        hash = await sendSepoliaEth({
          cfg: bridgeCfg.sepolia,
          evmPrivateKey,
          to,
          amountEth: sendAmount,
        })
      } else {
        setStep('Sending USDC…')
        hash = await sendSepoliaUsdc({
          cfg: bridgeCfg.sepolia,
          evmPrivateKey,
          to,
          amountUsdc: sendAmount,
        })
      }

      setSendHash(hash)
      setSendAmount('')
      setSendTo('')
      await refreshBalances()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setBusy(false)
      setStep(null)
    }
  }

  const handleDeposit = async () => {
    if (!wallet.evmEncrypted || !wallet.evmAddress || !bridgeReady) return
    const amt = parseFloat(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a valid USDC amount')
      return
    }

    setBusy(true)
    setError(null)
    setResult(null)
    setStep(null)

    try {
      const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
      const evmPrivateKey = await decryptSeed(wallet.evmEncrypted, keyBytes)

      const res = await depositUsdcToBridge({
        cfg: bridgeCfg.sepolia,
        evmPrivateKey,
        amountUsdc: amount,
        falconAccount: wallet.address,
        onStep: setStep,
      })

      setResult(res)
      setAmount('')
      await refreshBalances()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Bridge deposit failed')
    } finally {
      setBusy(false)
      setStep(null)
    }
  }

  const amtNum = parseFloat(amount) || 0
  const sendAmtNum = parseFloat(sendAmount) || 0
  const usdcAvail = balances ? parseFloat(balances.usdc) : 0
  const ethAvail = balances ? parseFloat(balances.eth) : 0

  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white">Sepolia Bridge Wallet</h2>
          <p className="text-xs text-slate-400 mt-1">
            Passkey-secured Sepolia wallet — bridge USDC in to mint Falcon QUC, or send ETH/USDC out after bridging back (future) or from faucet funds.
          </p>
        </div>

        {hasEvm && (
          <div className="flex rounded-xl overflow-hidden border border-slate-700 text-sm">
            <button
              type="button"
              onClick={() => { setMode('deposit'); setError(null) }}
              className={`flex-1 py-2 font-medium ${mode === 'deposit' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-500'}`}
            >
              Bridge In
            </button>
            <button
              type="button"
              onClick={() => { setMode('send'); setError(null) }}
              className={`flex-1 py-2 font-medium ${mode === 'send' ? 'bg-brand-500/10 text-brand-400' : 'text-slate-500'}`}
            >
              Send Out
            </button>
          </div>
        )}

        {!bridgeReady && (
          <div className="text-xs text-amber-400 bg-amber-500/10 rounded-xl px-3 py-2.5">
            Lock contract not configured. Set SEPOLIA_LOCK_CONTRACT in deployment env.
          </div>
        )}

        <div className="bg-slate-800/60 rounded-xl p-3">
          <div className="text-xs text-slate-500 mb-1">Falcon destination (mint target)</div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-slate-200 text-xs break-all flex-1">{wallet.address}</span>
            <CopyButton text={wallet.address} />
          </div>
        </div>

        {!hasEvm ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              Create a one-time Sepolia wallet secured by your passkey. You will need a small amount of
              Sepolia ETH for gas and Sepolia USDC to deposit.
            </p>
            <button
              type="button"
              onClick={setupSepoliaWallet}
              disabled={busy || !isPasskeySupported()}
              className="btn-primary flex items-center justify-center gap-2"
            >
              {busy ? <><Spinner /> Creating…</> : 'Create Sepolia Wallet with Passkey'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-slate-800/60 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-slate-500">Your Sepolia wallet (chain ID 11155111)</div>
                <button
                  type="button"
                  onClick={() => refreshBalances()}
                  disabled={balanceLoading}
                  className="text-xs text-brand-400 hover:text-brand-300 disabled:opacity-40"
                >
                  {balanceLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-slate-200 text-xs break-all flex-1">{wallet.evmAddress}</span>
                <CopyButton text={wallet.evmAddress!} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                <div>
                  <div className="text-slate-500">Sepolia ETH (gas)</div>
                  <div className="text-slate-200 font-mono">
                    {balanceLoading ? '…' : balances ? fmt(balances.eth, 6) : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Sepolia USDC</div>
                  <div className="text-slate-200 font-mono">
                    {balanceLoading ? '…' : balances ? fmt(balances.usdc, 2) : '—'}
                  </div>
                </div>
              </div>
              {balanceError && (
                <p className="text-xs text-amber-400">
                  Balance lookup failed: {balanceError}. Tap Refresh — funds may still be on Sepolia.
                </p>
              )}
              <a
                href={`${bridgeCfg.sepolia.explorer_url}/address/${wallet.evmAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-brand-400 hover:text-brand-300 inline-block"
              >
                View on Sepolia Etherscan →
              </a>
              {ethAvail < 0.001 && (
                <p className="text-xs text-amber-400">
                  Need Sepolia ETH for gas.{' '}
                  <a
                    href="https://sepoliafaucet.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-400 hover:text-brand-300 underline"
                  >
                    Get test ETH
                  </a>
                  {' '}and send a little to your Sepolia address above.
                </p>
              )}
              <p className="text-[10px] text-slate-500">
                Send Sepolia USDC to this address from Circle faucet or any source, then deposit below.
              </p>
              <a
                href={etherscanTokenUrl(bridgeCfg.sepolia.explorer_url, bridgeCfg.sepolia.usdc_token)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-brand-400 hover:text-brand-300 inline-block"
              >
                USDC token on Etherscan →
              </a>
            </div>

            {mode === 'deposit' && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">USDC amount to bridge</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setError(null) }}
                    placeholder="0.00"
                    min="0.000001"
                    step="any"
                    className="input-field"
                    disabled={busy || !bridgeReady}
                  />
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>{balances ? `Available: ${fmt(usdcAvail, 4)} USDC` : ''}</span>
                    {usdcAvail > 0 && (
                      <button type="button" onClick={() => setAmount(String(usdcAvail))} className="text-brand-500">
                        Max
                      </button>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleDeposit}
                  disabled={busy || !bridgeReady || amtNum <= 0 || ethAvail < 0.0001}
                  className="btn-primary flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500"
                >
                  {busy ? <><Spinner /> {step ?? 'Signing…'}</> : 'Deposit with Passkey'}
                </button>

                {bridgeReady && (
                  <div className="text-[10px] text-slate-500">
                    Lock contract:{' '}
                    <a
                      href={etherscanAddressUrl(bridgeCfg.sepolia.explorer_url, bridgeCfg.sepolia.lock_contract)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-400 hover:text-brand-300 font-mono"
                    >
                      {bridgeCfg.sepolia.lock_contract.slice(0, 10)}…
                    </a>
                  </div>
                )}
              </>
            )}

            {mode === 'send' && (
              <div className="space-y-3">
                <div className="flex rounded-xl overflow-hidden border border-slate-700 text-sm">
                  <button
                    type="button"
                    onClick={() => setSendAsset('usdc')}
                    className={`flex-1 py-2 ${sendAsset === 'usdc' ? 'bg-brand-500/10 text-brand-400' : 'text-slate-500'}`}
                  >
                    USDC
                  </button>
                  <button
                    type="button"
                    onClick={() => setSendAsset('eth')}
                    className={`flex-1 py-2 ${sendAsset === 'eth' ? 'bg-brand-500/10 text-brand-400' : 'text-slate-500'}`}
                  >
                    ETH
                  </button>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Recipient (0x…)</label>
                  <input
                    type="text"
                    value={sendTo}
                    onChange={(e) => { setSendTo(e.target.value); setError(null) }}
                    placeholder="0x…"
                    className="input-field font-mono text-sm"
                    disabled={busy}
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Amount ({sendAsset.toUpperCase()})</label>
                  <input
                    type="number"
                    value={sendAmount}
                    onChange={(e) => { setSendAmount(e.target.value); setError(null) }}
                    placeholder="0.00"
                    min="0"
                    step="any"
                    className="input-field"
                    disabled={busy}
                  />
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>
                      Available:{' '}
                      {sendAsset === 'eth' ? fmt(ethAvail, 6) + ' ETH' : fmt(usdcAvail, 4) + ' USDC'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSendAmount(String(sendAsset === 'eth' ? Math.max(0, ethAvail - 0.002) : usdcAvail))}
                      className="text-brand-500"
                    >
                      Max
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={busy || sendAmtNum <= 0 || ethAvail < 0.0001}
                  className="btn-primary flex items-center justify-center gap-2"
                >
                  {busy ? <><Spinner /> {step ?? 'Signing…'}</> : 'Send with Passkey'}
                </button>
                <p className="text-[10px] text-slate-500">
                  Send Sepolia assets to any address — e.g. after bridge-out releases USDC here, or to move leftover faucet funds.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {sendHash && (
        <div className="card p-4 space-y-2 border border-brand-500/20">
          <div className="text-sm font-medium text-brand-400">Sent on Sepolia</div>
          <div className="text-xs text-slate-400 break-all">Tx: {sendHash}</div>
          <button type="button" onClick={() => setSendHash(null)} className="text-xs text-brand-400">Dismiss</button>
        </div>
      )}

      {result && (
        <div className="card p-4 space-y-2 border border-emerald-500/20">
          <div className="text-sm font-medium text-emerald-400">Deposit submitted on Sepolia</div>
          {result.approveHash && (
            <div className="text-xs text-slate-400 break-all">Approve: {result.approveHash}</div>
          )}
          <div className="text-xs text-slate-400 break-all">Deposit: {result.depositHash}</div>
          {result.depositId && (
            <div className="text-xs text-slate-400 break-all">Deposit ID: {result.depositId}</div>
          )}
          <p className="text-xs text-slate-500">
            Validators will attest this deposit and mint Falcon USDC to your address. This may take a few minutes on testnet.
          </p>
          <button type="button" onClick={() => setResult(null)} className="text-xs text-brand-400">
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="card p-4 border border-red-500/20 text-sm text-red-400">
          {error}
          <button type="button" onClick={() => setError(null)} className="block text-xs text-slate-500 mt-2">
            Dismiss
          </button>
        </div>
      )}

      <div className="card p-4 text-xs text-slate-500 space-y-2">
        <div className="text-slate-400 font-medium">How it works</div>
        <ol className="list-decimal list-inside space-y-1">
          <li>Create Sepolia wallet (passkey-encrypted, stored on this device)</li>
          <li>Fund it with Sepolia ETH (gas) + Sepolia USDC</li>
          <li>Deposit locks USDC in the protocol contract tagged with your Falcon address</li>
          <li>Validators mint matching Falcon USDC (QUC) on ledger 1001</li>
        </ol>
      </div>
    </div>
  )
}