'use client'

import Image from 'next/image'
import Link from 'next/link'
import Header from '@/components/Header'
import {
  WHITEPAPER_DATE,
  WHITEPAPER_DOWNLOADS,
  WHITEPAPER_SECTIONS,
  WHITEPAPER_VERSION,
} from '@/content/whitepaper'

function renderInline(html: string) {
  return html
    .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="text-brand-400 bg-slate-900 px-1 rounded text-xs">$1</code>')
}

function renderMarkdownish(text: string) {
  const blocks = text.split(/\n\n+/)
  return blocks.map((block, i) => {
    if (block.startsWith('### ')) {
      return (
        <h3 key={i} className="text-lg font-semibold text-white mt-8 mb-3">
          {block.replace(/^### /, '')}
        </h3>
      )
    }
    if (block.startsWith('#### ')) {
      return (
        <h4 key={i} className="text-base font-semibold text-slate-200 mt-6 mb-2">
          {block.replace(/^#### /, '')}
        </h4>
      )
    }
    const lines = block.split('\n')
    if (lines.length > 0 && lines.every((l) => l.startsWith('- '))) {
      return (
        <ul key={i} className="list-disc list-outside ml-5 mb-4 space-y-1.5 text-slate-400 leading-relaxed">
          {lines.map((line, li) => (
            <li
              key={li}
              dangerouslySetInnerHTML={{ __html: renderInline(line.replace(/^- /, '')) }}
            />
          ))}
        </ul>
      )
    }
    if (block.startsWith('```')) {
      const code = block.replace(/^```\n?/, '').replace(/\n?```$/, '')
      return (
        <pre
          key={i}
          className="my-4 p-4 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono text-brand-400 overflow-x-auto"
        >
          {code}
        </pre>
      )
    }
    if (block.startsWith('|')) {
      const rows = block.trim().split('\n').filter((r) => !r.match(/^\|[-| ]+\|$/))
      const cells = rows.map((r) =>
        r
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim())
      )
      const [head, ...body] = cells
      return (
        <div key={i} className="my-4 overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="bg-slate-900/80 text-slate-300">
                {head?.map((h, j) => (
                  <th key={j} className="px-4 py-2 font-medium border-b border-slate-800">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri} className="border-b border-slate-800/60 last:border-0">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-4 py-2 text-slate-400 align-top">
                      {cell.replace(/\*\*(.*?)\*\*/g, '$1')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    return (
      <p
        key={i}
        className="text-slate-400 leading-relaxed mb-4"
        dangerouslySetInnerHTML={{ __html: renderInline(block) }}
      />
    )
  })
}

export default function WhitepaperPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header current="whitepaper" subtitle="Falcon Ledger white paper" />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-10">
        <div className="text-center mb-12">
          <Image
            src="/falcon-logo.png"
            alt="Falcon Ledger"
            width={96}
            height={96}
            className="mx-auto rounded-2xl shadow-lg shadow-brand-500/20 mb-6 object-cover"
            priority
          />
          <h1 className="text-3xl font-bold text-white mb-2">Falcon Ledger White Paper</h1>
          <p className="text-slate-500 text-sm">
            Version {WHITEPAPER_VERSION} · {WHITEPAPER_DATE}
          </p>
          <p className="text-brand-500 mt-3 text-sm font-medium">
            Quantum-Resistant · Validator-Rewarding · 98% Protocol Treasury · Honest Bootstrap
          </p>
        </div>

        <section className="card p-5 mb-10" aria-labelledby="downloads-heading">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-3" id="downloads-heading">
            Downloads
          </div>
          <ul className="space-y-3">
            {WHITEPAPER_DOWNLOADS.map((doc) => (
              <li key={doc.href}>
                <a
                  href={doc.href}
                  download={doc.filename}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-4 p-3 rounded-xl border border-slate-800 bg-slate-900/50 hover:border-brand-500/40 hover:bg-slate-800/60 transition-colors group"
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
                    <span className="block text-xs font-mono text-slate-600 mt-2">{doc.filename}</span>
                  </span>
                  <span className="flex-shrink-0 text-xs font-medium text-brand-500 group-hover:text-brand-400 pt-1">
                    {doc.filename.endsWith('.pdf') ? 'PDF ↓' : 'Download ↓'}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <nav className="card p-4 mb-10">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-3">Contents</div>
          <ul className="grid sm:grid-cols-2 gap-1 text-sm">
            {WHITEPAPER_SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-slate-400 hover:text-brand-400 transition-colors">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {WHITEPAPER_SECTIONS.map((section) => (
          <section key={section.id} id={section.id} className="mb-12 scroll-mt-24">
            <h2 className="text-xl font-bold text-white border-b border-slate-800 pb-2 mb-6">
              {section.title}
            </h2>
            {renderMarkdownish(section.body)}
          </section>
        ))}

        <footer className="border-t border-slate-800 pt-8 pb-12 text-center text-sm text-slate-600">
          <p>Copyright © 2026 Falcon Ledger Team · AGPL-3.0 / MIT</p>
          <p className="mt-2">
            <Link href="/" className="text-brand-500 hover:text-brand-400">
              ← Back to faucet
            </Link>
          </p>
        </footer>
      </main>
    </div>
  )
}