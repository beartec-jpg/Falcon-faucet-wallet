'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import ProductShell from '@/components/ProductShell'
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
/** Arcade chrome and faucet are Falcon PL 2300 testnet only. */
const ARCADE_NETWORK = 'testnet' as const

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
      const key = `${ARCADE_NETWORK}:${game}`
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
                network: ARCADE_NETWORK,
              }),
            })
          } catch {
            /* best-effort */
          }
        }, 800),
      )
    },
    [walletAddress],
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
            network: ARCADE_NETWORK,
          }),
        })

        const res = await fetch('/api/arcade/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account: walletAddress,
            game,
            score,
            network: ARCADE_NETWORK,
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
          `Claimed ${Number(data.amount).toLocaleString()} FPL for ${game}`,
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
    [walletAddress, claimBusy, postToArcade],
  )

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== ARCADE_ORIGIN) return
      // Only accept messages from our arcade iframe, not other windows
      if (
        iframeRef.current?.contentWindow &&
        event.source !== iframeRef.current.contentWindow
      ) {
        return
      }
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

  // Auto-dismiss claim banner so it doesn’t sit over the game forever
  useEffect(() => {
    if (!status && !error && !lastTx) return
    if (claimBusy) return
    const ms = error ? 7000 : 4500
    const t = window.setTimeout(() => {
      setStatus(null)
      setError(null)
      setLastTx(null)
    }, ms)
    return () => window.clearTimeout(t)
  }, [status, error, lastTx, claimBusy])

  return (
    /*
     * Full-viewport shell: only site Header + network banner stay above the
     * iframe. The old “Falcon Arcade / play mini-games / Leaderboard” strip is
     * gone so it cannot pin over the game.
     */
    <ProductShell intensity={0.22} className="h-[100dvh] max-h-[100dvh] overflow-hidden">
      <Header current="arcade" subtitle="Arcade · Game Faucet" sticky={false}>
        <div className="flex items-center gap-2">
          <Link
            href="/arcade/leaderboard"
            className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            Leaderboard
          </Link>
          {walletAddress ? (
            <span className="hidden sm:inline text-xs font-mono text-slate-400 truncate max-w-[10rem]">
              {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
            </span>
          ) : (
            <Link
              href="/wallet"
              className="text-xs px-2.5 py-1.5 rounded-lg bg-brand-500/20 text-brand-400 font-medium"
            >
              Wallet
            </Link>
          )}
        </div>
      </Header>
      <div className="shrink-0">
        <div className="bg-amber-950/50 border-b border-amber-800/40 px-4 py-2 text-center text-xs text-amber-200/90">
          <span className="font-medium">Falcon PL</span>
          {' · '}Network ID 2300
          {' · '}FPL testnet — no real value
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-slate-950 relative">
        {/* Claim status toast — auto-dismisses after success/error */}
        {(status || error || lastTx || claimBusy) && (
          <div className="absolute top-2 left-2 right-2 z-10 pointer-events-none">
            <div
              className={`mx-auto max-w-xl rounded-lg border border-slate-700/80 bg-slate-950/90 px-3 py-2 shadow-lg space-y-0.5 ${
                !claimBusy && (status || error || lastTx)
                  ? 'arcade-claim-toast'
                  : ''
              }`}
            >
              {status && <p className="text-xs text-emerald-400">{status}</p>}
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
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={ARCADE_URL}
          title="Falcon Arcade"
          className="absolute inset-0 w-full h-full border-0"
          allow="fullscreen"
          referrerPolicy="origin"
        />
      </div>
    </ProductShell>
  )
}
