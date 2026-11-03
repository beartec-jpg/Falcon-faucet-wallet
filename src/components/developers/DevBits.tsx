// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import Link from 'next/link'
import { DEV_PAGES, TESTNET_NOTICE } from '@/lib/developers/content'

/** Sub-navigation for /developers pages (inside the page body; the site header is unchanged). */
export function DevNav({ active }: { active?: string }) {
  return (
    <nav aria-label="Developer docs" className="flex flex-wrap gap-2 text-xs" data-testid="dev-nav">
      <Link href="/developers" className={`rounded-full border px-3 py-1 ${!active ? 'border-amber-400 text-amber-300' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}>
        Overview
      </Link>
      {DEV_PAGES.map((p) => (
        <Link
          key={p.href}
          href={p.href}
          className={`rounded-full border px-3 py-1 ${active === p.href ? 'border-amber-400 text-amber-300' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
        >
          {p.title.replace('Falcon Cloud RPC gateway', 'RPC gateway')}
        </Link>
      ))}
    </nav>
  )
}

export function TestnetNotice() {
  return (
    <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200" data-testid="testnet-notice">
      {TESTNET_NOTICE}
    </p>
  )
}

export function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-400">
            {head.map((h) => (
              <th key={h} className="py-1 pr-3 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-800 align-top">
              {r.map((c, j) => (
                <td key={j} className={`py-1 pr-3 ${j === 0 ? 'font-mono text-emerald-300 whitespace-nowrap' : ''}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
