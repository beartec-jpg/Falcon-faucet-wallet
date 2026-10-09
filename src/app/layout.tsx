import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import Script from 'next/script'
import Providers from '@/components/Providers'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'Falcon Ledger — Quantum-safe L1 for cross-chain lending and AMM pools (testnet)',
  description:
    'Falcon Ledger is an experimental, quantum-safe L1 focused on lending and AMM pools across chains. On the Falcon Ledger testnet you can use the passkey wallet, AMM pools, lending, and non-custodial ETH, USDC and BTC bridges. Falcon-512 from genesis. Test tokens have no cash value.',
  icons: { icon: '/assets/images/brand/logo-mark.jpg', apple: '/assets/images/brand/apple-touch-icon.jpg' },
  manifest: '/manifest.json',
  openGraph: {
    title: 'Falcon Ledger (FPL) — testnet',
    description:
      'Quantum-safe L1 for cross-chain lending and AMM pools. Experimental testnet with non-custodial ETH, USDC and BTC bridges. Test tokens have no cash value.',
    images: ['/assets/images/brand/og-image.jpg'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Falcon Wallet',
  },
}

export const viewport: Viewport = {
  themeColor: '#c07838',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        {/* iOS PWA meta */}
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/assets/images/brand/apple-touch-icon.jpg" />
      </head>
      <body className="min-h-screen flex flex-col">
        <Providers>{children}</Providers>
        {/* Register service worker for PWA */}
        <Script id="sw-register" strategy="afterInteractive">
          {process.env.NEXT_PUBLIC_DISABLE_SW === '1'
            ? `if ('serviceWorker' in navigator) { navigator.serviceWorker.getRegistrations().then(function(rs){ rs.forEach(function(r){ r.unregister(); }); }); }`
            : `if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(function(){}); }`}
        </Script>
      </body>
    </html>
  )
}
