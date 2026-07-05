'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import NetworkBanner from '@/components/NetworkBanner'
import {
  isPasskeySupported,
  authenticatePasskey,
} from '@/lib/passkey'
import { decryptSeed } from '@/lib/wallet-crypto'
import { loadWallets, type StoredWallet } from '@/lib/wallet-store'
import { signBoardMessage } from '@/lib/board-sign-client'
import { BOARD_BODY_MAX } from '@/lib/board-constants'

interface BoardReply {
  id: string
  parentId: string | null
  authorAddress: string
  body: string
  createdAt: string
}

interface BoardPost {
  id: string
  authorAddress: string
  body: string
  createdAt: string
  replies: BoardReply[]
}

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin-slow ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function shortAddr(a: string) {
  return a.length > 12 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a
}

function fmtTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function PostBody({ text }: { text: string }) {
  return (
    <div className="text-sm text-slate-300 whitespace-pre-wrap break-words leading-relaxed">
      {text}
    </div>
  )
}

export default function BoardPage() {
  const [wallet, setWallet] = useState<StoredWallet | null>(null)
  const [posts, setPosts] = useState<BoardPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [compose, setCompose] = useState('')
  const [replyTo, setReplyTo] = useState<BoardPost | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [dbUnavailable, setDbUnavailable] = useState(false)

  useEffect(() => {
    loadWallets().then(wallets => {
      if (wallets.length > 0) setWallet(wallets[0])
    })
  }, [])

  const fetchPosts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/board/posts?limit=40')
      const data = await res.json()
      if (res.status === 503) {
        setDbUnavailable(true)
        return
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to load board')
      setPosts(data.posts ?? [])
      setDbUnavailable(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load board')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPosts()
  }, [fetchPosts])

  async function unlockSecret(): Promise<string> {
    if (!wallet) throw new Error('Unlock a wallet first')
    const { keyBytes } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
    return decryptSeed(wallet.encrypted, keyBytes)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!wallet) {
      setError('Create or unlock a wallet to post')
      return
    }
    const body = compose.trim()
    if (!body) return

    setSubmitting(true)
    setError(null)

    try {
      const challengeRes = await fetch('/api/board/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: wallet.address,
          body,
          parentId: replyTo?.id ?? null,
        }),
      })
      const challengeData = await challengeRes.json()
      if (!challengeRes.ok) {
        throw new Error(challengeData.error ?? 'Challenge failed')
      }

      const falcon_secret = await unlockSecret()
      const { signature, publicKey, address } = await signBoardMessage(
        challengeData.message,
        falcon_secret,
      )

      if (address !== wallet.address) {
        throw new Error('Wallet address mismatch')
      }

      const postRes = await fetch('/api/board/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: challengeData.challengeId,
          signature,
          publicKey,
          address,
        }),
      })
      const postData = await postRes.json()
      if (!postRes.ok) {
        throw new Error(postData.error ?? 'Post failed')
      }

      setCompose('')
      setReplyTo(null)
      await fetchPosts()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Post failed')
    } finally {
      setSubmitting(false)
    }
  }

  const charCount = compose.length

  return (
    <div className="min-h-screen flex flex-col">
      <Header current="board" />
      <NetworkBanner />

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Message Board</h1>
          <p className="text-sm text-slate-400 mt-1">
            Your Falcon wallet address is your identity. Posts are signed with your Falcon key.
          </p>
        </div>

        {dbUnavailable && (
          <div className="card p-4 text-amber-400 text-sm">
            Message board database is not configured. Set <code className="text-amber-200">DATABASE_URL</code> in
            your environment and run <code className="text-amber-200">docs/sql/board-schema.sql</code> in Neon.
          </div>
        )}

        {!wallet && (
          <div className="card p-4 flex items-center justify-between gap-3">
            <p className="text-sm text-slate-400">Sign in with your passkey wallet to post.</p>
            <Link href="/wallet" className="text-sm text-brand-400 hover:text-brand-300 whitespace-nowrap">
              Open Wallet →
            </Link>
          </div>
        )}

        {wallet && isPasskeySupported() && (
          <form onSubmit={handleSubmit} className="card p-4 space-y-3">
            {replyTo && (
              <div className="flex items-center justify-between text-xs text-slate-500 bg-slate-800/50 rounded-lg px-3 py-2">
                <span>
                  Replying to <span className="font-mono text-slate-400">{shortAddr(replyTo.authorAddress)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  className="text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            )}
            <textarea
              value={compose}
              onChange={e => setCompose(e.target.value)}
              placeholder={replyTo ? 'Write a reply…' : 'Share an update with the testnet community…'}
              rows={4}
              maxLength={BOARD_BODY_MAX}
              className="input-field resize-y min-h-[100px]"
              disabled={submitting || dbUnavailable}
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-600">
                Posting as <span className="font-mono text-slate-400">{shortAddr(wallet.address)}</span>
                {' · '}{charCount}/{BOARD_BODY_MAX}
              </span>
              <button
                type="submit"
                disabled={submitting || !compose.trim() || dbUnavailable}
                className="btn-primary !w-auto px-6 py-2.5 text-sm"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <Spinner /> Signing…
                  </span>
                ) : replyTo ? (
                  'Reply'
                ) : (
                  'Post'
                )}
              </button>
            </div>
          </form>
        )}

        {error && (
          <div className="card p-4 text-red-400 text-sm">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 text-slate-500 py-12">
            <Spinner className="w-5 h-5" />
            <span>Loading posts…</span>
          </div>
        ) : posts.length === 0 && !dbUnavailable ? (
          <div className="card p-8 text-center text-slate-500 text-sm">
            No posts yet. Be the first to say hello.
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map(post => (
              <article key={post.id} className="card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/scan?address=${encodeURIComponent(post.authorAddress)}`}
                      className="font-mono text-sm text-brand-400 hover:text-brand-300"
                      title={post.authorAddress}
                    >
                      {shortAddr(post.authorAddress)}
                    </Link>
                    <div className="text-xs text-slate-600 mt-0.5">{fmtTime(post.createdAt)}</div>
                  </div>
                  {wallet && (
                    <button
                      type="button"
                      onClick={() => {
                        setReplyTo(post)
                        setCompose('')
                      }}
                      className="text-xs text-slate-500 hover:text-brand-400 shrink-0"
                    >
                      Reply
                    </button>
                  )}
                </div>
                <PostBody text={post.body} />

                {post.replies.length > 0 && (
                  <div className="border-t border-slate-800/60 pt-3 space-y-3 pl-3 border-l-2 border-slate-800 ml-1">
                    {post.replies.map(reply => (
                      <div key={reply.id} className="space-y-1">
                        <div className="flex items-center gap-2 text-xs">
                          <Link
                            href={`/scan?address=${encodeURIComponent(reply.authorAddress)}`}
                            className="font-mono text-brand-400/90 hover:text-brand-300"
                            title={reply.authorAddress}
                          >
                            {shortAddr(reply.authorAddress)}
                          </Link>
                          <span className="text-slate-600">{fmtTime(reply.createdAt)}</span>
                        </div>
                        <PostBody text={reply.body} />
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        <p className="text-xs text-slate-600 text-center pb-4">
          Max 10 posts per hour per wallet · Plain text only · Testnet community board
        </p>
      </main>
    </div>
  )
}