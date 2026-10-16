import type { Metadata } from 'next'
import { pageMeta } from '@/lib/seo'
import Header from '@/components/Header'
import ProductShell from '@/components/ProductShell'
import { FIRST35_LINKS, FIRST35_SEATS, FIRST35_TIERS, FIRST35_TOTAL_FPL } from '@/config/first35'
import { Form, Seats } from './First35Client'

export const metadata: Metadata = pageMeta(
  '/first-35',
  'First 35',
  '35 first-adopter prize seats paid at Falcon PL mainnet launch.',
)

const fmt = (n: number) => n.toLocaleString('en-US')
const C = { copper: '#C07838', gold: '#D4922A', panel: '#0F172A', cream: '#E0DBCA' }
const mono = { fontFamily: "'JetBrains Mono', ui-monospace, monospace" }

export default function First35Page() {
  const links = [
    { k: 'Telegram', href: FIRST35_LINKS.telegram, step: 'Join the Falcon PL Telegram' },
    { k: 'Discord', href: FIRST35_LINKS.discord, step: 'Join the Falcon PL Discord' },
    { k: 'X', href: FIRST35_LINKS.x, step: 'Follow Falcon PL on X' },
  ]
  return (
    <ProductShell intensity={0.4} className="bg-slate-950 text-slate-100">
      <Header current="first35" subtitle="Falcon PL · 2300" />
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-10 space-y-8">
        <section className="text-center space-y-3">
          <div className="text-[11px] uppercase tracking-[0.3em]" style={{ color: C.gold }}>First adopters</div>
          <h1 className="text-4xl sm:text-5xl font-semibold" style={{ color: C.cream }}>The First 35</h1>
          <p className="text-slate-400 max-w-2xl mx-auto">
            35 prize seats for the people who test Falcon PL before mainnet. Seats are paid at mainnet launch,
            separate from the community airdrop.
          </p>
          <Seats total={FIRST35_SEATS} />
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          {FIRST35_TIERS.map((t) => (
            <div key={t.from} className="rounded-xl border p-5 text-center" style={{ background: C.panel, borderColor: t.from === 1 ? C.gold : '#1E293B' }}>
              <div className="text-xs uppercase tracking-widest text-slate-500">Seats {t.from}–{t.to}</div>
              <div className="text-3xl font-semibold mt-2" style={{ ...mono, color: t.from === 1 ? C.gold : C.cream }}>{fmt(t.fpl)}</div>
              <div className="text-xs text-slate-400 mt-1">FPL each · {t.to - t.from + 1} seats</div>
            </div>
          ))}
        </section>
        <p className="text-center text-xs text-slate-500" style={mono}>{FIRST35_SEATS} seats · {fmt(FIRST35_TOTAL_FPL)} FPL in total, from the builder pot</p>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border p-5 space-y-3" style={{ background: C.panel, borderColor: '#1E293B' }}>
            <h2 className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: C.gold }}>How to qualify</h2>
            <ol className="space-y-2 text-sm text-slate-300 list-decimal pl-5">
              {links.map((l) => (
                <li key={l.k}>
                  {l.step}
                  {l.href ? (
                    <>
                      {' '}
                      <a href={l.href} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: C.gold }}>→ {l.k}</a>
                    </>
                  ) : null}
                </li>
              ))}
              <li>
                Have a Falcon PL wallet name: <a href="/wallet" className="hover:underline" style={{ color: C.gold }}>create one in the wallet</a>
              </li>
              <li>Apply with the form, then keep testing and giving feedback until mainnet</li>
            </ol>
            <p className="text-xs text-slate-500">
              Seats are allocated from approved applications. Activity is tracked on the{' '}
              <a href="/scan" className="hover:underline" style={{ color: C.gold }}>testnet activity board</a>.
            </p>
          </div>
          <Form />
        </section>

        <section className="text-[11px] text-slate-500 space-y-2 border-t border-slate-800 pt-6">
          <p className="font-semibold text-slate-400">Small print</p>
          <p>
            Seats require staying active and genuinely testing and giving feedback on Falcon PL testnet until mainnet launch.
            Inactive or non-genuine participants lose their seat, and the seat is reassigned. Seat holders are decided by the
            Falcon PL team.
          </p>
          <p>
            Nothing is guaranteed. The programme, amounts, tiers and timing are subject to change or cancellation. Payment
            depends on mainnet launching. No purchase necessary. Testnet FPL has no value. This is not financial advice.
          </p>
        </section>
      </main>
    </ProductShell>
  )
}
