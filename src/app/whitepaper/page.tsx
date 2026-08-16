'use client'

import Image from 'next/image'
import Link from 'next/link'
import Header from '@/components/Header'
import ProductShell from '@/components/ProductShell'
import {
  WHITEPAPER_DATE,
  WHITEPAPER_DOWNLOADS,
  WHITEPAPER_SECTIONS,
  WHITEPAPER_VERSION,
  type WhitepaperBlock,
} from '@/content/whitepaper'

function InlineText({ text }: { text: string }) {
  // Lightweight **bold** and `code` only
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={i} className="text-slate-100 font-semibold">
              {part.slice(2, -2)}
            </strong>
          )
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code
              key={i}
              className="text-brand-400 bg-slate-950/80 px-1.5 py-0.5 rounded text-[0.85em] font-mono"
            >
              {part.slice(1, -1)}
            </code>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

function BlockView({ block }: { block: WhitepaperBlock }) {
  switch (block.type) {
    case 'lead':
      return (
        <p className="text-lg sm:text-xl text-slate-200 leading-relaxed font-medium mb-6">
          <InlineText text={block.text} />
        </p>
      )
    case 'p':
      return (
        <p className="text-[15px] sm:text-base text-slate-400 leading-[1.75] mb-5">
          <InlineText text={block.text} />
        </p>
      )
    case 'bullets':
      return (
        <ul className="mb-6 space-y-2.5">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3 text-[15px] text-slate-400 leading-relaxed">
              <span className="mt-2 h-1.5 w-1.5 rounded-full bg-brand-500 shrink-0" aria-hidden />
              <span>
                <InlineText text={item} />
              </span>
            </li>
          ))}
        </ul>
      )
    case 'callout':
      return (
        <aside className="mb-6 rounded-2xl border border-brand-500/25 bg-gradient-to-br from-brand-500/10 via-slate-900/80 to-slate-950/90 p-5 sm:p-6 shadow-[0_0_40px_rgba(192,120,56,0.06)]">
          {block.title && (
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-400 mb-2">
              {block.title}
            </div>
          )}
          <p className="text-[15px] text-slate-300 leading-relaxed">
            <InlineText text={block.text} />
          </p>
        </aside>
      )
    case 'stats':
      return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-7">
          {block.items.map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-slate-800/90 bg-slate-950/50 px-3 py-3.5 text-center"
            >
              <div className="text-sm sm:text-base font-semibold text-brand-400 tracking-tight">
                {item.value}
              </div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500 mt-1">{item.label}</div>
            </div>
          ))}
        </div>
      )
    case 'table':
      return (
        <div className="mb-7 overflow-x-auto rounded-2xl border border-slate-800 shadow-sm">
          <table className="w-full text-sm text-left min-w-[320px]">
            <thead>
              <tr className="bg-slate-900/90 text-slate-300">
                {block.headers.map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold border-b border-slate-800 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr
                  key={ri}
                  className="border-b border-slate-800/50 last:border-0 odd:bg-slate-950/30 even:bg-slate-900/20"
                >
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={`px-4 py-3 align-top text-slate-400 ${ci === 0 ? 'text-slate-300 font-medium' : ''}`}
                    >
                      <InlineText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'code':
      return (
        <pre className="mb-6 p-4 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono text-brand-400 overflow-x-auto">
          {block.text}
        </pre>
      )
    default:
      return null
  }
}

