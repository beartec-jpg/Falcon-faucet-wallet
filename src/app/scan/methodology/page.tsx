import Link from 'next/link'
import Header from '@/components/Header'
import ProductShell from '@/components/ProductShell'
import { TRACKER_CONFIG } from '@/config/tracker'

export const metadata = { title: 'Testnet activity — how it is counted · Falcon PL' }

const ROWS: [string, number, string][] = [
  ['Bridging', TRACKER_CONFIG.caps.bridging, 'USDC, ETH and BTC deposits and withdrawals seen on the rails, valued in FPL at the on-ledger price, plus a small amount per transfer.'],
  ['Swaps', TRACKER_CONFIG.caps.swaps, 'Swaps made in the site wallet and accepted by the node, valued in FPL at the on-ledger price, plus a small amount per swap.'],
  ['Liquidity', TRACKER_CONFIG.caps.liquidity, 'FPL value of AMM pool positions, held over time (FPL·hours), sampled every 5 minutes.'],
  ['Lending', TRACKER_CONFIG.caps.lending, 'FPL value of lending supply, held over time (FPL·hours).'],
  ['Payments', TRACKER_CONFIG.caps.payments, 'Transactions sent (the account sequence).'],
  ['Consistency', TRACKER_CONFIG.caps.consistency, `Distinct UTC days with activity in the last ${TRACKER_CONFIG.windowDays} days; full points at ${TRACKER_CONFIG.consistencyFullDays} days.`],
  ['Faucet', TRACKER_CONFIG.caps.faucet, `Days with a faucet claim (not the amount); full points at ${TRACKER_CONFIG.faucetFullDays} days.`],
  ['Arcade', TRACKER_CONFIG.caps.arcade, `Days with an arcade score while signed in with your Falcon PL wallet (full at ${TRACKER_CONFIG.arcadeFullDays} days, 60%) and the number of different games played (40%).`],
  ['Infra', TRACKER_CONFIG.caps.infra, `Running a watcher on your own account: heartbeat slots credited this epoch (full at ${TRACKER_CONFIG.watcherFullSlots}, 70%) and rail work (full at ${TRACKER_CONFIG.watcherFullWork} units, 30%), from node status.`],
]

export default function MethodologyPage() {
  return (
    <ProductShell intensity={0.4} className="bg-slate-950 text-slate-100">
      <Header current="scan" subtitle="Falcon PL · 2300" />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-10 space-y-6 text-sm text-slate-300">
        <Link href="/scan" className="text-xs text-slate-500 hover:text-slate-300">← Explorer</Link>
        <h1 className="text-2xl font-semibold" style={{ color: '#E0DBCA' }}>Testnet activity: how it&apos;s counted</h1>
        <p>
          The testnet activity leaderboard measures how accounts use Falcon PL testnet 2300.
        </p>
        <p className="text-slate-400">
          Under the proposed model, a frozen snapshot of these scores may be used for a pre-mainnet airdrop from the community
          bucket, with validators in a separate operators pool. Nothing is promised and every rule is subject to change. See the{' '}
          <Link href="/airdrop" className="hover:underline" style={{ color: '#D4922A' }}>community allocation</Link> page. The{' '}
          <Link href="/first-35" className="hover:underline" style={{ color: '#D4922A' }}>First 35</Link> prize seats are a separate programme.
        </p>
        <section className="rounded-xl border border-slate-800 p-4" style={{ background: '#0F172A' }}>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#D4922A' }}>Categories (100 points)</h2>
          <table className="w-full text-xs">
            <tbody>
              {ROWS.map(([k, cap, d]) => (
                <tr key={k} className="border-b border-slate-800/60 align-top">
                  <td className="py-2 pr-3 font-medium text-slate-200 w-28">{k}</td>
                  <td className="py-2 pr-3 text-right w-14" style={{ fontFamily: "'JetBrains Mono', monospace", color: '#E0DBCA' }}>{cap}</td>
                  <td className="py-2 text-slate-400">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-slate-500 mt-3">Volume-based categories are log-scaled and capped per account, so more of the same activity counts for less and no single account can dominate.</p>
        </section>
        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#D4922A' }}>Who is ranked</h2>
          <ul className="list-disc pl-5 space-y-1 text-slate-400">
            <li>Ranked: participant accounts with points in at least {TRACKER_CONFIG.minCategories} categories and at least {TRACKER_CONFIG.minActiveDays} active days. Others appear under &ldquo;Building up&rdquo;.</li>
            <li>Not ranked: development test accounts, load-test and smoke-test wallets, and protocol or service accounts (faucet, the team&apos;s watcher-* service keys, bond accounts and similar). Validators are on the operators board.</li>
            <li>Validator seats are ranked on a separate operators board by this epoch&apos;s work share (proposer credits 50%, vote credits 40%, floor 10%).</li>
            <li>Accounts that appear to belong to the same person, based on shared use of the faucet, are scored as one. Only the highest-scoring one is listed. No identifying data is shown.</li>
          </ul>
        </section>
        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#D4922A' }}>Data sources</h2>
          <p className="text-slate-400">Node status (including watcher slots and work) and account queries on the public Falcon PL RPC, the explorer&apos;s 5-minute activity index, the site&apos;s faucet claim log, swaps submitted through the site wallet, and arcade scores linked to a Falcon PL account. Rules may change while the testnet runs; changes are announced on this page.</p>
        </section>
      </main>
    </ProductShell>
  )
}
