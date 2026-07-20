'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import NetworkBanner from '@/components/NetworkBanner'
import { useNetwork } from '@/components/NetworkProvider'
import { loadPrimaryWallet } from '@/lib/wallet-store'

const PROD_ARCADE_URL = 'https://falcon-arcade-lake.vercel.app'

/**
 * Resolve the arcade iframe URL.
 * Never ship localhost into production builds — a common footgun is setting
 * NEXT_PUBLIC_ARCADE_URL=http://localhost:5173 for local dev on all envs.
 */
function resolveArcadeUrl(): string {
  const raw = process.env.NEXT_PUBLIC_ARCADE_URL?.trim().replace(/\/$/, '')
  if (!raw) return PROD_ARCADE_URL

  if (process.env.NODE_ENV === 'production') {
    try {
      const host = new URL(raw).hostname
      if (host === 'localhost' || host === '127.0.0.1') {
        return PROD_ARCADE_URL
      }
    } catch {
      return PROD_ARCADE_URL
    }
  }

  return raw
}

const ARCADE_URL = resolveArcadeUrl()

const ARCADE_ORIGIN = (() => {
  try {
    return new URL(ARCADE_URL).origin
  } catch {
    return ARCADE_URL
  }
})()

type ArcadeOutbound =
  | { type: 'GAME_READY' }
  | { type: 'SCORE_UPDATE'; game: string; score: number }
  | { type: 'CLAIM_REQUEST'; game: string; score: number }

function isArcadeOutbound(data: unknown): data is ArcadeOutbound {
  if (!data || typeof data !== 'object') return false
  const r = data as Record<string, unknown>
  if (r.type === 'GAME_READY') return true
  if (r.type === 'SCORE_UPDATE' || r.type === 'CLAIM_REQUEST') {
    return (
      typeof r.game === 'string' &&
      r.game.length > 0 &&
      typeof r.score === 'number' &&
      Number.isFinite(r.score)
    )
  }
  return false
}

export default function ArcadePage() {
  const { networkKey, network } = useNetwork()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [claimBusy, setClaimBusy] = useState(false)
  const [lastTx, setLastTx] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load passkey wallet address if present
  useEffect(() => {
    let cancelled = false
    loadPrimaryWallet()
      .then((w) => {
        if (!cancelled && w?.address) setWalletAddress(w.address)
      })
      .catch(() => {
        /* no wallet */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const postToArcade = useCallback((msg: object) => {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    win.postMessage(msg, ARCADE_ORIGIN)
  }, [])

  const pushWallet = useCallback(() => {
    if (!walletAddress) return
    postToArcade({ type: 'WALLET_CONNECTED', address: walletAddress })
  }, [walletAddress, postToArcade])

  // Debounced score POST
  const scoreTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const handleScoreUpdate = useCallback(
    (game: string, score: number) => {
      if (!walletAddress) return
      const key = `${networkKey}:${game}`
      const prev = scoreTimers.current.get(key)
      if (prev) clearTimeout(prev)
      scoreTimers.current.set(
        key,
        setTimeout(async () => {
          try {
            await fetch('/api/arcade/score', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                account: walletAddress,
                game,
                score,
                network: networkKey,
              }),
            })
          } catch {
            /* best-effort */
          }
        }, 800),
      )
    },
    [walletAddress, networkKey],
  )

  const handleClaimRequest = useCallback(
    async (game: string, score: number) => {
      if (!walletAddress) {
        setError('Open Wallet and create/unlock a wallet first, then return here.')
        postToArcade({
          type: 'CLAIM_RESULT',
          game,
          ok: false,
          error: 'No wallet connected',
        })
        return
      }
      if (claimBusy) return
      setClaimBusy(true)
      setError(null)
      setStatus(`Claiming Game Faucet for ${game}…`)
      try {
        // Ensure latest score is stored
        await fetch('/api/arcade/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account: walletAddress,
            game,
            score,
            network: networkKey,
          }),
        })

        const res = await fetch('/api/arcade/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account: walletAddress,
            game,
            score,
            network: networkKey,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error ?? 'Claim failed')
          setStatus(null)
          postToArcade({
            type: 'CLAIM_RESULT',
            game,
            ok: false,
            error: data.error ?? 'Claim failed',
          })
          return
        }
        setLastTx(data.txHash ?? null)
        setStatus(
          `Claimed ${Number(data.amount).toLocaleString()} FALCON for ${game}`,
        )
        postToArcade({
          type: 'CLAIM_RESULT',
          game,
          ok: true,
          txHash: data.txHash,
          amount: data.amount,
        })
      } catch {
        setError('Network error during claim')
        postToArcade({
          type: 'CLAIM_RESULT',
          game,
          ok: false,
          error: 'Network error',
        })
      } finally {
        setClaimBusy(false)
      }
    },
    [walletAddress, networkKey, claimBusy, postToArcade],
  )

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== ARCADE_ORIGIN) return
      if (!isArcadeOutbound(event.data)) return

      if (event.data.type === 'GAME_READY') {
        pushWallet()
        return
      }
      if (event.data.type === 'SCORE_UPDATE') {
        handleScoreUpdate(event.data.game, event.data.score)
        return
      }
      if (event.data.type === 'CLAIM_REQUEST') {
        void handleClaimRequest(event.data.game, event.data.score)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [pushWallet, handleScoreUpdate, handleClaimRequest])

  // Re-push wallet when it loads
  useEffect(() => {
    pushWallet()
  }, [pushWallet])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Header current="arcade" subtitle="Arcade · Game Faucet">
        {walletAddress ? (
          <span className="hidden sm:inline text-xs font-mono text-slate-400 truncate max-w-[10rem]">
            {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
          </span>
        ) : (
          <Link
            href="/wallet"
            className="text-xs text-brand-400 hover:text-brand-300 font-medium"
          >
            Connect wallet
          </Link>
        )}
      </Header>
      <NetworkBanner />

      <div className="px-4 py-3 border-b border-slate-800/60 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-white">
              Falcon Arcade
            </h1>
            <p className="text-xs text-slate-500">
              Play mini-games · hit 500 pts on a single run · claim from the{' '}
              <strong className="text-slate-300">{network.name}</strong> faucet
              (same pool · up to 8 game claims/day · keep playing for high scores)
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Link
              href="/arcade/leaderboard"
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
            >
              Leaderboard
            </Link>
            {!walletAddress && (
              <Link
                href="/wallet"
                className="px-3 py-1.5 rounded-lg bg-brand-500/20 text-brand-400 font-medium"
              >
                Open Wallet
              </Link>
            )}
          </div>
        </div>
        {status && (
          <p className="text-xs text-emerald-400">{status}</p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        {lastTx && (
          <p className="text-xs font-mono text-slate-400 break-all">
            Tx: {lastTx}
          </p>
        )}
        {claimBusy && (
          <p className="text-xs text-amber-400">Submitting game claim…</p>
        )}
      </div>

      <div className="flex-1 min-h-[70vh] bg-slate-950 relative">
        <iframe
          ref={iframeRef}
          src={ARCADE_URL}
          title="Falcon Arcade"
          className="absolute inset-0 w-full h-full border-0"
          allow="fullscreen"
          referrerPolicy="origin"
        />
      </div>
    </div>
  )
}