export default function WhitepaperPage() {
  return (
    <ProductShell intensity={0.32}>
      <Header current="whitepaper" subtitle={`White paper · v${WHITEPAPER_VERSION}`} />

      <main className="flex-1 w-full">
        {/* Cover */}
        <section className="relative border-b border-slate-800/80">
          <div className="max-w-3xl mx-auto px-4 pt-12 pb-10 sm:pt-16 sm:pb-14 text-center">
            <Image
              src="/falcon-logo.png"
              alt="Falcon PL"
              width={88}
              height={88}
              className="mx-auto rounded-2xl shadow-[0_0_48px_rgba(192,120,56,0.28)] mb-6 object-cover border border-brand-500/20"
              priority
            />
            <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-brand-400 mb-3">
              Technical white paper
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-3">
              Falcon PL
            </h1>
            <p className="text-base sm:text-lg text-slate-400 max-w-xl mx-auto leading-relaxed">
              A quantum-safe participation ledger —{' '}
              <span className="text-brand-400 font-medium">Falcon Consensus</span> + Falcon-512, with{' '}
              <span className="text-brand-400 font-medium">FPL</span> at the centre.
            </p>
            <p className="text-xs text-slate-600 mt-4">
              Version {WHITEPAPER_VERSION} · {WHITEPAPER_DATE}
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a
                href="#docs"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-brand-500 text-slate-950 hover:bg-brand-400 transition-colors shadow-[0_0_28px_rgba(192,120,56,0.28)]"
              >
                Skip to docs
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </a>
              <a
                href="#contents"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-300 border border-slate-700/90 hover:border-brand-500/40 hover:text-brand-400 transition-colors bg-slate-900/40"
              >
                Contents
              </a>
              <Link
                href="/wallet"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-brand-400 transition-colors"
              >
                Open wallet →
              </Link>
            </div>
          </div>
        </section>

        {/* Key facts strip */}
        <section className="border-b border-slate-800/80 bg-slate-950/40">
          <div className="max-w-3xl mx-auto px-4 py-6 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            {[
              { v: '98%', l: 'Keyless treasury' },
              { v: 'Falcon-512', l: 'From genesis' },
              { v: '4-of-6', l: 'Committee commit' },
              { v: 'PoPL', l: 'Work-weighted pay' },
            ].map((x) => (
              <div key={x.l}>
                <div className="text-lg font-bold text-brand-400">{x.v}</div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500 mt-0.5">{x.l}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="max-w-3xl mx-auto px-4 py-10 sm:py-12">
          {/* Contents */}
          <nav
            id="contents"
            className="mb-12 rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm p-5 sm:p-6 scroll-mt-24"
            aria-label="Table of contents"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 mb-4">
              Contents
            </div>
            <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
              {WHITEPAPER_SECTIONS.map((s, i) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="group flex items-baseline gap-2 py-1 text-sm text-slate-400 hover:text-brand-400 transition-colors"
                  >
                    <span className="font-mono text-[11px] text-slate-600 group-hover:text-brand-500/80 w-5 shrink-0">
                      {s.number ?? String(i + 1).padStart(2, '0')}
                    </span>
                    <span>{s.title}</span>
                  </a>
                </li>
              ))}
              <li>
                <a
                  href="#docs"
                  className="group flex items-baseline gap-2 py-1 text-sm font-medium text-brand-400 hover:text-brand-300 transition-colors"
                >
                  <span className="font-mono text-[11px] text-brand-500/70 w-5 shrink-0">↓</span>
                  <span>Documents &amp; downloads</span>
                </a>
              </li>
            </ol>
          </nav>

          {/* Sections */}
          <article className="space-y-2">
            {WHITEPAPER_SECTIONS.map((section) => (
              <section
                key={section.id}
                id={section.id}
                className="scroll-mt-24 pb-10 mb-10 border-b border-slate-800/70 last:border-0"
              >
                <header className="mb-6">
                  {section.number && (
                    <div className="text-xs font-mono text-brand-500/80 mb-1.5">§ {section.number}</div>
                  )}
                  <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                    {section.title}
                  </h2>
                  <div className="mt-3 h-px w-12 bg-gradient-to-r from-brand-500 to-transparent" />
                </header>
                {section.blocks.map((block, i) => (
                  <BlockView key={i} block={block} />
                ))}
              </section>
            ))}
          </article>

          {/* Docs at bottom */}
          <section
            id="docs"
            className="scroll-mt-24 mt-4 mb-12 rounded-2xl border border-brand-500/30 bg-gradient-to-b from-slate-900/90 to-slate-950/90 p-5 sm:p-7 shadow-[0_0_48px_rgba(192,120,56,0.08)]"
            aria-labelledby="docs-heading"
          >
            <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-400 mb-1">
                  Appendix
                </p>
                <h2 id="docs-heading" className="text-xl sm:text-2xl font-bold text-white">
                  Documents &amp; downloads
                </h2>
                <p className="text-sm text-slate-500 mt-2 max-w-md">
                  Detailed engineering and security reports. The white paper above is the narrative;
                  these PDFs are the deep dives.
                </p>
              </div>
              <a
                href="#contents"
                className="text-xs text-slate-500 hover:text-brand-400 transition-colors shrink-0"
              >
                ↑ Contents
              </a>
            </div>

            <ul className="space-y-3">
              {WHITEPAPER_DOWNLOADS.map((doc) => (
                <li key={doc.href}>
                  <a
                    href={doc.href}
                    download={doc.filename}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-4 p-4 rounded-xl border border-slate-800 bg-slate-950/50 hover:border-brand-500/40 hover:bg-slate-900/70 transition-colors group"
                  >
                    <span className="flex-shrink-0 w-10 h-10 rounded-lg bg-brand-500/10 text-brand-400 flex items-center justify-center mt-0.5">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.75}
                          d="M12 10v6m0 0l-3-3m3 3l3-3M6 18h12a2 2 0 002-2V8a2 2 0 00-2-2H9.5a2 2 0 00-1.7.95l-1.3 2.17A2 2 0 004.5 11v5a2 2 0 002 2z"
                        />
                      </svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-white group-hover:text-brand-400 transition-colors">
                        {doc.title}
                      </span>
                      <span className="block text-xs text-slate-500 mt-1 leading-relaxed">{doc.description}</span>
                    </span>
                    <span className="flex-shrink-0 text-xs font-medium text-brand-500 pt-1">
                      {doc.format ?? 'PDF'} ↓
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <footer className="border-t border-slate-800 pt-8 pb-14 text-center text-sm text-slate-600">
            <p>© {new Date().getFullYear()} Falcon PL · White paper v{WHITEPAPER_VERSION}</p>
            <p className="mt-3 flex flex-wrap justify-center gap-4">
              <Link href="/" className="text-brand-500 hover:text-brand-400">
                Home
              </Link>
              <Link href="/wallet" className="text-slate-500 hover:text-brand-400">
                Wallet
              </Link>
              <Link href="/lend" className="text-slate-500 hover:text-brand-400">
                Lend
              </Link>
              <Link href="/faucet" className="text-slate-500 hover:text-brand-400">
                Faucet
              </Link>
            </p>
          </footer>
        </div>
      </main>
    </ProductShell>
  )
}
