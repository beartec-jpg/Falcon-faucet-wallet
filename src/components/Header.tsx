'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useNetwork } from '@/components/NetworkProvider'
import NetworkSwitcher from '@/components/NetworkSwitcher'

type NavItem = 'faucet' | 'wallet' | 'swap' | 'pool' | 'board' | 'scan' | 'whitepaper'

interface HeaderProps {
  current: NavItem
  subtitle?: string
  children?: ReactNode
}

const NAV_ITEMS: { key: NavItem; label: string; href: string }[] = [
  { key: 'faucet', label: 'Faucet', href: '/' },
  { key: 'scan', label: 'Explorer', href: '/scan' },
  { key: 'wallet', label: 'Wallet', href: '/wallet' },
  { key: 'swap', label: 'Swap', href: '/swap' },
  { key: 'pool', label: 'Pool', href: '/pool' },
  { key: 'board', label: 'Board', href: '/board' },
  { key: 'whitepaper', label: 'Whitepaper', href: '/whitepaper' },
]

function NavLinks({
  current,
  onNavigate,
  className = '',
}: {
  current: NavItem
  onNavigate?: () => void
  className?: string
}) {
  return (
    <nav className={className}>
      {NAV_ITEMS.map((item) => {
        const isActive = item.key === current
        return isActive ? (
          <span
            key={item.key}
            className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-brand-500/10 text-brand-500 font-medium whitespace-nowrap"
          >
            {item.label}
          </span>
        ) : (
          <Link
            key={item.key}
            href={item.href}
            onClick={onNavigate}
            className="px-2.5 sm:px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

export default function Header({ current, subtitle, children }: HeaderProps) {
  const { network } = useNetwork()
  const [menuOpen, setMenuOpen] = useState(false)

  const subtitleText =
    subtitle ||
    (current === 'wallet'
      ? 'Wallet · Passkey secured'
      : current === 'swap'
        ? 'Swap · F-USDC'
        : current === 'pool'
          ? 'Pool · F-USDC'
          : current === 'board'
            ? 'Board · Community'
            : current === 'scan'
          ? 'Explorer'
          : current === 'whitepaper'
            ? 'White paper'
            : 'Faucet')

  return (
    <header className="relative border-b border-slate-800/60 px-4 py-3 sticky top-0 bg-slate-950/95 backdrop-blur-md z-20">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="w-8 h-8 rounded-lg overflow-hidden shrink-0">
            <Image
              src="/falcon-logo.png"
              alt="Falcon Ledger"
              width={32}
              height={32}
              className="w-full h-full object-cover rounded-lg"
            />
          </Link>
          <div className="min-w-0">
            <div className="font-semibold text-white leading-tight truncate">{network.name}</div>
            <div className="text-xs text-slate-500 truncate">{subtitleText}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <NetworkSwitcher compact />
          <button
            type="button"
            className="sm:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
              </svg>
            )}
          </button>
          {children}
        </div>
      </div>

      {/* Tablet / desktop — scroll horizontally when all tabs do not fit */}
      <div className="hidden sm:block mt-2 -mx-4 px-4 overflow-x-auto nav-scroll">
        <NavLinks
          current={current}
          className="flex items-center gap-1 flex-nowrap justify-start sm:justify-end min-w-max text-sm pb-0.5"
        />
      </div>

      {/* Mobile — slide-down menu */}
      {menuOpen && (
        <div className="sm:hidden mt-3 pt-3 border-t border-slate-800/60">
          <NavLinks
            current={current}
            onNavigate={() => setMenuOpen(false)}
            className="flex flex-col gap-1 text-sm"
          />
        </div>
      )}
    </header>
  )
}