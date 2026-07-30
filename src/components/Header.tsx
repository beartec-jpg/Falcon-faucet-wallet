'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useNetwork } from '@/components/NetworkProvider'
import NetworkSwitcher from '@/components/NetworkSwitcher'

type NavItem =
  | 'faucet'
  | 'wallet'
  | 'swap'
  | 'pool'
  | 'lend'
  | 'airdrop'
  | 'board'
  | 'scan'
  | 'arcade'
  | 'whitepaper'

interface HeaderProps {
  current: NavItem
  subtitle?: string
  children?: ReactNode
  /**
   * Use static positioning (no sticky pin). Prefer on full-viewport pages
   * like Arcade so chrome never covers the game while the page scrolls.
   */
  sticky?: boolean
}

const NAV_ITEMS: { key: NavItem; label: string; href: string }[] = [
  { key: 'faucet', label: 'Faucet', href: '/faucet' },
  { key: 'scan', label: 'Explorer', href: '/scan' },
  { key: 'wallet', label: 'Wallet', href: '/wallet' },
  { key: 'arcade', label: 'Arcade', href: '/arcade' },
  { key: 'swap', label: 'Swap', href: '/swap' },
  { key: 'pool', label: 'Pool', href: '/pool' },
  { key: 'lend', label: 'Lend', href: '/lend' },
  { key: 'airdrop', label: 'Airdrop', href: '/airdrop' },
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
        const itemClass = 'px-2.5 sm:px-3 py-1.5 rounded-lg whitespace-nowrap scroll-mx-4'
        if (isActive) {
          return (
            <span
              key={item.key}
              id={`nav-item-${item.key}`}
              className={`${itemClass} bg-brand-500/10 text-brand-500 font-medium text-sm`}
            >
              {item.label}
            </span>
          )
        }
        return (
          <Link
            key={item.key}
            id={`nav-item-${item.key}`}
            href={item.href}
            onClick={onNavigate}
            className={`${itemClass} text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors text-sm`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

export default function Header({
  current,
  subtitle,
  children,
  sticky = true,
}: HeaderProps) {
  const { network } = useNetwork()
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    const el = document.getElementById(`nav-item-${current}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [current])

  const subtitleText =
    subtitle ||
    (current === 'wallet'
      ? 'Wallet · Passkey secured'
      : current === 'swap'
        ? 'Swap · F-USDC'
        : current === 'pool'
          ? 'Pool · F-USDC'
          : current === 'lend'
            ? 'Lend · F-USDC vault'
            : current === 'airdrop'
              ? 'Airdrop · Community'
              : current === 'board'
                ? 'Board · Community'
                : current === 'scan'
                  ? 'Explorer'
                  : current === 'arcade'
                    ? 'Arcade · Game Faucet'
                    : current === 'whitepaper'
                      ? 'White paper'
                      : 'Faucet')

  return (
    <header
      className={`relative border-b border-slate-800/60 px-4 py-3 bg-slate-950/95 backdrop-blur-md z-20 shrink-0 ${
        sticky ? 'sticky top-0' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-3 min-w-0 rounded-lg hover:opacity-90 transition-opacity group"
            aria-label="Falcon Ledger home"
            title="Home"
          >
            <span className="w-8 h-8 rounded-lg overflow-hidden shrink-0 ring-1 ring-brand-500/30 group-hover:ring-brand-400/50 transition-shadow">
              <Image
                src="/falcon-logo.png"
                alt=""
                width={32}
                height={32}
                className="w-full h-full object-cover rounded-lg"
              />
            </span>
            <span className="min-w-0 text-left">
              <span className="block font-semibold text-white leading-tight truncate group-hover:text-brand-400 transition-colors">
                {network.name}
              </span>
              <span className="block text-xs text-slate-500 truncate">{subtitleText}</span>
            </span>
          </Link>
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

      {/* Tablet / desktop — horizontal scroll; active tab auto-centers */}
      <div className="hidden sm:block mt-2 -mx-4 px-4 overflow-x-auto nav-scroll nav-scroll-hint">
        <NavLinks
          current={current}
          className="flex items-center gap-1 flex-nowrap justify-start min-w-max text-sm pb-0.5"
        />
      </div>

      {/* Mobile — full vertical menu (all tabs always visible) */}
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
