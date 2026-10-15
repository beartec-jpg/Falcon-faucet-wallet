import Link from 'next/link'
import { ARCADE_PRIZES, ARCADE_PRIZES_TOTAL_FPL } from '@/config/arcade-prizes'

const fmt = (n: number) => n.toLocaleString('en-US')
const C = { gold: '#D4922A', panel: '#0F172A', cream: '#E0DBCA' }
const mono = { fontFamily: "'JetBrains Mono', ui-monospace, monospace" }
const ord = ['1st', '2nd', '3rd', '4th', '5th']

/** Arcade top-5 prize section (same small print style as First 35). */
export default function ArcadePrizes() {
  return (
    <section id="arcade-top-5" className="rounded-xl border p-4 space-y-3" style={{ background: C.panel, borderColor: '#1E293B' }}>
      <div>
        <h2 className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: C.gold }}>Arcade top 5</h2>
        <p className="text-sm text-slate-300 mt-1">
          A secondary prize for the top five <Link href="/arcade/leaderboard" className="hover:underline" style={{ color: C.gold }}>Arcade</Link> players,
          paid at mainnet launch from the builder pot, separate from the community airdrop and the First 35.
        </p>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {ARCADE_PRIZES.map((p) => (
          <div key={p.place} className="rounded-lg border px-2 py-3 text-center" style={{ borderColor: p.place === 1 ? C.gold : '#1E293B', background: 'rgba(2,6,23,.6)' }}>
            <div className="text-[11px] uppercase tracking-widest text-slate-500">{ord[p.place - 1]}</div>
            <div className="text-sm sm:text-lg font-semibold mt-1" style={{ ...mono, color: p.place === 1 ? C.gold : C.cream }}>{fmt(p.fpl)}</div>
            <div className="text-[10px] text-slate-400">FPL</div>
          </div>
        ))}
      </div>
      <p className="text-center text-xs text-slate-500" style={mono}>5 places · {fmt(ARCADE_PRIZES_TOTAL_FPL)} FPL in total, from the builder pot</p>
      <div className="text-[11px] text-slate-500 space-y-2 border-t border-slate-800 pt-3">
        <p className="font-semibold text-slate-400">Small print</p>
        <p>
          Places are decided by the Falcon PL team from the Arcade leaderboard. Scores must come from genuine play with a registered
          testnet account; suspected automation or manipulation is excluded and the place is reassigned.
        </p>
        <p>
          Nothing is guaranteed. The programme, amounts, places and timing are subject to change or cancellation. Payment depends on
          mainnet launching. No purchase necessary. Testnet FPL has no value. This is not financial advice.
        </p>
      </div>
    </section>
  )
}
