'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'

/**
 * Marketing homepage for Falcon Ledger (.com root).
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
              alt="Falcon Ledger"
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
              Falcon Ledger
            </h1>
            <p className="hero-subtitle reveal-load" data-delay="200">
              The quantum-safe ledger built for real participation
            </p>
            <p className="hero-support reveal-load" data-delay="400">
              Post-quantum security. Protocol-controlled treasury. Rewards for those who secure and
              use the network.
            </p>
            <div className="hero-actions reveal-load" data-delay="600">
              <a href="#what-is-falcon" className="btn btn-primary">
                Explore the Platform
              </a>
              <Link href="/faucet" className="btn btn-secondary">
                Join the Testnet
              </Link>
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
                Falcon Ledger is a next-generation blockchain designed from the ground up for
                long-term security and fair participation.
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
                  text: 'Those who secure the network earn directly from the protocol.',
                },
                {
                  src: '/assets/images/icons/icon-liquidity.jpg',
                  title: 'Liquidity Providers Get Paid',
                  text: 'Providing liquidity is recognised and rewarded by the protocol itself.',
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

        {/* One Roof */}
        <section className="section section-roof" id="platform">
          <div className="container">
            <div className="section-header reveal">
              <p className="section-eyebrow">Platform</p>
              <h2 className="section-title">One Roof for Everything Crypto</h2>
              <p className="section-intro">
                A single platform where you can hold, bridge, trade, lend, and earn — without jumping
                between different apps and chains.
              </p>
            </div>
            <div className="roof-grid">
              {[
                { src: '/assets/images/platform/platform-wallet.jpg', title: 'Multichain Wallet', href: '/wallet' },
                { src: '/assets/images/platform/platform-bridge.jpg', title: 'Permissionless Bridge', href: '/swap' },
                { src: '/assets/images/platform/platform-pools.jpg', title: 'Liquidity Pools', href: '/pool' },
                { src: '/assets/images/platform/platform-lending.jpg', title: 'Collateralized Lending', href: '/lend' },
                { src: '/assets/images/platform/platform-rewards.jpg', title: 'Participation & Arcade Rewards', href: '/arcade' },
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
              <h2 className="section-title">Platform Features</h2>
            </div>

            {[
              {
                n: '01',
                title: 'Multichain Wallet',
                p1: 'Hold FALCON, XRP, Bitcoin, Ethereum, and BNB in one place.',
                p2: 'One wallet. Multiple chains. Simple and secure.',
                img: '/assets/images/features/feature-wallet.jpg',
                replace: 'feature-wallet.png',
                reverse: false,
              },
              {
                n: '02',
                title: 'Permissionless Bridge',
                p1: 'Move assets onto Falcon with a clean, permissionless bridge.',
                p2: 'No complicated steps. No unnecessary middlemen.',
                img: '/assets/images/features/feature-bridge.jpg',
                replace: 'feature-bridge.png',
                reverse: true,
              },
              {
                n: '03',
                title: 'Liquidity Pools',
                p1: 'Provide liquidity and earn.',
                p2: 'The protocol recognises and rewards those who make markets possible.',
                img: '/assets/images/features/feature-pools.jpg',
                replace: 'feature-pools.png',
                reverse: false,
              },
              {
                n: '04',
                title: 'Collateralized Lending & Borrowing',
                p1: 'Lend and borrow using on-chain collateral.',
                p2: 'Protocol-controlled, transparent, and designed for real use.',
                img: '/assets/images/features/feature-lending.jpg',
                replace: 'feature-lending.png',
                reverse: true,
              },
              {
                n: '05',
                title: 'Earn by Participating',
                p1: 'Validators, liquidity providers, and active users are all rewarded by the protocol.',
                p2: 'No empty promises — real participation, real rewards.',
                img: '/assets/images/features/feature-earn.jpg',
                replace: 'feature-earn.png',
                reverse: false,
              },
            ].map((f) => (
              <div
                key={f.n}
                className={`feature-block reveal${f.reverse ? ' feature-block-reverse' : ''}`}
              >
                <div className="feature-block-copy">
                  <p className="feature-block-label">Feature {f.n}</p>
                  <h3>{f.title}</h3>
                  <p>{f.p1}</p>
                  <p>{f.p2}</p>
                </div>
                <div className="feature-block-visual">
                  <figure className="media-frame">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.img} alt={`${f.title} preview`} width={720} height={520} loading="lazy" />
                    <figcaption className="media-slot-label">Replace: {f.replace}</figcaption>
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
                  text: 'Validators, liquidity providers, and participants earn from the protocol itself — not empty incentives.',
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
                Falcon Ledger is live on testnet.
                <br />
                Start using the wallet, bridge assets, provide liquidity, or just look around.
              </p>
              <div className="cta-actions">
                <Link href="/wallet" className="btn btn-primary">
                  Launch Wallet
                </Link>
                <Link href="/whitepaper" className="btn btn-secondary">
                  Read the Docs
                </Link>
                <Link href="/faucet" className="btn btn-ghost">
                  Join the Community
                </Link>
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
              alt="Falcon Ledger"
              width={140}
              height={32}
              style={{ height: 32, width: 'auto' }}
            />
          </div>
          <nav className="footer-links" aria-label="Footer">
            <Link href="/wallet">Wallet</Link>
            <Link href="/swap">Bridge</Link>
            <Link href="/whitepaper">Docs</Link>
            <Link href="/whitepaper">Whitepaper</Link>
            <Link href="/faucet">Faucet</Link>
            <a href="https://github.com/beartec-jpg/Falcon-faucet-wallet" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </nav>
          <p className="footer-copy">
            &copy; <span id="year"></span> Falcon Ledger. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
