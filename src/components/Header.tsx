'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNetwork } from '@/components/NetworkProvider'
import NetworkSwitcher from '@/components/NetworkSwitcher'

type NavItem =
  | 'faucet'
  | 'wallet'
  | 'vault'
  | 'swap'
  | 'pool'
  | 'lend'
  | 'airdrop'
  | 'community'
  | 'scan'
  | 'arcade'
  | 'whitepaper'
  | 'first35'

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
  { key: 'vault', label: 'Vault', href: '/vault' },
  { key: 'arcade', label: 'Arcade', href: '/arcade' },
  { key: 'swap', label: 'Swap', href: '/swap' },
  { key: 'pool', label: 'Pool', href: '/pool' },
  { key: 'lend', label: 'Lend', href: '/lend' },
  { key: 'airdrop', label: 'Airdrop', href: '/airdrop' },
  { key: 'first35', label: 'First 35', href: '/first-35' },
  { key: 'community', label: 'Community', href: '/community' },
  { key: 'whitepaper', label: 'Whitepaper', href: '/whitepaper' },
]

/** Shown under Community in the mobile (burger) menu and the desktop/tablet Community dropdown. */
const COMMUNITY_SUB_ITEMS: { label: string; href: string }[] = [
  { label: 'FAQ', href: '/community/faq' },
  { label: 'Feedback', href: '/feedback' },
  { label: 'Learn', href: '/community/learn' },
  { label: 'Validators', href: '/validator' },
]

function NavLinks({
  current,
  onNavigate,
  className = '',
  withSubItems = false,
  communityOpen = false,
  onToggleCommunity,
}: {
  current: NavItem
  onNavigate?: () => void
  className?: string
  withSubItems?: boolean
  communityOpen?: boolean
  onToggleCommunity?: (anchor: HTMLElement) => void
}) {
  return (
    <nav className={className}>
      {NAV_ITEMS.flatMap((item) => {
        const el = navItem(item)
        if (item.key === 'community' && onToggleCommunity) {
          return [
            <span key="community-group" className="inline-flex items-center">
              {el}
              <button
                type="button"
                data-testid="community-menu-toggle"
                aria-label="Community menu"
                aria-haspopup="menu"
                aria-expanded={communityOpen}
                onClick={(e) => onToggleCommunity(e.currentTarget)}
                className="-ml-1 px-1.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d={communityOpen ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </span>,
          ]
        }
        if (!withSubItems || item.key !== 'community') return [el]
        return [
          el,
          ...COMMUNITY_SUB_ITEMS.map((sub) => (
            <Link
              key={sub.href}
              href={sub.href}
              onClick={onNavigate}
              className="pl-6 pr-2.5 py-1.5 rounded-lg whitespace-nowrap text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors text-sm"
            >
              {sub.label}
            </Link>
          )),
        ]
      })}
    </nav>
  )

  function navItem(item: (typeof NAV_ITEMS)[number]) {
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
  }
}

export default function Header({
  current,
  subtitle,
  children,
  sticky = true,
}: HeaderProps) {
  const { network } = useNetwork()
  const [menuOpen, setMenuOpen] = useState(false)
  const [communityLeft, setCommunityLeft] = useState<number | null>(null)
  const headerRef = useRef<HTMLElement>(null)
  const communityOpen = communityLeft !== null
  useEffect(() => {
    if (!communityOpen) return
    const close = (e: Event) => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('[data-community-menu],[data-testid="community-menu-toggle"]')) return
      setCommunityLeft(null)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setCommunityLeft(null)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    window.addEventListener('resize', () => setCommunityLeft(null), { once: true })
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [communityOpen])
  const toggleCommunity = (anchor: HTMLElement) => {
    if (communityOpen) return setCommunityLeft(null)
    const group = anchor.parentElement ?? anchor
    const h = headerRef.current?.getBoundingClientRect()
    const r = group.getBoundingClientRect()
    const width = 200
    const maxLeft = (h?.width ?? window.innerWidth) - width - 8
    setCommunityLeft(Math.max(8, Math.min(r.left - (h?.left ?? 0), maxLeft)))
  }
  useEffect(() => {
    const el = document.getElementById(`nav-item-${current}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [current])

  const subtitleText =
    subtitle ||
    (current === 'wallet'
      ? 'Wallet · Passkey secured'
      : current === 'vault'
        ? 'Vault · air-gapped'
        : current === 'swap'
        ? 'Swap · fUSDC / FPL'
        : current === 'pool'
          ? 'Pool · fUSDC / FPL'
          : current === 'lend'
            ? 'Lend · F-USDC vault'
            : current === 'airdrop'
              ? 'Airdrop · Community'
              : current === 'community'
                ? 'Community'
                : current === 'scan'
                  ? 'Explorer'
                  : current === 'arcade'
                    ? 'Arcade · Game Faucet'
                    : current === 'whitepaper'
                      ? 'White paper'
                      : 'Faucet')

  return (
    <header
      ref={headerRef}
      className={`relative border-b border-slate-800/60 px-4 py-3 bg-slate-950/95 backdrop-blur-md z-20 shrink-0 ${
        sticky ? 'sticky top-0' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-3 min-w-0 rounded-lg hover:opacity-90 transition-opacity group"
            aria-label="Falcon PL home"
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
          communityOpen={communityOpen}
          onToggleCommunity={toggleCommunity}
        />
      </div>

      {/* Community dropdown — rendered outside the scroll strip so it isn't clipped */}
      {communityOpen && (
        <div
          data-community-menu
          role="menu"
          className="hidden sm:flex absolute top-full mt-1 w-[200px] flex-col gap-0.5 p-1.5 rounded-xl border border-slate-800 bg-slate-950 shadow-xl z-30"
          style={{ left: communityLeft ?? 0 }}
        >
          {[{ label: 'Community home', href: '/community' }, ...COMMUNITY_SUB_ITEMS].map((sub) => (
            <Link
              key={sub.href}
              href={sub.href}
              role="menuitem"
              onClick={() => setCommunityLeft(null)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                sub.href === '/feedback'
                  ? 'text-brand-400 hover:text-brand-300 hover:bg-slate-800 font-medium'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              {sub.label}
            </Link>
          ))}
        </div>
      )}

      {/* Mobile — full vertical menu (all tabs always visible) */}
      {menuOpen && (
        <div className="sm:hidden mt-3 pt-3 border-t border-slate-800/60">
          <NavLinks
            current={current}
            onNavigate={() => setMenuOpen(false)}
            withSubItems
            className="flex flex-col gap-1 text-sm"
          />
        </div>
      )}
    </header>
  )
}
