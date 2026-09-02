'use client'

import Link from 'next/link'
import Header from '@/components/Header'
import ProductShell from '@/components/ProductShell'

const parsedDrip = parseInt(
  process.env.NEXT_PUBLIC_TESTNET_DRIP_FPL ??
    process.env.NEXT_PUBLIC_DRIP_AMOUNT_FPL ??
    process.env.NEXT_PUBLIC_TESTNET_DRIP_QXRP ??
    process.env.NEXT_PUBLIC_DRIP_AMOUNT_QXRP ??
    '2000',
  10,
)
const DRIP_AMOUNT = Number.isFinite(parsedDrip) && parsedDrip > 0 ? parsedDrip : 2000

const STEPS = [
  {
    n: 1,
    title: 'Create a Falcon-512 identity',
    body: 'Open Wallet and create a passkey-secured Falcon PL account. Back up your falcon_secret. Named PL accounts are the live path — not classic r-addresses.',
  },
  {
    n: 2,
    title: `Fund the account (${DRIP_AMOUNT.toLocaleString()} FPL faucet drip)`,
    body: 'Use Faucet (or Wallet → Top up). One drip is enough to cover the 1,000 FPL bond plus fees.',
  },
  {
    n: 3,
    title: 'Submit Bond (≥ 1,000 FPL)',
    body: 'A seat exists only after a Bond is packed. Hello cannot invent a lottery seat. The registry grows through genesis and confirmed Bond transactions.',
  },
  {
    n: 4,
    title: 'Start the node with --join',
    body: 'Join against published seeds. Do not pack while you are behind the mesh tip.',
  },
  {
    n: 5,
    title: 'Pull a join-snap if you are far behind',
    body: 'If tip = 0 or lag ≥ 2,048 ledgers, pull a join-snap from an archive (tip state + 128 ledgers). Snapshots are a point-in-time copy, not a live feed.',
  },
  {
    n: 6,
    title: 'Close the residual gap',
    body: 'Apply certified NeedLedgers after the snap. Light validators keep 128 ledgers in memory and then follow gossip.',
  },
  {
    n: 7,
    title: 'Pong at the mesh tip',
    body: 'Only then is the seat lottery-eligible. To leave: RequestUnbond → 14-day cooldown → CompleteUnbond. Unbonding exits the lottery immediately; funds stay locked for 14 days.',
  },
] as const

export default function ValidatorGuidePage() {
  return (
    <ProductShell intensity={0.4}>
      <Header current="community" subtitle="Validator guide" />

      <main className="flex-1 px-4 py-8 max-w-3xl mx-auto w-full space-y-6">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-slate-500 mb-2">
            <Link href="/community" className="hover:text-brand-400">Community</Link>
            {' · '}Validators
          </p>
          <h1 className="text-2xl font-bold text-white">Run a <span className="text-cyan-400">Validator</span></h1>
          <p className="text-sm text-slate-400 mt-1">
            Falcon PL · Network ID 2300 · Bond 1,000 FPL · Faucet drip {DRIP_AMOUNT.toLocaleString()} FPL
          </p>
        </div>

        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          Live path is <strong>Bond → archive join-snap → residual NeedLedgers → pong at tip</strong>.
          The retired 1001 RPC / docker one-liner is shut down and is not the 2300 product.
        </div>

        <section className="card p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Step-by-step</h2>
          <ol className="space-y-3">
            {STEPS.map((s) => (
              <li key={s.n} className="flex gap-3 text-sm">
                <span className="text-cyan-600 font-mono text-xs w-6 flex-shrink-0 pt-0.5">{String(s.n).padStart(2, '0')}</span>
                <div>
                  <div className="font-medium text-slate-200">{s.title}</div>
                  <div className="text-slate-500 text-xs mt-0.5">{s.body}</div>
                </div>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link href="/wallet" className="text-sm text-brand-400 hover:text-brand-300">
              Open Wallet →
            </Link>
            <Link href="/faucet" className="text-sm text-brand-400 hover:text-brand-300">
              Open Faucet →
            </Link>
            <Link href="/whitepaper" className="text-sm text-brand-400 hover:text-brand-300">
              Whitepaper →
            </Link>
            <Link href="/rewards" className="text-sm text-brand-400 hover:text-brand-300">
              Claim rewards →
            </Link>
          </div>
        </section>

        <section className="card p-5 space-y-2">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Requirements</h2>
          <ul className="text-xs text-slate-400 space-y-1 list-disc list-inside">
            <li>Falcon-512 identity (passkey wallet) on Falcon PL 2300</li>
            <li>≥1,000 FPL to Bond (faucet drip covers this on testnet)</li>
            <li>Node started with <code className="text-slate-300">--join</code> against published seeds</li>
            <li>Archive join-snap available when tip is 0 or lag ≥ 2,048</li>
          </ul>
        </section>

        <section className="card p-5 space-y-2 text-sm">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Protocol notes</h2>
          <ul className="space-y-1 text-slate-400 text-xs">
            <li>Bond is a slash target and a lottery ticket — not an interest rate.</li>
            <li>Join-snap is served only by nodes that advertise the archive role.</li>
            <li>Live packing still verifies every transaction after residual catch-up.</li>
            <li>Full lifecycle is in the in-app whitepaper (Validator lifecycle).</li>
          </ul>
        </section>

        <section className="card p-5 space-y-2 text-sm">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Links</h2>
          <ul className="space-y-1 text-slate-400">
            <li>
              <Link href="/whitepaper" className="text-brand-400 hover:underline">
                Whitepaper — validator lifecycle
              </Link>
            </li>
            <li>
              <Link href="/wallet" className="text-brand-400 hover:underline">
                Wallet
              </Link>
            </li>
            <li>
              <Link href="/faucet" className="text-brand-400 hover:underline">
                Faucet
              </Link>
            </li>
            <li>
              <Link href="/scan" className="text-brand-400 hover:underline">
                Explorer
              </Link>
            </li>
          </ul>
        </section>

        <p className="text-center text-xs text-slate-600 pb-8">
          <Link href="/community" className="hover:text-slate-400">← Back to Community</Link>
        </p>
      </main>
    </ProductShell>
  )
}
