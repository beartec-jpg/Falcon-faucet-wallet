'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

type NavItem = 'faucet' | 'wallet' | 'market' | 'scan'

interface HeaderProps {
  current: NavItem
  subtitle?: string
  children?: ReactNode
}

const NAV_ITEMS: { key: NavItem; label: string; href: string }[] = [
  { key: 'faucet', label: 'Faucet', href: '/' },
  { key: 'scan', label: 'Explorer', href: '/scan' },
  { key: 'wallet', label: 'Wallet', href: '/wallet' },
  { key: 'market', label: 'Market', href: '/marketplace' },
]

export default function Header({ current, subtitle, children }: HeaderProps) {
  const NETWORK_NAME = process.env.NEXT_PUBLIC_NETWORK_NAME ?? 'qXRP Falcon Testnet'

  return (
    <header className="border-b border-slate-800/60 px-4 py-3 flex items-center justify-between sticky top-0 bg-slate-950/95 backdrop-blur-md z-20">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center font-bold text-slate-950 text-sm">
          Q
        </div>
        <div>
          <div className="font-semibold text-white leading-tight">{NETWORK_NAME}</div>
          <div className="text-xs text-slate-500">
            {subtitle || (current === 'wallet' ? 'Wallet · Passkey secured' : 
                         current === 'market' ? 'Marketplace · AMM DEX' : 
                         current === 'scan' ? 'Explorer' : 'Faucet')}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <nav className="flex items-center gap-1 text-sm">
          {NAV_ITEMS.map((item) => {
            const isActive = item.key === current
            return isActive ? (
              <span
                key={item.key}
                className="px-3 py-1.5 rounded-lg bg-brand-500/10 text-brand-500 font-medium"
              >
                {item.label}
              </span>
            ) : (
              <Link
                key={item.key}
                href={item.href}
                className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
        {children}
      </div>
    </header>
  )
}
