'use client'

import Image from 'next/image'
import Link from 'next/link'
import Header from '@/components/Header'
import { WHITEPAPER_DATE, WHITEPAPER_SECTIONS, WHITEPAPER_VERSION } from '@/content/whitepaper'

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
    const html = block
      .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="text-brand-400 bg-slate-900 px-1 rounded text-xs">$1</code>')
    return (
      <p
        key={i}
        className="text-slate-400 leading-relaxed mb-4"
        dangerouslySetInnerHTML={{ __html: html }}
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
            Quantum-Resistant · Validator-Rewarding · No Company · No Escrow
          </p>
        </div>

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