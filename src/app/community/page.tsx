'use client'

import Image from 'next/image'
import Link from 'next/link'
import Header from '@/components/Header'
import ProductShell from '@/components/ProductShell'
import { activeCommunitySocials } from '@/lib/community-links'

function SocialIcon({ id }: { id: string }) {
  if (id === 'x') {
    return (
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.725-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
      </svg>
    )
  }
  if (id === 'discord') {
    return (
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
      </svg>
    )
  }
  // telegram
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  )
}

const VALIDATOR_LINKS = [
  {
    href: '/validator',
    title: 'Run a Validator',
    description: 'Bond FPL, install the node one-liner, and secure the network.',
    cta: 'Guide',
    primary: true,
  },
  {
    href: '/rewards',
    title: 'Claim validator rewards',
    description: 'Import validator credentials and claim epoch rewards.',
    cta: 'Rewards',
    primary: false,
  },
  {
    href: '/faucet',
    title: 'Fund with FPL faucet',
    description: 'Get testnet FPL for bonding (≥1,100 needed on the validator address).',
    cta: 'Faucet',
    primary: false,
  },
] as const

export default function CommunityPage() {
  const socials = activeCommunitySocials()

  return (
    <ProductShell intensity={0.4}>
      <Header current="community" subtitle="Community" />

      <main className="flex-1 w-full">
        {/* Cover — welcome-style */}
        <section className="relative border-b border-slate-800/80">
          <div className="max-w-3xl mx-auto px-4 pt-14 pb-12 sm:pt-20 sm:pb-16 text-center">
            <Image
              src="/falcon-logo.png"
              alt=""
              width={80}
              height={80}
              className="mx-auto rounded-2xl shadow-[0_0_48px_rgba(192,120,56,0.28)] mb-6 object-cover border border-brand-500/25"
              priority
            />
            <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-brand-400 mb-3">
              Community
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4">
              Join the Falcon community
            </h1>
            <p className="text-base sm:text-lg text-slate-400 max-w-lg mx-auto leading-relaxed">
              Connect on socials, or run a validator and claim rewards — all in one place.
            </p>
          </div>
        </section>

        <div className="max-w-2xl mx-auto px-4 py-12 sm:py-16">
          <div className="grid gap-4">
            {socials.map((s) => (
              <a
                key={s.id}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-4 sm:gap-5 p-5 sm:p-6 rounded-2xl border border-slate-800/90 bg-slate-900/60 backdrop-blur-md hover:border-brand-500/40 hover:bg-slate-900/85 transition-all shadow-[0_0_0_0_transparent] hover:shadow-[0_0_32px_rgba(192,120,56,0.1)]"
              >
                <span
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-950/80 text-brand-400 group-hover:border-brand-500/40 group-hover:text-brand-300 transition-colors"
                  style={{ color: s.id === 'discord' ? '#8b9cff' : s.id === 'telegram' ? '#6ec8f0' : undefined }}
                >
                  <SocialIcon id={s.id} />
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-lg font-semibold text-white group-hover:text-brand-400 transition-colors">
                    {s.name}
                  </span>
                  <span className="block text-sm text-slate-500 mt-0.5 leading-relaxed">
                    {s.description}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-brand-500 group-hover:text-brand-400 flex items-center gap-1.5">
                  Open
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </span>
              </a>
            ))}
          </div>

          <div className="mt-8 pt-8 border-t border-slate-800/80">
            <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-slate-500 mb-2 text-center">
              Validators
            </p>
            <p className="text-sm text-slate-500 text-center mb-4 max-w-md mx-auto">
              Setup, bond, and rewards live here — not in the wallet.
            </p>
            <div className="grid gap-3">
              {VALIDATOR_LINKS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    item.primary
                      ? 'group flex items-center gap-4 sm:gap-5 p-5 sm:p-6 rounded-2xl border border-brand-500/30 bg-gradient-to-br from-brand-500/10 via-slate-900/70 to-slate-950/90 backdrop-blur-md hover:border-brand-400/50 transition-all shadow-[0_0_32px_rgba(192,120,56,0.08)] hover:shadow-[0_0_40px_rgba(192,120,56,0.14)]'
                      : 'group flex items-center gap-4 sm:gap-5 p-5 sm:p-6 rounded-2xl border border-slate-800/90 bg-slate-900/60 backdrop-blur-md hover:border-brand-500/40 hover:bg-slate-900/85 transition-all'
                  }
                >
                  <span
                    className={
                      item.primary
                        ? 'flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-brand-500/35 bg-brand-500/15 text-brand-400 group-hover:text-brand-300 transition-colors'
                        : 'flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-950/80 text-brand-400 group-hover:border-brand-500/40 group-hover:text-brand-300 transition-colors'
                    }
                  >
                    <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                      {item.href === '/validator' ? (
                        <>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5V6a2 2 0 012-2h10a2 2 0 012 2v6.5" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 12.5h16v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 16.5v2M15 16.5v2M8 20h8" />
                          <circle cx="12" cy="9" r="1.5" fill="currentColor" stroke="none" />
                        </>
                      ) : item.href === '/rewards' ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      )}
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-lg font-semibold text-white group-hover:text-brand-400 transition-colors">
                      {item.title}
                    </span>
                    <span className="block text-sm text-slate-500 mt-0.5 leading-relaxed">
                      {item.description}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-brand-500 group-hover:text-brand-400 flex items-center gap-1.5">
                    {item.cta}
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                </Link>
              ))}
            </div>
          </div>

          <p className="text-center text-sm text-slate-600 mt-10">
            Prefer to explore the product first?{' '}
            <Link href="/wallet" className="text-brand-400 hover:text-brand-300">
              Open the wallet
            </Link>
          </p>
        </div>
      </main>
    </ProductShell>
  )
}
