'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import NetworkBanner from '@/components/NetworkBanner'
import { useNetwork } from '@/components/NetworkProvider'

const GAMES = [
  { slug: 'falcon-flight', label: 'Falcon Flight' },
  { slug: 'ledger-runner', label: 'Ledger Runner' },
  { slug: 'epoch-rise', label: 'Epoch Rise' },
  { slug: 'amendment-apocalypse', label: 'Amendment Apocalypse' },
] as const

interface Entry {
  rank: number
  address: string
  game: string
  score: number
}

export default function ArcadeLeaderboardPage() {
  const { networkKey } = useNetwork()
  const [game, setGame] = useState<string>('falcon-flight')
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [dayUtc, setDayUtc] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams({
        network: networkKey,
        game,
        limit: '25',
      })
      const r = await fetch(`/api/arcade/leaderboard?${q}`)
      const data = await r.json()
      setEntries(data.entries ?? [])
      setDayUtc(data.dayUtc ?? '')
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [networkKey, game])

  useEffect(() => {
    void load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])

  return (
    <div className="flex-1 flex flex-col">
      <Header current="arcade" subtitle="Arcade · Leaderboard" />
      <NetworkBanner />

      <main className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Epoch boards</h1>
            <p className="text-sm text-slate-400">
              Best scores today (UTC{dayUtc ? ` · ${dayUtc}` : ''})
            </p>
          </div>
          <Link
            href="/arcade"
            className="text-sm text-brand-400 hover:text-brand-300 font-medium"
          >
            ← Play
          </Link>
        </div>

        <div className="flex flex-wrap gap-2">
          {GAMES.map((g) => (
            <button
              key={g.slug}
              type="button"
              onClick={() => setGame(g.slug)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                game === g.slug
                  ? 'bg-brand-500/20 text-brand-400 font-medium'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        <div className="card overflow-hidden">
          {loading ? (
            <p className="p-6 text-slate-500 text-sm">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="p-6 text-slate-500 text-sm">
              No scores yet today. Play a game and hit the threshold to appear
              here.
            </p>
          ) : (
            <ol className="divide-y divide-slate-800">
              {entries.map((e) => (
                <li
                  key={`${e.address}-${e.rank}`}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-slate-500 font-mono text-sm w-6">
                      {e.rank}
                    </span>
                    <span className="font-mono text-sm text-slate-300 truncate">
                      {e.address.slice(0, 8)}…{e.address.slice(-6)}
                    </span>
                  </div>
                  <strong className="text-brand-400 tabular-nums">
                    {Math.floor(e.score).toLocaleString()}
                  </strong>
                </li>
              ))}
            </ol>
          )}
        </div>
      </main>
    </div>
  )
}
