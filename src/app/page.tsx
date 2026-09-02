'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { DISCORD_INVITE_URL } from '@/lib/community-links'

/**
 * Marketing homepage for Falcon PL (falcon-ledger.com root).
 * Faucet lives at /faucet; wallet at /wallet.
 */
export default function MarketingHomePage() {
  useEffect(() => {
    // Dynamic load marketing CSS (scoped helpers live in the file)
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/marketing/styles.css'
    link.id = 'marketing-styles'
    document.head.appendChild(link)

    // Load hero canvas + scroll reveals
    const script = document.createElement('script')
    script.src = '/marketing/main.js'
    script.async = true
    script.id = 'marketing-main'
    document.body.appendChild(script)

    return () => {
      document.getElementById('marketing-styles')?.remove()
      document.getElementById('marketing-main')?.remove()
      document.body.style.overflow = ''
    }
  }, [])

  return (
    <div className="marketing-root assets-final">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="site-header" id="top">
        <nav className="nav container" aria-label="Primary">
          <Link href="/" className="nav-brand">
            <Image
              className="nav-logo"
              src="/assets/images/brand/logo.jpg"
              alt="Falcon PL"
              width={160}
              height={36}
              priority
              style={{ height: 36, width: 'auto' }}
            />
          </Link>
          <button
            className="nav-toggle"
            type="button"
            aria-expanded="false"
            aria-controls="nav-menu"
            aria-label="Open menu"
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
          <ul className="nav-menu" id="nav-menu">
            <li>
              <a href="#what-is-falcon">About</a>
            </li>
            <li>
              <a href="#platform">Platform</a>
            </li>
            <li>
              <a href="#features">Features</a>
            </li>
            <li>
              <a href="#built-differently">Why Falcon</a>
            </li>
            <li>
              <Link href="/wallet" className="nav-cta">
                Launch Wallet
              </Link>
            </li>
          </ul>
        </nav>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="hero" id="hero">
          <video
            className="hero-video"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
            poster="/assets/images/hero-visual.jpg"
          >
            <source src="/assets/animations/hero-loop.mp4" type="video/mp4" />
          </video>
          <canvas className="hero-canvas" id="hero-canvas" aria-hidden="true" />
          <div className="hero-glow" aria-hidden="true" />
          <div className="hero-content container">
            <h1 className="hero-title reveal-load" data-delay="0">
              Falcon PL
            </h1>
            <p className="hero-subtitle reveal-load" data-delay="200">
              A quantum-safe participation ledger
            </p>
            <p className="hero-support reveal-load" data-delay="400">
              Pre-public Falcon-512 testnet 2300. Test tokens have no cash value.
              Post-quantum signatures from genesis.
            </p>
            <p className="hero-status reveal-load" data-delay="500">
              PQC testnet + wallet + faucet + explorer. AMM, lend, and dest-lock
              bridge are experimental.
            </p>
            <div className="hero-actions reveal-load" data-delay="600">
              <Link href="/wallet" className="btn btn-primary">
                Launch Wallet
              </Link>
              <Link href="/faucet" className="btn btn-secondary">
                Join the Testnet
              </Link>
              <a
                href={DISCORD_INVITE_URL}
                className="btn btn-secondary"
                target="_blank"
                rel="noopener noreferrer"
              >
                Discord
              </a>
            </div>
          </div>
          <div className="hero-scroll" aria-hidden="true">
            <span>Scroll</span>
            <div className="hero-scroll-line" />
          </div>
        </section>

        {/* What is Falcon */}
        <section className="section section-what" id="what-is-falcon">
          <div className="container">
            <div className="section-header reveal">
              <p className="section-eyebrow">Introduction</p>
              <h2 className="section-title">What is Falcon?</h2>
              <p className="section-intro">
                Falcon PL is a quantum-safe participation ledger — Falcon Consensus and Falcon-512,
                designed for long-term security and fair participation. This site is the pre-public
                2300 testnet, not a finished multi-chain product.
              </p>
            </div>
            <div className="feature-grid">
              {[
                {
                  src: '/assets/images/icons/icon-quantum.jpg',
                  title: 'Post-Quantum Secure',
                  text: 'Protected by Falcon-512 signatures from the very first block.',
                },
                {
                  src: '/assets/images/icons/icon-treasury.jpg',
                  title: 'Protocol-Controlled Treasury',
                  text: '98% of the supply sits in a keyless treasury — no company escrow.',
                },
                {
                  src: '/assets/images/icons/icon-popl.jpg',
                  title: 'Proof of Participation & Liquidity (PoPL)',
                  text: 'A new model that rewards real contribution to the network.',
                },
                {
                  src: '/assets/images/icons/icon-validators.jpg',
                  title: 'Validators Get Paid',
                  text: 'On this testnet, those who secure the network earn from the protocol. Test tokens have no cash value.',
                },
                {
                  src: '/assets/images/icons/icon-liquidity.jpg',
                  title: 'Liquidity Providers Get Paid',
                  text: 'On this testnet, providing liquidity is recognised by the protocol. Testnet rewards only — not mainnet yield. Test tokens have no cash value.',
                },
              ].map((card, i) => (
                <article key={card.title} className="feature-card reveal" data-stagger={i}>
                  <div className="feature-card-icon">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={card.src} alt="" width={48} height={48} loading="lazy" />
                  </div>
                  <h3>{card.title}</h3>
                  <p>{card.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Testnet surfaces */}
        <section className="section section-roof" id="platform">
          <div className="container">
            <div className="section-header reveal">
              <p className="section-eyebrow">Testnet 2300</p>
              <h2 className="section-title">What you can try today</h2>
              <p className="section-intro">
                Wallet, faucet, and explorer are live on this PQC testnet. AMM, lend, and dest-lock
                are experimental — not a finished wallet + pools + lend + earn stack.
              </p>
            </div>
            <div className="roof-grid">
              {[
                { src: '/assets/images/platform/platform-wallet.jpg', title: 'Testnet wallet', href: '/wallet' },
                {
                  src: '/assets/images/platform/platform-bridge.jpg',
                  title: 'Testnet dest-lock',
                  href: '/wallet',
                  badge: 'Experimental',
                },
                {
                  src: '/assets/images/platform/platform-pools.jpg',
                  title: 'Liquidity pools',
                  href: '/pool',
                  badge: 'Experimental',
                },
                {
                  src: '/assets/images/platform/platform-lending.jpg',
                  title: 'Lending',
                  href: '/lend',
                  badge: 'Experimental',
                },
                {
                  src: '/assets/images/platform/platform-rewards.jpg',
                  title: 'Arcade',
                  href: '/arcade',
                },
              ].map((item, i) => (
                <Link
                  key={item.title}
                  href={item.href}
                  className="roof-card reveal"
                  data-stagger={i}
                >
                  <div className="roof-card-visual">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.src} alt="" width={96} height={96} loading="lazy" />
                  </div>
                  <h3>{item.title}</h3>
                  {item.badge ? <span className="tile-badge">{item.badge}</span> : null}
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Platform Features */}
        <section className="section section-features" id="features">
          <div className="container">
            <div className="section-header reveal">
              <p className="section-eyebrow">Capabilities</p>
              <h2 className="section-title">On this testnet</h2>
            </div>

            {([
              {
                n: '01',
                title: 'Testnet wallet',
                p1: 'Hold FPL on Falcon PL 2300. Live dest-lock rails are ETH and USDC (Sepolia). BTC is on the rail; exit is still operator-fronted, not custodialess.',
                p2: 'Passkey wallet on this testnet. Test tokens have no cash value.',
                img: '/assets/images/features/feature-wallet.jpg',
                reverse: false,
              },
              {
                n: '02',
                title: 'Testnet dest-lock',
                badge: 'Experimental',
                p1: 'ETH/USDC dest-lock is the 2300 path. BTC exit is still operator-fronted (not custodialess).',
                p2: 'Experimental testnet corridor — not a finished bridge product.',
                img: '/assets/images/features/feature-bridge.jpg',
                reverse: true,
              },
              {
                n: '03',
                title: 'Liquidity pools',
                badge: 'Experimental AMM',
                p1: 'Testnet AMM for providing liquidity on Falcon PL 2300.',
                p2: 'Experimental. Not a production market-maker.',
                img: '/assets/images/features/feature-pools.jpg',
                reverse: false,
              },
              {
                n: '04',
                title: 'Lending',
                badge: 'Experimental',
                p1: 'Testnet collateralized lend and borrow on Falcon PL 2300.',
                p2: 'Experimental. Not a production lending market.',
                img: '/assets/images/features/feature-lending.jpg',
                reverse: true,
              },
              {
                n: '05',
                title: 'Earn by participating',
                p1: 'Validators, liquidity providers, and arcade play are how you participate on this testnet.',
                p2: 'Rewards are testnet — they have no cash value.',
                img: '/assets/images/features/feature-earn.jpg',
                reverse: false,
              },
            ] as const).map((f) => (
              <div
                key={f.n}
                className={`feature-block reveal${f.reverse ? ' feature-block-reverse' : ''}`}
              >
                <div className="feature-block-copy">
                  <p className="feature-block-label">
                    Feature {f.n}
                    {'badge' in f && f.badge ? (
                      <span className="feature-block-badge">{f.badge}</span>
                    ) : null}
                  </p>
                  <h3>{f.title}</h3>
                  <p>{f.p1}</p>
                  <p>{f.p2}</p>
                </div>
                <div className="feature-block-visual">
                  <figure className="media-frame">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.img} alt={`${f.title} preview`} width={720} height={520} loading="lazy" />
                  </figure>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Built Differently */}
        <section className="section section-why" id="built-differently">
          <div className="container">
            <div className="section-header reveal">
              <p className="section-eyebrow">Principles</p>
              <h2 className="section-title">Built Differently</h2>
            </div>
            <div className="why-grid">
              {[
                {
                  n: '01',
                  title: 'Quantum-resistant from day one',
                  text: 'Security designed for the long term, with post-quantum cryptography at the foundation — not bolted on later.',
                },
                {
                  n: '02',
                  title: 'No single company controlling the majority of the supply',
                  text: '98% of tokens sit in a keyless, protocol-controlled treasury. Fair structure by design.',
                },
                {
                  n: '03',
                  title: 'Real rewards for the people who secure and use the network',
                  text: 'On testnet 2300, validators, liquidity providers, and participants earn from the protocol. Testnet rewards only — test tokens have no cash value.',
                },
                {
                  n: '04',
                  title: 'Designed for the long term, not short-term hype',
                  text: 'Calm, durable architecture focused on lasting utility and fair participation over cycles of noise.',
                },
              ].map((w, i) => (
                <article key={w.n} className="why-card reveal" data-stagger={i}>
                  <div className="why-number">{w.n}</div>
                  <h3>{w.title}</h3>
                  <p>{w.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="section section-cta" id="cta">
          <div className="cta-glow" aria-hidden="true" />
          <div className="container">
            <div className="cta-content reveal">
              <h2 className="section-title">Ready to explore?</h2>
              <p className="cta-text">
                Falcon PL is a pre-public testnet.
                <br />
                Start with the wallet, faucet, or explorer. Test tokens have no cash value.
              </p>
              <div className="cta-actions">
                <Link href="/wallet" className="btn btn-primary">
                  Launch Wallet
                </Link>
                <Link href="/whitepaper" className="btn btn-secondary">
                  Read the Whitepaper
                </Link>
                <a
                  href={DISCORD_INVITE_URL}
                  className="btn btn-secondary"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Join Discord
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container footer-inner">
          <div className="footer-brand">
            <Image
              className="footer-logo"
              src="/assets/images/brand/logo.jpg"
              alt="Falcon PL"
              width={140}
              height={32}
              style={{ height: 32, width: 'auto' }}
            />
          </div>
          <nav className="footer-links" aria-label="Footer">
            <Link href="/wallet">Wallet</Link>
            <Link href="/faucet">Faucet</Link>
            <Link href="/scan">Explorer</Link>
            <Link href="/arcade">Arcade</Link>
            <Link href="/whitepaper">Whitepaper</Link>
            <Link href="/community">Community</Link>
            <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">
              Discord
            </a>
            <a href="https://github.com/beartec-jpg/Falcon-faucet-wallet" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </nav>
          <p className="footer-copy">
            &copy; <span id="year"></span> Falcon PL. Pre-public testnet 2300. Test tokens have no cash
            value.
          </p>
        </div>
      </footer>
    </div>
  )
}
