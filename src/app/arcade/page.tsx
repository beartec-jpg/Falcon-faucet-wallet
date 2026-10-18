'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Header from '@/components/Header'
import ProductShell from '@/components/ProductShell'
import { useNetwork } from '@/components/NetworkProvider'
import { loadPrimaryWallet } from '@/lib/wallet-store'
import { plAccountId } from '@/lib/pl-names'

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
  /** runId (newer arcade builds): one id per run, so the server can add runs up. */
  | { type: 'SCORE_UPDATE'; game: string; score: number; runId?: string }
  | { type: 'CLAIM_REQUEST'; game: string; score: number; runId?: string }
  | { type: 'CONNECT_WALLET_REQUEST' }

function isArcadeOutbound(data: unknown): data is ArcadeOutbound {
  if (!data || typeof data !== 'object') return false
  const r = data as Record<string, unknown>
  if (r.type === 'GAME_READY' || r.type === 'CONNECT_WALLET_REQUEST') return true
  if (r.type === 'SCORE_UPDATE' || r.type === 'CLAIM_REQUEST') {
    return (
      typeof r.game === 'string' &&
      r.game.length > 0 &&
      typeof r.score === 'number' &&
      Number.isFinite(r.score) &&
      (r.runId === undefined || typeof r.runId === 'string')
    )
  }
  return false
}

export default function ArcadePage() {
  const { networkKey, setNetworkKey } = useNetwork()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const router = useRouter()
  const [plAccount, setPlAccount] = useState<string>('')
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [claimBusy, setClaimBusy] = useState(false)
  const [lastTx, setLastTx] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (networkKey !== ARCADE_NETWORK) setNetworkKey(ARCADE_NETWORK)
  }, [networkKey, setNetworkKey])

  // Load passkey wallet; use the FPL account id (on-chain name) shown on /wallet,
  // not the key-derived r… backup id (StoredWallet.address), which is not an on-chain account.
  useEffect(() => {
    let cancelled = false
    loadPrimaryWallet()
      .then((w) => {
        if (!cancelled && w?.address) {
          setWalletAddress(plAccountId(w))
          setPlAccount(plAccountId(w))
        }
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

  /** Tell the arcade the server-side claim progress (sum of today's runs since last claim). */
  const postProgress = useCallback(
    (game: string, progress: unknown, minScore: unknown) => {
      if (typeof progress !== 'number' || !Number.isFinite(progress)) return
      postToArcade({
        type: 'PROGRESS_UPDATE',
        game,
        progress: Math.max(0, Math.floor(progress)),
        minScore: typeof minScore === 'number' ? minScore : undefined,
      })
    },
    [postToArcade],
  )

  const pushWallet = useCallback(() => {
    if (!walletAddress) return
    postToArcade({ type: 'WALLET_CONNECTED', address: walletAddress })
    fetch(
      `/api/arcade/status?account=${encodeURIComponent(walletAddress)}&network=${ARCADE_NETWORK}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { minScore?: number; games?: { game: string; progress?: number }[] } | null) => {
        for (const g of d?.games ?? []) postProgress(g.game, g.progress, d?.minScore)
      })
      .catch(() => {})
  }, [walletAddress, postToArcade, postProgress])

  /** Arcade "Connect wallet": re-read the stored wallet and send it, or open the wallet page to create/unlock one. */
  const connectWallet = useCallback(async () => {
    const w = await loadPrimaryWallet().catch(() => null)
    if (w?.address) {
      setWalletAddress(plAccountId(w))
      setPlAccount(plAccountId(w))
      postToArcade({ type: 'WALLET_CONNECTED', address: plAccountId(w) })
      return
    }
    setError(null)
    setStatus('No wallet on this device yet. Opening Wallet: create or restore one, then come back to the Arcade.')
    window.setTimeout(() => router.push('/wallet'), 1200)
  }, [postToArcade, router])

  // Pick up a wallet created or restored in another tab when the user comes back.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || walletAddress) return
      loadPrimaryWallet()
        .then((w) => {
          if (w?.address) {
            setWalletAddress(plAccountId(w))
            setPlAccount(plAccountId(w))
          }
        })
        .catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [walletAddress])

  // Debounced score POST, keyed per run so a new run never swallows the
  // previous run's final score (the server adds runs up for claim progress).
  const scoreTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const pendingScores = useRef<Map<string, () => Promise<void>>>(new Map())

  const postScore = useCallback(
    async (game: string, score: number, runId?: string) => {
      if (!walletAddress) return
      try {
        const res = await fetch('/api/arcade/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account: walletAddress,
            pl_account: plAccount || undefined,
            game,
            score,
            run_id: runId || undefined,
            network: ARCADE_NETWORK,
          }),
        })
        const data = await res.json().catch(() => null)
        if (res.ok && data) postProgress(game, data.progress, data.minScore)
      } catch {
        /* best-effort */
      }
    },
    [walletAddress, plAccount, postProgress],
  )

  const handleScoreUpdate = useCallback(
    (game: string, score: number, runId?: string) => {
      if (!walletAddress) return
      const key = `${ARCADE_NETWORK}:${game}:${runId ?? ''}`
      const prev = scoreTimers.current.get(key)
      if (prev) clearTimeout(prev)
      const send = () => {
        scoreTimers.current.delete(key)
        pendingScores.current.delete(key)
        return postScore(game, score, runId)
      }
      pendingScores.current.set(key, send)
      scoreTimers.current.set(key, setTimeout(() => void send(), 800))
    },
    [walletAddress, postScore],
  )

  /** Send any debounced score posts now (before a claim). */
  const flushScores = useCallback(async () => {
    const sends = [...pendingScores.current.entries()]
    for (const [key] of sends) {
      const t = scoreTimers.current.get(key)
      if (t) clearTimeout(t)
    }
    // Sequential: keeps run order on the server.
    for (const [, send] of sends) await send()
  }, [])

  const handleClaimRequest = useCallback(
    async (game: string) => {
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
        // Ensure the latest run scores are stored. The claim-request score is
        // not re-posted: eligibility is the server's accumulated progress.
        await flushScores()

        const res = await fetch('/api/arcade/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account: walletAddress,
            game,
            network: ARCADE_NETWORK,
          }),
        })
        const data = await res.json()
        postProgress(game, data.progress, data.minScore)
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
    [walletAddress, claimBusy, postToArcade, flushScores, postProgress],
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
      if (event.data.type === 'CONNECT_WALLET_REQUEST') {
        void connectWallet()
        return
      }
      if (event.data.type === 'SCORE_UPDATE') {
        handleScoreUpdate(event.data.game, event.data.score, event.data.runId)
        return
      }
      if (event.data.type === 'CLAIM_REQUEST') {
        void handleClaimRequest(event.data.game)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [pushWallet, connectWallet, handleScoreUpdate, handleClaimRequest])

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
          {' · '}Game Faucet: your run scores add up — 500 pts today unlocks a claim
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
